/*
 * ============================================================================
 * WHY THIS CLASSIFIER READS EFFECTS AND NOT OPERATIONS
 * ============================================================================
 *
 * Do not "optimize" this into operation parsing. It was tried, twice, and both
 * times produced a rule that silently mis-reports real swaps.
 *
 * The row source is:
 *     effects.accounts[ourKey].fields.balance   ->  { [token]: TokenEntry[] }
 *   netted per token, per staple.
 *
 * Two properties make this correct, and operations lack both:
 *
 *   1. EFFECTS ARE ALREADY SCOPED TO OUR ACCOUNT. Operations are not. In a real
 *      mainnet swap (staple 74F743C3...), the block containing SEND+RECEIVE
 *      belonged to the COUNTERPARTY, not to us. Our own block was 4x SEND and
 *      would have been classified as four separate withdrawals -- phantom
 *      disposals for a trade we were merely one side of. Any rule that inspects
 *      "the block" has to first answer "whose block?", and effects answer that
 *      for us.
 *
 *   2. EFFECTS NET ACROSS THE WHOLE STAPLE. In that same swap our KTA deltas
 *      were -0.07, -0.077, -0.05, +70.05. KTA appears as BOTH negative and
 *      positive in one staple (routing fees out, proceeds in). A per-operation
 *      or per-entry rule sees four movements; only the NET (+69.853) is the
 *      economically real one.
 *
 * This is also why the block-vs-staple granularity argument became a non-issue:
 * it is the wrong axis. The right axis is "net change to our balance," which is
 * what effects express directly.
 *
 * Operations are consulted for exactly two things effects genuinely do not
 * carry, and never for amount, direction, or classification:
 *
 *   - the `external` memo field on SEND;
 *   - which balance entries are the NETWORK FEE. Effects flatten the fee into
 *     ordinary negative entries, so the fee is only identifiable from the block
 *     that produced it: `block.purpose === BlockPurpose.FEE`. See
 *     extractFeeLegs for why every amount-based test for this is wrong.
 *
 * Other invariants encoded below, each of which prevents a silent wrong number:
 *   - Direction comes from the SIGN of value. Never `isReceive`, which was
 *     false on all 26,226 balance entries observed across two mainnet wallets,
 *     including every incoming one.
 *   - Decimals come from each token`s ON-CHAIN metadata (see lib/tokens.js),
 *     cross-checked against the registry. A disagreement fails the token rather
 *     than picking a side.
 *   - 0 and undefined are distinct ($JPY has 0 decimals).
 *   - Anything unmappable is flagged, never dropped.
 * ============================================================================
 */

/*
 * IIFE-wrapped: the browser loads these as plain <script> tags and classic
 * scripts share ONE global scope. Top-level const/function names would collide
 * across lib files into a parse-time SyntaxError, which silently prevents the
 * file from registering. Cross-file access goes through globalThis.KeetaTax.
 */
(function () {
'use strict';

/* Works under CommonJS (CLI) and as a plain <script> (browser page). */
const parseUnits = (typeof require === 'function')
	? require('./format').parseUnits
	: globalThis.KeetaTax.parseUnits;
const TOKEN_STATUS = (typeof require === 'function')
	? require('./tokens').TOKEN_STATUS
	: globalThis.KeetaTax.TOKEN_STATUS;

const REASONS = {
	UNRESOLVED_TOKEN: 'token divisor could not be established, refusing to guess',
	EXCLUDED_TOKEN: 'tokenized fiat, excluded because its ticker collides with real currency',
	MULTI_LEG: 'more than two tokens moved, so this is not a simple trade',
	FEE_ONLY: 'the only movement was the network fee',
	UNRESOLVED_FEE_TOKEN: 'network fee was paid in a token whose divisor is unknown',
	MULTI_TOKEN_FEE: 'network fee was paid in more than one token',
	UNPRICEABLE: 'CoinLedger has no price data for this token',
	GROSS_FLOW: 'money moved both directions in one transaction, only the net is in the CSV',
	POSSIBLE_BRIDGE: 'possible bridge transfer',
	YEAR_BOUNDARY: 'timestamp within 2 minutes of a tax-year boundary',
	NET_ZERO: 'balance entries present but net change is zero for every token',
	HIGH_PRECISION: 'amount has more precision than a spreadsheet may preserve',
	NO_TIMESTAMP: 'staple timestamp unavailable'
};

/* Milliseconds either side of Jan 1 00:00:00 UTC that trigger a review flag. */
const YEAR_BOUNDARY_WINDOW_MS = 2 * 60 * 1000;

/*
 * Below this, a hidden gross-flow leg is suppressed from per-row flags.
 *
 * This is NOT a materiality judgement about dollar value. It is that the amount
 * cannot be expressed in a tax filing at all: CoinLedger works to 8 decimal
 * places, so anything below 1e-8 KTA rounds to zero at every precision the
 * report can represent. One base unit is 1e-18 KTA -- ten orders of magnitude
 * below the smallest reportable figure. Flagging it asks the user to review
 * something that cannot appear in their return.
 *
 * That is a defensible line rather than an arbitrary cutoff: it is set by the
 * output format's precision, not by someone's opinion of what is "small".
 *
 * Suppressed rows are always COUNTED and the count is always shown. Nothing is
 * ever hidden silently.
 *
 * Expressed as a decimal string and converted using the token's own decimals,
 * so it stays correct on testnet (9 decimals) as well as mainnet (18).
 */
const DUST_THRESHOLD_KTA = '0.00000001';

/*
 * `BlockPurpose.FEE` in the SDK. Every staple carries exactly one fee block;
 * its `account` is whoever paid. See extractFeeLegs.
 */
const BLOCK_PURPOSE_FEE = 1;

/* SDK objects expose the address as `.publicKeyString`; JSON gives a string. */
function accountKey(v) {
	if (v === undefined || v === null) {
		return (null);
	}
	if (typeof v === 'string') {
		return (v);
	}
	if (v.publicKeyString !== undefined) {
		return (String(v.publicKeyString));
	}
	return (String(v));
}

/*
 * ============================================================================
 * NETWORK FEES ARE READ STRUCTURALLY, NEVER BY AMOUNT
 * ============================================================================
 *
 * The SDK builds fees in `computeFeeBlock`: one SEND per vote on the staple,
 * sealed into a block whose `purpose` is BlockPurpose.FEE. So a fee leg is
 * exactly "a SEND inside the fee block that OUR account owns" -- no threshold,
 * no materiality judgement, no guessing from the size of a number.
 *
 * Two details that defeat the obvious tests, both confirmed against mainnet:
 *
 *   1. Fees are paid to `selectedFee.payTo ?? vote.issuer`. Representatives
 *      nominate a separate payout address, so the recipient is NOT the voting
 *      identity and the addresses rotate almost every staple. Checking "did
 *      this go to a representative" returns zero across every wallet tested.
 *   2. `effects.metadata.feeUnits` is a SIZE metric, not a price:
 *      1000*blocks + 10000*openingBlocks + sum(per-op units). It reproduced
 *      5,026 of 5,026 staples exactly, and it is NOT convertible to KTA. The
 *      real, exact fee is the sum of the fee block's SEND amounts.
 *
 * Fee legs also appear as ordinary negative balance entries, so they must be
 * REMOVED before netting or they are indistinguishable from a disposal of the
 * principal. That is the whole MULTI_LEG defect: 1.5 USDC out plus 0.00404 KTA
 * of fees read as "two tokens out, none in", which is not a trade, so the row
 * was dropped and a real disposal vanished from the export.
 * ============================================================================
 */
function extractFeeLegs(voteStaple, ourKey) {
	const legs = [];
	if (!voteStaple) {
		return (legs);
	}

	let json;
	try {
		json = (typeof voteStaple.toJSON === 'function') ? voteStaple.toJSON() : voteStaple;
	} catch {
		return (legs);
	}

	for (const block of (json && json.blocks) || []) {
		if (Number(block.purpose) !== BLOCK_PURPOSE_FEE) {
			continue;
		}
		/* Only fees WE paid. In a swap the counterparty owns the fee block. */
		if (accountKey(block.account) !== ourKey) {
			continue;
		}
		for (const op of block.operations || []) {
			if (op.amount === undefined || op.token === undefined || op.to === undefined) {
				continue;
			}
			legs.push({
				token: accountKey(op.token),
				to: accountKey(op.to),
				/* toJSON emits hex strings; live objects give bigint. */
				amount: BigInt(op.amount)
			});
		}
	}

	return (legs);
}

/*
 * Remove the fee legs from the balance entries so netting sees only principal.
 *
 * Matched on (exact amount, exact counterparty), one entry consumed per leg. A
 * leg we cannot match is left in place and counted rather than assumed: better
 * to under-extract a fee (the old, conservative behaviour) than to delete a
 * real disposal because it happened to look like one.
 */
function stripFeeEntries(balanceField, feeLegs) {
	const principal = {};
	for (const [token, entries] of Object.entries(balanceField)) {
		principal[token] = entries.slice();
	}

	const fees = new Map();
	let unmatched = 0;

	for (const leg of feeLegs) {
		const entries = principal[leg.token];
		const want = -leg.amount;
		let idx = -1;

		if (entries) {
			idx = entries.findIndex((e) => e.value === want && accountKey(e.otherAccount) === leg.to);
			if (idx === -1) {
				idx = entries.findIndex((e) => e.value === want);
			}
		}

		if (idx === -1) {
			unmatched++;
			continue;
		}

		entries.splice(idx, 1);
		fees.set(leg.token, (fees.get(leg.token) || 0n) + leg.amount);
	}

	for (const token of Object.keys(principal)) {
		if (principal[token].length === 0) {
			delete principal[token];
		}
	}

	return ({ principal, fees, unmatched });
}

/*
 * Turn the extracted fee totals into something the CSV can carry.
 *
 * CoinLedger has ONE fee currency column, so a fee split across two tokens has
 * nowhere to go. Every fee observed on mainnet is paid in the base token, but
 * `computeFeeBlock` allows `selectedFee.token`, so this is possible in
 * principle and is flagged rather than silently halved.
 */
function resolveFee(fees, tokens) {
	if (!fees || fees.size === 0) {
		return ({ fee: null, flags: [] });
	}

	if (fees.size > 1) {
		return ({
			fee: null,
			flags: [{
				reason: REASONS.MULTI_TOKEN_FEE,
				tokens: [...fees.keys()]
			}]
		});
	}

	const [token, amount] = [...fees.entries()][0];
	const info = (tokens && tokens.get) ? tokens.get(token) : undefined;

	/* An unpriceable divisor for the fee must not poison the principal row:
	 * the row is still emitted, just without a fee figure we cannot express. */
	if (!info || info.exportable !== true) {
		return ({
			fee: null,
			flags: [{
				reason: REASONS.UNRESOLVED_FEE_TOKEN,
				token: token,
				status: info ? info.status : 'not resolved',
				rawAmount: amount.toString()
			}]
		});
	}

	return ({
		fee: { token: token, symbol: info.symbol, decimals: info.decimals, amount: amount },
		flags: []
	});
}

/*
 * Net the per-token balance deltas for our account across one staple.
 * Returns Map<tokenAddress, { net: bigint, counterparties: Set<string> }>.
 */
function netDeltasByToken(balanceField) {
	const nets = new Map();

	for (const [token, entries] of Object.entries(balanceField)) {
		let net = 0n;
		/*
		 * Gross flows are tracked separately from the net because netting can
		 * conceal a real movement: a staple that receives 5 KTA and sends 3 KTA
		 * nets to a single 2 KTA withdrawal, and the 5 KTA receipt vanishes
		 * from the report entirely. The netted figure is still what we emit
		 * (one staple, one economic event) but when BOTH directions are
		 * present the user needs to see both legs.
		 */
		let grossIn = 0n;
		let grossOut = 0n;
		const counterpartiesIn = new Set();
		const counterpartiesOut = new Set();
		const counterparties = new Set();

		for (const entry of entries) {
			/* value is a signed bigint. The sign IS the direction. */
			if (typeof entry.value === 'bigint') {
				net += entry.value;
				if (entry.value > 0n) {
					grossIn += entry.value;
				} else if (entry.value < 0n) {
					grossOut += -entry.value;
				}
			}

			const other = entry.otherAccount;
			if (other) {
				const key = other.publicKeyString !== undefined ? String(other.publicKeyString) : String(other);
				counterparties.add(key);
				if (typeof entry.value === 'bigint' && entry.value > 0n) {
					counterpartiesIn.add(key);
				} else if (typeof entry.value === 'bigint' && entry.value < 0n) {
					counterpartiesOut.add(key);
				}
			}
		}

		nets.set(token, {
			net: net,
			grossIn: grossIn,
			grossOut: grossOut,
			counterparties: counterparties,
			counterpartiesIn: counterpartiesIn,
			counterpartiesOut: counterpartiesOut
		});
	}

	return (nets);
}

/*
 * Is this timestamp close enough to a year boundary that the ~80s spread
 * between block.date and staple.timestamp() could move it into another tax
 * year? Observed divergence ranges -69s..+82s, so a 2 minute window covers it.
 */
function nearYearBoundary(date) {
	const year = date.getUTCFullYear();
	const boundaries = [
		Date.UTC(year, 0, 1, 0, 0, 0, 0),
		Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)
	];

	return (boundaries.some((b) => Math.abs(date.getTime() - b) <= YEAR_BOUNDARY_WINDOW_MS));
}

/*
 * Build one Deposit/Withdrawal row for a single token's net movement.
 *
 * Shared by the single-token path and by the multi-token-out path, so a staple
 * that disposes of two tokens at once emits two rows that are built by exactly
 * the same rules as a staple that disposes of one.
 */
function buildTransferResult(leg, args) {
	const { stapleHash, timestamp, effects, bridgeAnchors, fee } = args;
	const token = leg.token;
	const movement = leg.movement;
	const tokenInfo = leg.info;

	const isIncoming = movement.net > 0n;
	const magnitude = isIncoming ? movement.net : -movement.net;

	const flags = [];

	if (tokenInfo.priceable !== true) {
		flags.push({ reason: REASONS.UNPRICEABLE, symbol: tokenInfo.symbol, token: token });
	}

	/*
	 * Bridge detection is a POSITIVE signal only. A non-match is NOT evidence
	 * that a send was not a bridge -- only two bridge anchors are registry
	 * declared. The row is still emitted; it is just never emitted as a clean
	 * withdrawal.
	 */
	const matchedAnchors = [...movement.counterparties].filter((c) => bridgeAnchors.has(c));
	if (matchedAnchors.length > 0) {
		flags.push({
			reason: REASONS.POSSIBLE_BRIDGE,
			anchors: matchedAnchors.map((a) => ({ address: a, name: bridgeAnchors.get(a).name }))
		});
	}

	/*
	 * Both directions moved within this one staple, so the netted row hides a
	 * leg. Emit the net (it is the real economic change) but surface both gross
	 * figures so the user can see what was collapsed.
	 */
	if (movement.grossIn > 0n && movement.grossOut > 0n) {
		const hiddenLeg = movement.grossIn < movement.grossOut ? movement.grossIn : movement.grossOut;
		/* Threshold is expressed in the TOKEN's own decimals, not the base
		 * token's. A 6-decimal token's reporting floor is not KTA's. */
		const dustLimit = parseUnits(DUST_THRESHOLD_KTA, tokenInfo.decimals);

		flags.push({
			reason: REASONS.GROSS_FLOW,
			grossIn: movement.grossIn,
			grossOut: movement.grossOut,
			net: movement.net,
			hiddenLeg: hiddenLeg,
			suppressed: hiddenLeg < dustLimit,
			counterpartiesIn: [...movement.counterpartiesIn],
			counterpartiesOut: [...movement.counterpartiesOut]
		});
	}

	if (nearYearBoundary(timestamp)) {
		flags.push({ reason: REASONS.YEAR_BOUNDARY });
	}

	return ({
		row: {
			stapleHash: stapleHash,
			timestamp: timestamp,
			kind: 'transfer',
			direction: isIncoming ? 'in' : 'out',
			type: isIncoming ? 'Deposit' : 'Withdrawal',
			token: token,
			symbol: tokenInfo.symbol,
			decimals: tokenInfo.decimals,
			amount: magnitude,
			counterparties: [...movement.counterparties],
			fee: fee || null,
			memo: null
		},
		flags: flags
	});
}

/*
 * Classify a single staple into either CSV row(s) or a flag.
 *
 * Returns one of:
 *   { kind: 'skip' }                     non-financial, no balance field
 *   { kind: 'row', row, flags: [...] }   emit to CSV (may still carry flags)
 *   { kind: 'rows', rows: [{row, flags}] } several disposals in one staple
 *   { kind: 'flag', reason, detail }     excluded from CSV, goes to FLAGGED.md
 */
function classifyStaple(entry, ctx) {
	const { ourKey, bridgeAnchors, tokens } = ctx;

	const stapleHash = String(entry.voteStaple.hash);
	const effects = entry.effects;
	const ourEffect = effects && effects.accounts ? effects.accounts[ourKey] : undefined;

	/*
	 * No balance field => non-financial event (permission change, info update,
	 * certificate publish, username claim). Ordinary users DO accumulate these.
	 * Skipping is correct; emitting a zero-amount row is not.
	 */
	if (!ourEffect || !ourEffect.fields || ourEffect.fields.balance === undefined) {
		return ({ kind: 'skip', stapleHash: stapleHash });
	}

	let timestamp = null;
	try {
		timestamp = entry.voteStaple.timestamp();
	} catch {
		timestamp = null;
	}

	if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
		return ({
			kind: 'flag',
			reason: REASONS.NO_TIMESTAMP,
			detail: { stapleHash: stapleHash }
		});
	}

	/*
	 * Pull the network fee out FIRST. Everything below classifies principal
	 * movement only; the fee is carried separately onto the row.
	 */
	const feeLegs = extractFeeLegs(entry.voteStaple, ourKey);
	const stripped = stripFeeEntries(ourEffect.fields.balance, feeLegs);
	const feeInfo = resolveFee(stripped.fees, tokens);

	const nets = netDeltasByToken(stripped.principal);

	/* Only tokens with a non-zero net movement are economically meaningful. */
	const moved = [...nets.entries()].filter(([, v]) => v.net !== 0n);

	if (moved.length === 0) {
		/*
		 * Nothing moved except the fee. This IS a disposal of the fee asset,
		 * but a CoinLedger row needs an asset in the sent or received columns,
		 * and a fee-only row is undocumented. Surface it rather than invent a
		 * shape for it or drop a real disposal silently.
		 */
		if (stripped.fees.size > 0) {
			return ({
				kind: 'flag',
				reason: REASONS.FEE_ONLY,
				detail: {
					stapleHash: stapleHash,
					timestamp: timestamp,
					feeDisplay: feeInfo.fee
						? { symbol: feeInfo.fee.symbol, amount: feeInfo.fee.amount, decimals: feeInfo.fee.decimals }
						: null
				}
			});
		}

		return ({
			kind: 'flag',
			reason: REASONS.NET_ZERO,
			detail: {
				stapleHash: stapleHash,
				timestamp: timestamp,
				tokens: [...nets.keys()]
			}
		});
	}

	/*
	 * Resolve every token that moved. `tokens` is a Map built by lib/tokens.js
	 * from ON-CHAIN metadata, cross-checked against the registry. A token is
	 * only exportable if its divisor is known and unambiguous.
	 */
	const legs = moved.map(([token, v]) => ({
		token: token,
		movement: v,
		info: tokens && tokens.get ? tokens.get(token) : undefined,
		net: v.net,
		direction: v.net > 0n ? 'in' : 'out'
	}));

	const unresolved = legs.filter((l) => !l.info || l.info.exportable !== true);
	if (unresolved.length > 0) {
		/*
		 * Any leg we cannot value poisons the whole staple. Emitting the other
		 * leg alone would turn one trade into a phantom one-sided transfer.
		 */
		const excluded = unresolved.filter((l) => l.info && l.info.status === TOKEN_STATUS.EXCLUDED);
		return ({
			kind: 'flag',
			reason: excluded.length > 0 ? REASONS.EXCLUDED_TOKEN : REASONS.UNRESOLVED_TOKEN,
			detail: {
				stapleHash: stapleHash,
				timestamp: timestamp,
				legs: legs.map((l) => ({
					token: l.token,
					symbol: l.info ? l.info.symbol : null,
					status: l.info ? l.info.status : 'not resolved',
					excludedReason: l.info ? l.info.excludedReason : null,
					onChainDecimals: l.info ? l.info.onChainDecimals : null,
					registryDecimals: l.info ? l.info.registryDecimals : null,
					net: l.net.toString(),
					direction: l.direction
				}))
			}
		});
	}

	const outLegs = legs.filter((l) => l.direction === 'out');
	const inLegs = legs.filter((l) => l.direction === 'in');

	/*
	 * TRADE: exactly one token out and one token in.
	 *
	 * This is the shape of 1,964 of 1,965 real mainnet swaps. It maps directly
	 * onto CoinLedger's Universal template: sent pair and received pair on ONE
	 * row, Type left blank (the importer infers a trade when both pairs are
	 * populated).
	 *
	 * Routing/aggregator fees paid to a market maker stay netted into these
	 * figures -- they are part of the price of the trade. Only the PROTOCOL fee
	 * from the fee block is broken out into the fee columns.
	 */
	if (moved.length > 1) {
		if (outLegs.length !== 1 || inLegs.length !== 1) {
			/*
			 * Several tokens out and NOTHING in is not a trade -- a trade needs
			 * something received. It is a transfer of each token, so emit one
			 * disposal row per token rather than dropping the staple.
			 *
			 * Before fee extraction this branch was the MULTI_LEG defect: a
			 * plain USDC send plus its KTA fee looked like "two tokens out,
			 * none in", and a real disposal was silently excluded. Fees are now
			 * removed above, so anything still here is genuine principal.
			 *
			 * The fee attaches to the FIRST row only. Repeating it on each row
			 * would dispose of the same KTA several times over.
			 */
			if (inLegs.length === 0) {
				return ({
					kind: 'rows',
					rows: outLegs.map((leg, i) => buildTransferResult(leg, {
						stapleHash: stapleHash,
						timestamp: timestamp,
						effects: effects,
						bridgeAnchors: bridgeAnchors,
						fee: i === 0 ? feeInfo.fee : null
					}))
				});
			}

			/*
			 * Tokens IN with none out stays flagged. A fee is always an
			 * outflow, so this cannot be "transfer plus fee". The one real
			 * example observed is a token launch: CREATE_IDENTIFIER +
			 * SET_INFO + TOKEN_ADMIN_SUPPLY with three tokens received and none
			 * sent. Several in AND several out is also here: a CSV trade row
			 * holds one asset each way and cannot express it.
			 */
			return ({
				kind: 'flag',
				reason: REASONS.MULTI_LEG,
				detail: {
					stapleHash: stapleHash,
					timestamp: timestamp,
					inCount: inLegs.length,
					outCount: outLegs.length,
					legs: legs.map((l) => ({
						token: l.token, symbol: l.info.symbol,
						net: l.net.toString(), direction: l.direction
					}))
				}
			});
		}

		const sent = outLegs[0];
		const recv = inLegs[0];
		const tradeFlags = [];

		if (nearYearBoundary(timestamp)) {
			tradeFlags.push({ reason: REASONS.YEAR_BOUNDARY });
		}
		for (const l of [sent, recv]) {
			if (l.info.priceable !== true) {
				tradeFlags.push({ reason: REASONS.UNPRICEABLE, symbol: l.info.symbol, token: l.token });
			}
		}

		return ({
			kind: 'row',
			row: {
				stapleHash: stapleHash,
				timestamp: timestamp,
				type: 'Trade',
				kind: 'trade',
				sent: { token: sent.token, symbol: sent.info.symbol, decimals: sent.info.decimals, amount: -sent.net },
				received: { token: recv.token, symbol: recv.info.symbol, decimals: recv.info.decimals, amount: recv.net },
				counterparties: [...new Set([...sent.movement.counterparties, ...recv.movement.counterparties])],
				fee: feeInfo.fee,
				memo: null
			},
			flags: tradeFlags.concat(feeInfo.flags)
		});
	}

	/* ---- single token: deposit or withdrawal ---- */
	const result = buildTransferResult(legs[0], {
		stapleHash: stapleHash,
		timestamp: timestamp,
		effects: effects,
		bridgeAnchors: bridgeAnchors,
		fee: feeInfo.fee
	});

	return ({
		kind: 'row',
		row: result.row,
		flags: result.flags.concat(feeInfo.flags)
	});
}

const API = {
	classifyStaple, netDeltasByToken, nearYearBoundary,
	extractFeeLegs, stripFeeEntries, resolveFee, buildTransferResult,
	REASONS, YEAR_BOUNDARY_WINDOW_MS, DUST_THRESHOLD_KTA, BLOCK_PURPOSE_FEE
};

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
