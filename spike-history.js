/*
 * Phase 1 spike: pull complete transaction history for a Keeta account from
 * mainnet and dump the raw result to JSON so we can see the real shape.
 *
 * Usage:  node spike-history.js <keeta_public_key>
 *
 * READ-ONLY. Public key only -- this script never accepts or handles a seed
 * or private key. The client is constructed with signer=null.
 *
 * Outputs:
 *   output/history-raw.json  -- full raw dump (staples + effects + token info)
 *   console                  -- summary report
 */

const fs = require('fs');
const path = require('path');
const { UserClient, lib: KeetaNetLib } = require('@keetanetwork/keetanet-client');

const OUT_DIR = path.join(__dirname, 'output');
const OUT_FILE = path.join(OUT_DIR, 'history-raw.json');

/* OperationType is a numeric enum on the wire; map it back to readable tags. */
const OPERATION_TYPE_NAMES = [
	'SEND', 'SET_REP', 'SET_INFO', 'MODIFY_PERMISSIONS', 'CREATE_IDENTIFIER',
	'TOKEN_ADMIN_SUPPLY', 'TOKEN_ADMIN_MODIFY_BALANCE', 'RECEIVE', 'MANAGE_CERTIFICATE'
];

const SEND_TYPE = 0;
const RECEIVE_TYPE = 7;

function operationTypeName(type) {
	return (OPERATION_TYPE_NAMES[type] ?? `UNKNOWN(${String(type)})`);
}

/*
 * Account-like SDK objects have NO useful toString() -- String(account) yields
 * "[object Object]". The public key lives on .publicKeyString. Always go
 * through this helper; never String() an account, token, or address.
 */
function accountKey(value) {
	if (value === null || value === undefined) {
		return (null);
	}

	if (typeof value === 'string') {
		return (value);
	}

	if (value.publicKeyString !== undefined && value.publicKeyString !== null) {
		return (String(value.publicKeyString));
	}

	return (String(value));
}

/*
 * Amounts in Block.toJSON() are hex strings ("0x1"); on live objects they are
 * bigint. Normalize to a decimal string without going through Number, which
 * would silently lose precision on large token amounts.
 */
function amountToDecimalString(value) {
	if (value === null || value === undefined) {
		return (null);
	}

	if (typeof value === 'bigint') {
		return (value.toString());
	}

	if (typeof value === 'string') {
		try {
			return (BigInt(value).toString());
		} catch {
			return (value);
		}
	}

	return (String(value));
}

/*
 * Guard against a seed/private key being passed in by mistake.
 */
function assertPublicKeyOnly(arg) {
	if (/^[0-9a-fA-F]{64}$/.test(arg)) {
		throw new Error('That looks like a 64-character hex SEED, not a public key. This tool is public-key only -- never pass a seed or private key.');
	}

	if (!arg.startsWith('keeta_')) {
		throw new Error(`Expected a Keeta public key starting with "keeta_", got: ${arg.slice(0, 12)}...`);
	}
}

/*
 * JSON.stringify THROWS on bigint, so every one is tagged explicitly -- never
 * coerced to Number.
 *
 * Cycle detection tracks the CURRENT PATH only (add on enter, remove on exit).
 * A shared WeakSet across the whole traversal would mark legitimately-repeated
 * objects -- e.g. the same counterparty account appearing in several balance
 * entries -- as "[circular]" and destroy real data.
 */
function serialize(value, path = new Set()) {
	if (value === null || value === undefined) {
		return (value ?? null);
	}

	if (typeof value === 'bigint') {
		return ({ __bigint: value.toString() });
	}

	if (typeof value !== 'object') {
		return (value);
	}

	if (value instanceof Date) {
		return ({ __date: value.toISOString(), epochMs: value.getTime() });
	}

	if (Buffer.isBuffer(value)) {
		return ({ __buffer_base64: value.toString('base64') });
	}

	if (value.publicKeyString !== undefined && value.publicKeyString !== null) {
		return ({ __account: String(value.publicKeyString) });
	}

	if (path.has(value)) {
		return ('[circular]');
	}
	path.add(value);

	let out;
	if (Array.isArray(value)) {
		out = value.map((entry) => serialize(entry, path));
	} else if (value instanceof Set || value instanceof Map) {
		out = Array.from(value.values()).map((entry) => serialize(entry, path));
	} else if (typeof value.toJSON === 'function') {
		out = serialize(value.toJSON(), path);
	} else {
		out = {};
		for (const [key, entry] of Object.entries(value)) {
			out[key] = serialize(entry, path);
		}
	}

	path.delete(value);

	return (out);
}

/*
 * Token metadata is a free-form string with no enforced schema. Dump every
 * interpretation -- decimals are not a typed field anywhere in the SDK, so this
 * string is their only possible home.
 */
function interpretMetadata(raw) {
	const result = {
		raw: raw ?? null,
		rawLength: typeof raw === 'string' ? raw.length : null,
		base64Decoded: null,
		parsedJSON: null,
		decimalsCandidate: null,
		notes: []
	};

	if (typeof raw !== 'string' || raw.length === 0) {
		result.notes.push('metadata is empty or not a string');
		return (result);
	}

	try {
		result.parsedJSON = JSON.parse(raw);
		result.notes.push('parsed as plain JSON (not base64)');
	} catch {
		try {
			const decoded = Buffer.from(raw, 'base64').toString('utf8');
			result.base64Decoded = decoded;
			try {
				result.parsedJSON = JSON.parse(decoded);
				result.notes.push('parsed as base64-encoded JSON');
			} catch {
				result.notes.push('base64-decoded but not valid JSON');
			}
		} catch {
			result.notes.push('not valid base64 and not valid JSON');
		}
	}

	if (result.parsedJSON && typeof result.parsedJSON === 'object') {
		for (const key of ['decimals', 'decimalPlaces', 'decimal_places', 'precision', 'scale']) {
			if (result.parsedJSON[key] !== undefined) {
				result.decimalsCandidate = { key: key, value: result.parsedJSON[key] };
				break;
			}
		}

		if (result.decimalsCandidate === null) {
			result.notes.push(`no decimals-like key; top-level keys: ${Object.keys(result.parsedJSON).join(', ') || '(none)'}`);
		}
	}

	if (result.decimalsCandidate === null) {
		result.notes.push('DECIMALS UNRESOLVABLE from metadata');
	}

	return (result);
}

async function main() {
	const pubKey = process.argv[2];

	if (!pubKey) {
		console.error('Usage: node spike-history.js <keeta_public_key>');
		process.exit(1);
	}

	assertPublicKeyOnly(pubKey);

	const account = KeetaNetLib.Account.fromPublicKeyString(pubKey);
	const client = UserClient.fromNetwork('main', null, { account: account });

	const baseToken = accountKey(client.baseToken);

	console.log(`network:    main`);
	console.log(`account:    ${pubKey}`);
	console.log(`base token: ${baseToken}`);
	console.log('');
	console.log('fetching history (client.history() paginates internally)...');

	const started = Date.now();
	const history = await client.history();
	const elapsedMs = Date.now() - started;

	console.log(`got ${history.length} vote staples in ${elapsedMs}ms`);

	const staples = history.map((entry) => entry.voteStaple);

	let filteredOperations = null;
	let filterError = null;
	try {
		filteredOperations = client.filterStapleOperations(staples);
	} catch (err) {
		filterError = String(err && err.message ? err.message : err);
	}

	const stats = {
		stapleCount: history.length,
		withBalanceField: 0,
		withoutBalanceField: 0,
		accountAbsentFromEffects: 0,
		multiBlockStaples: 0,
		staplesWithNonZeroFee: 0,
		operationTypeCounts: {},
		distinctTokens: new Set(),

		/* Priority 1: does RECEIVE ever appear WITHOUT a SEND in the same block? */
		blocksWithSendOnly: 0,
		blocksWithReceiveOnly: 0,
		blocksWithBoth: 0,
		blocksWithNeither: 0,
		swapCandidateBlocks: 0,

		/* Priority 2: is the balance delta usable as the primary row source? */
		balanceEntriesTotal: 0,
		balanceEntriesPositive: 0,
		balanceEntriesNegative: 0,
		balanceEntriesZero: 0,
		balanceIsReceiveTrue: 0,
		balanceIsReceiveFalse: 0,
		balanceReceivableTrue: 0,
		balanceReceivableFalse: 0,
		balanceOtherAccountPresent: 0,
		balanceOtherAccountMissing: 0,

		/* Decisive test for the two-step model: positive delta with no RECEIVE op */
		staplesPositiveDeltaNoReceiveOp: 0,
		staplesPositiveDelta: 0
	};

	const timestampSpreads = [];
	/* For the chain-continuity test: blocks belonging to OUR account */
	const ourBlocks = [];

	const entries = history.map((entry) => {
		const staple = entry.voteStaple;

		let stapleTimestamp = null;
		let timestampError = null;
		try {
			stapleTimestamp = staple.timestamp();
		} catch (err) {
			timestampError = String(err && err.message ? err.message : err);
		}

		if (staple.blocks.length > 1) {
			stats.multiBlockStaples++;
		}

		const feeUnits = entry.effects?.metadata?.feeUnits;
		if (typeof feeUnits === 'bigint' && feeUnits !== 0n) {
			stats.staplesWithNonZeroFee++;
		}

		/*
		 * Read block/operation detail from the staple's own toJSON(), which
		 * emits clean strings. Walking the live objects requires accountKey()
		 * on every field and is easy to get wrong.
		 */
		const stapleJSON = staple.toJSON();

		let stapleHasReceiveOp = false;

		const blockDetails = (stapleJSON.blocks ?? []).map((block, blockIndex) => {
			const ops = (block.operations ?? []).map((op) => {
				const typeName = operationTypeName(op.type);
				stats.operationTypeCounts[typeName] = (stats.operationTypeCounts[typeName] ?? 0) + 1;

				if (op.token) {
					stats.distinctTokens.add(op.token);
				}

				if (op.type === RECEIVE_TYPE) {
					stapleHasReceiveOp = true;
				}

				return ({
					type: op.type,
					typeName: typeName,
					token: op.token ?? null,
					amount: amountToDecimalString(op.amount),
					to: op.to ?? null,
					from: op.from ?? null,
					external: op.external ?? null,
					exact: op.exact ?? null,
					forward: op.forward ?? null
				});
			});

			const sendOps = ops.filter((op) => op.type === SEND_TYPE);
			const receiveOps = ops.filter((op) => op.type === RECEIVE_TYPE);

			if (sendOps.length > 0 && receiveOps.length > 0) {
				stats.blocksWithBoth++;
			} else if (sendOps.length > 0) {
				stats.blocksWithSendOnly++;
			} else if (receiveOps.length > 0) {
				stats.blocksWithReceiveOnly++;
			} else {
				stats.blocksWithNeither++;
			}

			/* Swap rule: SEND + RECEIVE in one block across differing tokens */
			const sendTokens = new Set(sendOps.map((op) => op.token).filter(Boolean));
			const receiveTokens = new Set(receiveOps.map((op) => op.token).filter(Boolean));
			const tokensDiffer = [...sendTokens].some((t) => !receiveTokens.has(t)) ||
				[...receiveTokens].some((t) => !sendTokens.has(t));
			const isSwapCandidate = sendTokens.size > 0 && receiveTokens.size > 0 && tokensDiffer;

			if (isSwapCandidate) {
				stats.swapCandidateBlocks++;
			}

			/* Compare consensus timestamp against creator-asserted block.date */
			let spreadMs = null;
			const blockDate = block.date ? new Date(block.date) : null;
			if (stapleTimestamp instanceof Date && blockDate && !isNaN(blockDate.getTime())) {
				spreadMs = stapleTimestamp.getTime() - blockDate.getTime();
				timestampSpreads.push(spreadMs);
			}

			if (block.account === pubKey) {
				ourBlocks.push({
					hash: block.$hash,
					previous: block.previous ?? null,
					opening: block.$opening ?? null,
					date: block.date ?? null
				});
			}

			return ({
				index: blockIndex,
				hash: block.$hash ?? null,
				account: block.account ?? null,
				signer: block.signer ?? null,
				previous: block.previous ?? null,
				opening: block.$opening ?? null,
				purpose: block.purpose ?? null,
				blockDate: block.date ?? null,
				stapleMinusBlockDateMs: spreadMs,
				isSwapCandidate: isSwapCandidate,
				operations: ops
			});
		});

		/* Balance-delta analysis for our account */
		const ourEffect = entry.effects?.accounts?.[pubKey];
		let ourBalanceSummary = null;
		let hasPositiveDelta = false;

		if (ourEffect === undefined) {
			stats.accountAbsentFromEffects++;
		} else if (ourEffect.fields?.balance !== undefined) {
			stats.withBalanceField++;
			ourBalanceSummary = {};

			for (const [tokenKey, tokenEntries] of Object.entries(ourEffect.fields.balance)) {
				stats.distinctTokens.add(tokenKey);
				ourBalanceSummary[tokenKey] = tokenEntries.map((tokenEntry) => {
					stats.balanceEntriesTotal++;

					const value = tokenEntry.value;
					if (typeof value === 'bigint') {
						if (value > 0n) {
							stats.balanceEntriesPositive++;
							hasPositiveDelta = true;
						} else if (value < 0n) {
							stats.balanceEntriesNegative++;
						} else {
							stats.balanceEntriesZero++;
						}
					}

					if (tokenEntry.isReceive === true) {
						stats.balanceIsReceiveTrue++;
					} else {
						stats.balanceIsReceiveFalse++;
					}

					if (tokenEntry.receivable === true) {
						stats.balanceReceivableTrue++;
					} else if (tokenEntry.receivable === false) {
						stats.balanceReceivableFalse++;
					}

					if (tokenEntry.otherAccount) {
						stats.balanceOtherAccountPresent++;
					} else {
						stats.balanceOtherAccountMissing++;
					}

					return ({
						value: typeof value === 'bigint' ? value.toString() : null,
						isReceive: tokenEntry.isReceive ?? null,
						receivable: tokenEntry.receivable ?? null,
						set: tokenEntry.set ?? null,
						exact: tokenEntry.exact ?? null,
						otherAccount: accountKey(tokenEntry.otherAccount)
					});
				});
			}
		} else {
			stats.withoutBalanceField++;
		}

		/*
		 * The decisive two-step-model test: if our balance goes UP on a staple
		 * that contains no RECEIVE operation at all, then a plain SEND credits
		 * the recipient directly and no explicit receive step is required.
		 */
		if (hasPositiveDelta) {
			stats.staplesPositiveDelta++;
			if (!stapleHasReceiveOp) {
				stats.staplesPositiveDeltaNoReceiveOp++;
			}
		}

		return ({
			stapleHash: String(staple.hash),
			blocksHash: String(staple.blocksHash),
			stapleTimestamp: serialize(stapleTimestamp),
			stapleTimestampError: timestampError,
			blockCount: staple.blocks.length,
			feeUnits: typeof feeUnits === 'bigint' ? feeUnits.toString() : null,
			hasBalanceForOurAccount: ourEffect?.fields?.balance !== undefined,
			ourBalanceDeltas: ourBalanceSummary,
			hasReceiveOp: stapleHasReceiveOp,
			blocks: blockDetails,
			voteStaple: serialize(staple),
			effects: serialize(entry.effects)
		});
	});

	/* ---- Token metadata lookups ---- */
	console.log(`resolving info for ${stats.distinctTokens.size} distinct token(s)...`);

	const tokenInfo = {};
	for (const tokenAddress of stats.distinctTokens) {
		try {
			const info = await client.state({ account: KeetaNetLib.Account.fromPublicKeyString(tokenAddress) });
			tokenInfo[tokenAddress] = {
				isBaseToken: tokenAddress === baseToken,
				name: info?.name ?? null,
				description: info?.description ?? null,
				supply: typeof info?.supply === 'bigint' ? info.supply.toString() : null,
				metadata: interpretMetadata(info?.metadata),
				rawInfo: serialize(info)
			};
		} catch (err) {
			tokenInfo[tokenAddress] = {
				isBaseToken: tokenAddress === baseToken,
				error: String(err && err.message ? err.message : err)
			};
		}
	}

	/* ---- Chain-continuity check (pagination completeness) ---- */
	const ourBlockHashes = new Set(ourBlocks.map((block) => block.hash));
	const openingBlocks = ourBlocks.filter((block) => block.opening === true);
	const danglingPrevious = ourBlocks.filter((block) =>
		block.opening !== true && block.previous && !ourBlockHashes.has(block.previous));

	const chainCheck = {
		ourBlockCount: ourBlocks.length,
		openingBlockCount: openingBlocks.length,
		danglingPreviousCount: danglingPrevious.length,
		danglingPreviousSample: danglingPrevious.slice(0, 5).map((block) => ({
			hash: block.hash, previous: block.previous, date: block.date
		})),
		unbrokenChain: openingBlocks.length === 1 && danglingPrevious.length === 0
	};

	/* ---- Timestamp spread ---- */
	let spreadSummary = null;
	if (timestampSpreads.length > 0) {
		const sorted = [...timestampSpreads].sort((left, right) => left - right);
		const sum = sorted.reduce((acc, value) => acc + value, 0);
		spreadSummary = {
			samples: sorted.length,
			minMs: sorted[0],
			maxMs: sorted[sorted.length - 1],
			medianMs: sorted[Math.floor(sorted.length / 2)],
			meanMs: Math.round(sum / sorted.length),
			negativeCount: sorted.filter((value) => value < 0).length
		};
	}

	const summary = {
		...stats,
		distinctTokens: [...stats.distinctTokens],
		distinctTokenCount: stats.distinctTokens.size,
		timestampSpread: spreadSummary,
		chainCheck: chainCheck
	};

	const output = {
		meta: {
			generatedAt: new Date().toISOString(),
			network: 'main',
			account: pubKey,
			baseToken: baseToken,
			sdkVersion: require('@keetanetwork/keetanet-client/package.json').version,
			fetchMs: elapsedMs,
			method: 'UserClient.history()'
		},
		summary: summary,
		tokenInfo: tokenInfo,
		filteredOperations: serialize(filteredOperations),
		filterError: filterError,
		entries: entries
	};

	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

	/* ---- Console report ---- */
	console.log('');
	console.log('=================== SUMMARY ===================');
	console.log(`vote staples:                 ${summary.stapleCount}`);
	console.log(`  with balance change (ours): ${summary.withBalanceField}`);
	console.log(`  without balance field:      ${summary.withoutBalanceField}   <- non-financial, skip in CSV`);
	console.log(`  our account not in effects: ${summary.accountAbsentFromEffects}`);
	console.log(`multi-block staples:          ${summary.multiBlockStaples}`);
	console.log(`staples with non-zero fee:    ${summary.staplesWithNonZeroFee}`);
	console.log('');
	console.log('--- PRIORITY 1: SEND/RECEIVE co-occurrence (per block) ---');
	console.log(`  SEND only:                  ${summary.blocksWithSendOnly}`);
	console.log(`  RECEIVE only:               ${summary.blocksWithReceiveOnly}   <- if >0, incoming arrives as RECEIVE`);
	console.log(`  both SEND and RECEIVE:      ${summary.blocksWithBoth}`);
	console.log(`  neither:                    ${summary.blocksWithNeither}`);
	console.log(`  swap candidates:            ${summary.swapCandidateBlocks}`);
	console.log('');
	console.log(`  staples w/ positive delta:              ${summary.staplesPositiveDelta}`);
	console.log(`  ...of those, with NO receive op:        ${summary.staplesPositiveDeltaNoReceiveOp}   <- if equal, SEND credits directly`);
	console.log('');
	console.log('--- PRIORITY 2: balance deltas as row source ---');
	console.log(`  total balance entries:      ${summary.balanceEntriesTotal}`);
	console.log(`    positive:                 ${summary.balanceEntriesPositive}`);
	console.log(`    negative:                 ${summary.balanceEntriesNegative}`);
	console.log(`    zero:                     ${summary.balanceEntriesZero}`);
	console.log(`  isReceive true/false:       ${summary.balanceIsReceiveTrue} / ${summary.balanceIsReceiveFalse}`);
	console.log(`  receivable true/false:      ${summary.balanceReceivableTrue} / ${summary.balanceReceivableFalse}`);
	console.log(`  otherAccount present/miss:  ${summary.balanceOtherAccountPresent} / ${summary.balanceOtherAccountMissing}`);
	console.log('');
	console.log('operation types encountered:');
	for (const [name, count] of Object.entries(summary.operationTypeCounts).sort((l, r) => r[1] - l[1])) {
		console.log(`  ${name.padEnd(28)} ${count}`);
	}
	console.log('');
	console.log(`--- PRIORITY 5: tokens (${summary.distinctTokenCount}) ---`);
	for (const [address, info] of Object.entries(tokenInfo)) {
		const label = info.isBaseToken ? '  (BASE/KTA)' : '';
		const dec = info.metadata?.decimalsCandidate;
		console.log(`  ${address}${label}`);
		console.log(`    name:     ${info.name ?? info.error ?? '(none)'}`);
		console.log(`    decimals: ${dec ? `${dec.value} (via "${dec.key}")` : 'UNRESOLVED'}`);
		if (info.metadata) {
			console.log(`    metadata: ${(info.metadata.raw ?? '(empty)').toString().slice(0, 80)}`);
			console.log(`    notes:    ${info.metadata.notes.join('; ')}`);
		}
	}
	console.log('');
	console.log('--- PRIORITY 3: timestamps ---');
	if (spreadSummary) {
		console.log(`  staple.timestamp() minus block.date (ms):`);
		console.log(`    samples=${spreadSummary.samples} min=${spreadSummary.minMs} median=${spreadSummary.medianMs} mean=${spreadSummary.meanMs} max=${spreadSummary.maxMs}`);
		console.log(`    negative (staple BEFORE block): ${spreadSummary.negativeCount}`);
	} else {
		console.log('  no comparable samples');
	}
	console.log('');
	console.log('--- PRIORITY 4: chain continuity (our account blocks) ---');
	console.log(`  our blocks:                 ${chainCheck.ourBlockCount}`);
	console.log(`  opening blocks:             ${chainCheck.openingBlockCount}  (expect exactly 1)`);
	console.log(`  dangling previous pointers: ${chainCheck.danglingPreviousCount}  (expect 0)`);
	console.log(`  UNBROKEN CHAIN:             ${chainCheck.unbrokenChain}`);
	console.log('===============================================');
	console.log('');
	console.log(`wrote ${OUT_FILE}`);

	client.destroy();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
