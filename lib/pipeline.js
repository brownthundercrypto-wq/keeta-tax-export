/*
 * Shared conversion pipeline. Runs unchanged in Node (convert.js) and in the
 * browser (web/app.js).
 *
 * Everything that decides what appears in a user's tax report lives here, so
 * there is exactly one implementation of it. The CLI and the web page differ
 * only in how they obtain the history and where they put the output files.
 * A second implementation of this logic is how a divergence ships without
 * either side looking wrong on its own.
 */

/*
 * IIFE-wrapped: the browser loads these as plain <script> tags and classic
 * scripts share ONE global scope. Top-level const/function names would collide
 * across lib files into a parse-time SyntaxError, which silently prevents the
 * file from registering. Cross-file access goes through globalThis.KeetaTax.
 */
(function () {
'use strict';

const _fmt = (typeof require === 'function') ? require('./format') : globalThis.KeetaTax;
const _cls = (typeof require === 'function') ? require('./classify') : globalThis.KeetaTax;
const _tok = (typeof require === 'function') ? require('./tokens') : globalThis.KeetaTax;

const _anc = (typeof require === 'function') ? require('./anchors') : globalThis.KeetaTax;

const { formatUnits, formatCoinLedgerDate, csvRow, shortAddr } = _fmt;
const { classifyStaple, REASONS, DUST_THRESHOLD_KTA, extractFeeLegs, stripFeeEntries, extractExternals } = _cls;
const { resolveTokens } = _tok;
const { resolveAnchors, decodeExternal } = _anc;

/*
 * Decimals derive from the NETWORK, never a bare constant. KTA is 18 on
 * mainnet and 9 on testnet; a mix-up is a 10^9 error nothing downstream catches.
 */
const NETWORKS = {
	main: { alias: 'main', networkIdHex: '0x5382', baseTokenDecimals: 18, baseTokenSymbol: 'KTA' },
	test: { alias: 'test', networkIdHex: '0x54455354', baseTokenDecimals: 9, baseTokenSymbol: 'KTA' }
};

/*
 * CoinLedger Universal Manual Import template headers.
 *
 * DO NOT "TIDY" THESE. The "(Optional)" suffixes are part of the literal header
 * text. CoinLedger fingerprints the entire header row BEFORE parsing any data
 * row, so one character out of place rejects the whole file with no indication
 * of which column was wrong. A version without the suffixes -- taken from
 * CoinLedger's own help article -- caused a total rejection in testing. The
 * source of truth is the Google Sheet template, not the help article.
 *
 * test/header.test.js asserts this byte-for-byte.
 */
const CSV_HEADERS = [
	'Date (UTC)',
	'Platform (Optional)',
	'Asset Sent',
	'Amount Sent',
	'Asset Received',
	'Amount Received',
	'Fee Currency (Optional)',
	'Fee Amount (Optional)',
	'Type',
	'Description (Optional)',
	'TxHash (Optional)'
];

const CSV_HEADER_LINE = 'Date (UTC),Platform (Optional),Asset Sent,Amount Sent,Asset Received,Amount Received,Fee Currency (Optional),Fee Amount (Optional),Type,Description (Optional),TxHash (Optional)';

const PLATFORM = 'Keeta';

/*
 * Currency balances held on Keeta Personal. These export with their plain
 * tickers and are treated as cash, not as crypto assets, because they redeem
 * one for one through a regulated money-movement product with real bank
 * details, direct deposit in and ACH out. Tax software computes no gain or
 * loss on fiat, which is correct for cash.
 *
 * Listed here only so the review file can explain the treatment when they
 * appear. Nothing about their conversion is special.
 */
const FIAT_SYMBOLS = new Set(['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'HKD', 'MXN', 'CNY', 'AED']);

function assertPublicKeyOnly(arg) {
	if (typeof arg !== 'string' || arg.trim().length === 0) {
		throw new Error('Please paste a Keeta public address.');
	}

	const v = arg.trim();

	if (/^[0-9a-fA-F]{64}$/.test(v)) {
		throw new Error('That looks like a 64-character hex SEED, not a public address. This tool is public-address only. It never asks for and cannot use a seed phrase or private key. Please close this page and treat that value as compromised if you pasted it anywhere else.');
	}

	if (/\b(\w+\s+){11,}\w+\b/.test(v)) {
		throw new Error('That looks like a recovery phrase (seed words), not a public address. This tool is public-address only. It never asks for and cannot use a seed phrase or private key. Please close this page and treat that phrase as compromised if you pasted it anywhere else.');
	}

	if (!v.startsWith('keeta_')) {
		throw new Error('That does not look like a Keeta public address. It should begin with "keeta_". It is the same address you would give someone to send you KTA.');
	}

	return (v);
}

/* Build lookup maps from the shipped address book JSON. */
function indexAddressBook(book) {
	const bridgeAnchors = new Map();
	for (const a of book.bridgeAnchors || []) {
		bridgeAnchors.set(a.address, a);
	}

	const tokenRegistry = new Map();
	for (const t of book.tokens || []) {
		tokenRegistry.set(t.address, t);
	}
	/* Observed-but-unverified tokens are registered for NAMING only. Their
	 * decimals are deliberately NOT trusted -- they still hard-fail. */
	for (const t of book.unknownTokensObserved || []) {
		if (t.address && !tokenRegistry.has(t.address)) {
			tokenRegistry.set(t.address, { address: t.address, symbol: t.symbol, decimals: undefined, verified: false });
		}
	}

	return ({ bridgeAnchors, tokenRegistry });
}

/*
 * Refuse to run if the chain we fetched is not the chain we think we connected
 * to. Decimals depend on it.
 */
function assertNetworkMatches(history, expectedHex) {
	const seen = new Set();

	for (const entry of history) {
		const json = entry.voteStaple.toJSON();
		for (const block of json.blocks || []) {
			if (block.network !== undefined && block.network !== null) {
				seen.add(String(block.network));
			}
		}
	}

	const mismatched = [...seen].filter((n) => n.toLowerCase() !== expectedHex.toLowerCase());

	if (mismatched.length > 0) {
		throw new Error(
			`NETWORK MISMATCH. Refusing to run.\n` +
			`  expected network id: ${expectedHex}\n` +
			`  found in blocks:     ${[...seen].join(', ')}\n` +
			`  Decimals are derived from the network (KTA is 18 on mainnet, 9 on testnet).\n` +
			`  Continuing could produce amounts wrong by a factor of 1,000,000,000.`
		);
	}

	return ([...seen]);
}

/*
 * Pull the `external` memo off SEND operations. This is the one piece of
 * context effects do not carry, and the only reason operations are consulted.
 */
function buildMemoIndex(client, staples) {
	const memos = new Map();

	let filtered;
	try {
		filtered = client.filterStapleOperations(staples);
	} catch {
		return (memos);
	}

	for (const [stapleHash, blocks] of Object.entries(filtered || {})) {
		const found = [];
		for (const group of blocks || []) {
			for (const op of group.filteredOperations || []) {
				if (op && typeof op.external === 'string' && op.external.length > 0) {
					found.push(op.external);
				}
			}
		}
		if (found.length > 0) {
			memos.set(stapleHash, [...new Set(found)].join(' | '));
		}
	}

	return (memos);
}

function buildDescription(row) {
	const parts = [];

	if (row.kind === 'trade') {
		parts.push(`Swap ${row.sent.symbol} for ${row.received.symbol}`);
	}

	const others = row.counterparties.filter(Boolean);
	if (others.length === 1) {
		parts.push(row.kind === 'trade'
			? `With ${shortAddr(others[0])}`
			: (row.direction === 'in' ? `From ${shortAddr(others[0])}` : `To ${shortAddr(others[0])}`));
	} else if (others.length > 1) {
		parts.push(`${others.length} counterparties`);
	}

	if (row.memo) {
		parts.push(`Memo: ${row.memo}`);
	}

	const seen = new Set();
	for (const f of row.appliedFlags || []) {
		if (f.reason === REASONS.POSSIBLE_BRIDGE) {
			const names = f.anchors.map((a) => a.name).join(', ');
			parts.push(`REVIEW: possible bridge transfer via ${names}. Verify whether this was a transfer between your own holdings`);
		}
		if (f.reason === REASONS.DECLARED_ANCHOR) {
			const declared = f.anchors.map((a) => a.declared).filter(Boolean).join(', ');
			parts.push(`REVIEW: recipient describes itself as "${declared}". Verify what this transaction was`);
		}
		if (f.reason === REASONS.YEAR_BOUNDARY) {
			parts.push('REVIEW: near tax-year boundary. Confirm which year this belongs to');
		}
		if (f.reason === REASONS.UNPRICEABLE && !seen.has(f.symbol)) {
			seen.add(f.symbol);
			parts.push(`REVIEW: ${f.symbol || 'this token'} needs a custom asset and a manual price in CoinLedger`);
		}
	}

	return (parts.join('. '));
}

/*
 * Significant digits beyond which a decimal string may not survive a consumer
 * that parses to an IEEE double. 2^53 gives ~15-16 significant digits.
 *
 * This matters for 18-decimal tokens: a swap leg like
 * 24902188.797697885934532853 carries 26 significant digits. CoinLedger
 * documents NO rule for trades between assets of different precision, so we do
 * not silently round. We emit the exact value and flag the row, because a
 * quietly truncated amount is the failure mode this project exists to avoid.
 */
const SIGNIFICANT_DIGIT_LIMIT = 15;

function significantDigits(decimalStr) {
	const digits = String(decimalStr).replace('-', '').replace('.', '').replace(/^0+/, '');
	return (digits.replace(/0+$/, '').length);
}

function toCsvRow(row) {
	const dateStr = formatCoinLedgerDate(row.timestamp);
	const description = buildDescription(row);

	/*
	 * Blank fields must be genuinely blank. Never 0, never "N/A".
	 *
	 * Fee Currency / Fee Amount now carry the REAL protocol fee, taken from the
	 * staple's fee block (see lib/classify.js extractFeeLegs). CoinLedger treats
	 * a fee as a taxable disposal of the fee asset, which is the correct
	 * treatment: paying a KTA fee disposes of KTA at its value that day.
	 *
	 * They are NOT the old `feeUnits` figure. `feeUnits` is a size metric
	 * (1000/block + 10/SEND + ...), not an amount of KTA, and was never
	 * convertible to one.
	 *
	 * A separate fee row must never be emitted alongside this. Type=Withdrawal
	 * is documented as a non-taxable self-transfer, so a standalone fee row
	 * would book no disposal at all, and populating both would dispose of the
	 * same KTA twice.
	 */
	let assetSent = '', amountSent = '', assetReceived = '', amountReceived = '', type = '';
	const feeCurrency = row.fee ? row.fee.symbol : '';
	const feeAmount = row.fee ? formatUnits(row.fee.amount, row.fee.decimals) : '';

	if (row.kind === 'trade') {
		/*
		 * A trade fills BOTH pairs on ONE row. Type is left blank: CoinLedger
		 * infers a trade when both pairs are populated, and blank avoids
		 * guessing at a Type string their importer may not accept.
		 */
		assetSent = row.sent.symbol;
		amountSent = formatUnits(row.sent.amount, row.sent.decimals);
		assetReceived = row.received.symbol;
		amountReceived = formatUnits(row.received.amount, row.received.decimals);
	} else {
		const amount = formatUnits(row.amount, row.decimals);
		assetSent = row.direction === 'out' ? row.symbol : '';
		amountSent = row.direction === 'out' ? amount : '';
		assetReceived = row.direction === 'in' ? row.symbol : '';
		amountReceived = row.direction === 'in' ? amount : '';
		type = row.type;
	}

	return (csvRow([
		dateStr, PLATFORM, assetSent, amountSent, assetReceived, amountReceived,
		feeCurrency, feeAmount, type, description, row.stapleHash
	]));
}

function buildCsv(rows) {
	const headerLine = csvRow(CSV_HEADERS);

	/* Last line of defence before the file leaves the process. */
	if (headerLine !== CSV_HEADER_LINE) {
		throw new Error(
			`CSV header does not match the CoinLedger template byte-for-byte. Refusing to write.\n` +
			`  expected: ${CSV_HEADER_LINE}\n` +
			`  produced: ${headerLine}`
		);
	}

	/* CRLF line endings (RFC 4180). Caller writes as UTF-8 without BOM. */
	return ([headerLine, ...rows.map(toCsvRow)].join('\r\n') + '\r\n');
}

/*
 * Every distinct token that moved for our account, across the whole history.
 * Used to prefetch metadata ONCE per token rather than per staple.
 */
function collectTokens(history, ourKey) {
	const out = new Set();
	for (const entry of history) {
		const eff = entry.effects && entry.effects.accounts ? entry.effects.accounts[ourKey] : null;
		const bal = eff && eff.fields ? eff.fields.balance : null;
		if (!bal) { continue; }
		for (const t of Object.keys(bal)) { out.add(t); }
	}
	return ([...out]);
}

/*
 * Resolve every token the wallet touched, from ON-CHAIN metadata, cached one
 * call per distinct token. A wallet with 9 tokens across 2,000 staples makes 9
 * calls, not thousands.
 */
async function prefetchTokens(client, Account, history, ourKey, tokenRegistry, onProgress) {
	return (await resolveTokens(client, Account, collectTokens(history, ourKey), tokenRegistry, onProgress));
}

/*
 * Every distinct account we SENT principal to, across the whole history.
 *
 * Network fees are stripped first, otherwise this returns every rotating
 * representative payout address -- thousands of them on a busy wallet, none of
 * which is a bridge, each costing a network call to rule out.
 *
 * Outgoing only. Spec 5.1's risk is a send to a bridge being reported as a
 * disposal; an incoming leg carries no disposal to misreport. Registry matching
 * still covers both directions because it costs nothing.
 */
function collectOutgoingCounterparties(history, ourKey) {
	const out = new Set();

	for (const entry of history) {
		const eff = entry.effects && entry.effects.accounts ? entry.effects.accounts[ourKey] : null;
		const bal = eff && eff.fields ? eff.fields.balance : null;
		if (!bal) { continue; }

		const { principal } = stripFeeEntries(bal, extractFeeLegs(entry.voteStaple, ourKey));

		for (const entries of Object.values(principal)) {
			for (const e of entries) {
				if (typeof e.value !== 'bigint' || e.value >= 0n || !e.otherAccount) { continue; }
				const k = e.otherAccount.publicKeyString !== undefined
					? String(e.otherAccount.publicKeyString)
					: String(e.otherAccount);
				out.add(k);
			}
		}
	}

	return ([...out]);
}

/*
 * Decode every anchor instruction in the history, once, before classification.
 *
 * This exists to keep classification SYNCHRONOUS. Decoding form A needs
 * `DecompressionStream`, which is async, and an async classifier would have to
 * be awaited identically by the CLI and the page to guarantee identical output.
 * Doing the work up front removes that whole class of divergence.
 *
 * Returns Map<stapleHash, decodedPayload[]>. No network access; purely local.
 */
async function prefetchPayloads(history, onProgress) {
	const byStaple = new Map();
	let done = 0;

	for (const entry of history) {
		const raws = extractExternals(entry.voteStaple);
		if (raws.length > 0) {
			const decoded = [];
			for (const raw of raws) {
				/* eslint-disable no-await-in-loop -- ordered, and identical on both runtimes */
				const d = await decodeExternal(raw);
				if (d) { decoded.push(d); }
			}
			byStaple.set(String(entry.voteStaple.hash), decoded);
		}
		done++;
		if (typeof onProgress === 'function' && done % 200 === 0) {
			onProgress(done, history.length);
		}
	}

	return (byStaple);
}

/*
 * Ask the chain what each payee says it is, so a bridge absent from the shipped
 * registry is still caught. See lib/anchors.js.
 */
async function prefetchAnchors(client, Account, history, ourKey, bridgeAnchors, onProgress) {
	return (await resolveAnchors(
		client, Account, collectOutgoingCounterparties(history, ourKey), bridgeAnchors, onProgress));
}

/*
 * Turn a fetched history into rows + flags + stats. Pure: no I/O, no clock
 * beyond what the staples carry, so the CLI and the page get identical results.
 */
function processHistory(history, ctx) {
	const rows = [];
	const flagged = [];
	const stats = {
		stapleCount: history.length,
		skipped: 0,
		rowsEmitted: 0,
		excluded: 0,
		feeUnitsTotal: 0n,
		staplesWithFee: 0,
		/* Real protocol fees, per fee asset. Unlike feeUnits these are exact
		 * KTA amounts and each one is a disposal. */
		rowsWithFee: 0,
		feeBySymbol: new Map(),
		feeDecimals: new Map(),
		totalIn: 0n,
		totalOut: 0n,
		grossFlowSuppressed: 0,
		trades: 0,
		transfers: 0,
		/* Rows exported as Type=Withdrawal. CoinLedger books EVERY one of these
		 * as a non-taxable self-transfer, so the user has to reclassify any that
		 * were really sales or payments. Counted so the scale is stated. */
		outgoingRows: 0,
		/* Rows whose asset CoinLedger cannot price, so the user must create a
		 * custom asset and supply historical prices by hand. Counted so the
		 * scale is known BEFORE importing. */
		unpriceableRows: 0,
		unpriceableSymbols: new Set(),
		unpriceableByToken: new Map(),
		fiatSymbols: new Set(),
		/* Amounts too precise to survive a float parse. See SIGNIFICANT_DIGIT_LIMIT. */
		highPrecisionRows: 0,
		maxSignificantDigits: 0,
		/* Per-symbol totals; a single KTA total is meaningless once several
		 * tokens are in play. */
		byToken: new Map()
	};

	const bump = (sym, dir, amt, dec) => {
		if (!sym) { return; }
		if (!stats.byToken.has(sym)) {
			stats.byToken.set(sym, { in: 0n, out: 0n, decimals: dec });
		}
		stats.byToken.get(sym)[dir] += amt;
	};

	for (const entry of history) {
		const result = classifyStaple(entry, ctx);

		const fee = entry.effects && entry.effects.metadata ? entry.effects.metadata.feeUnits : null;
		if (typeof fee === 'bigint' && fee !== 0n) {
			stats.feeUnitsTotal += fee;
			stats.staplesWithFee++;
		}

		if (result.kind === 'skip') {
			stats.skipped++;
			continue;
		}

		if (result.kind === 'flag') {
			stats.excluded++;
			flagged.push(result);
			continue;
		}

		if (result.kind === 'row' || result.kind === 'rows') {
			/*
			 * A staple can dispose of more than one token at once. Each
			 * disposal is its own CSV row; they share a staple hash, which is
			 * fine -- TxHash is not required to be unique.
			 */
			const emitted = (result.kind === 'rows')
				? result.rows
				: [{ row: result.row, flags: result.flags }];

			for (const item of emitted) {
			const row = item.row;
			const itemFlags = item.flags;
			row.memo = ctx.memos ? (ctx.memos.get(row.stapleHash) || null) : null;
			row.appliedFlags = itemFlags;
			rows.push(row);

			/*
			 * The protocol fee is a disposal of the fee asset in its own right,
			 * so it is counted separately from the principal totals rather than
			 * folded into them.
			 */
			if (row.fee) {
				stats.rowsWithFee++;
				stats.feeBySymbol.set(row.fee.symbol,
					(stats.feeBySymbol.get(row.fee.symbol) || 0n) + row.fee.amount);
				stats.feeDecimals.set(row.fee.symbol, row.fee.decimals);
			}

			if (row.kind === 'trade') {
				stats.trades++;
				bump(row.sent.symbol, 'out', row.sent.amount, row.sent.decimals);
				bump(row.received.symbol, 'in', row.received.amount, row.received.decimals);
			} else {
				stats.transfers++;
				if (row.direction === 'out') {
					stats.outgoingRows++;
				}
				bump(row.symbol, row.direction === 'in' ? 'in' : 'out', row.amount, row.decimals);
				if (row.direction === 'in') {
					stats.totalIn += row.amount;
				} else {
					stats.totalOut += row.amount;
				}
			}

			/*
			 * Flag any emitted amount carrying more significant digits than an
			 * IEEE double can hold. We do NOT round it: the exact value goes in
			 * the CSV and the row is surfaced, because silently truncating a tax
			 * figure is the failure this project exists to avoid.
			 */
			const amounts = row.kind === 'trade'
				? [formatUnits(row.sent.amount, row.sent.decimals), formatUnits(row.received.amount, row.received.decimals)]
				: [formatUnits(row.amount, row.decimals)];
			/*
			 * Counted, not listed. On an 18-decimal token almost every amount
			 * exceeds the limit, so a per-row flag would bury the review file in
			 * thousands of identical entries and hide the things that matter.
			 * The exact values are in the CSV either way; what the user needs is
			 * the scale and the warning not to let a spreadsheet round them.
			 */
			if (amounts.some((a) => significantDigits(a) > SIGNIFICANT_DIGIT_LIMIT)) {
				stats.highPrecisionRows++;
				if (significantDigits(amounts[0]) > stats.maxSignificantDigits) {
					stats.maxSignificantDigits = significantDigits(amounts[0]);
				}
			}

			/* Note which currency balances appear, so the review file can
			 * explain how they are treated. */
			for (const leg of (row.kind === 'trade' ? [row.sent, row.received] : [row])) {
				if (leg.symbol && FIAT_SYMBOLS.has(leg.symbol)) {
					stats.fiatSymbols.add(leg.symbol);
				}
			}

			for (const f of itemFlags) {
				if (f.reason === REASONS.UNPRICEABLE) {
					const k = f.symbol || f.token;
					stats.unpriceableSymbols.add(k);
					stats.unpriceableByToken.set(k, (stats.unpriceableByToken.get(k) || 0) + 1);
				}
			}
			if (itemFlags.some((f) => f.reason === REASONS.UNPRICEABLE)) {
				stats.unpriceableRows++;
			}

			for (const f of itemFlags) {
				/*
				 * Suppressed gross-flow legs are counted but not listed --
				 * they cannot be represented in a tax report at all. Never
				 * silent: the count is always shown.
				 */
				if (f.suppressed) {
					stats.grossFlowSuppressed++;
					continue;
				}

				/*
				 * Trade rows carry sent/received pairs rather than a single
				 * amount, so the transfer-shaped fields do not apply to them.
				 */
				const isTrade = row.kind === 'trade';
				const dec = isTrade ? null : row.decimals;

				flagged.push({
					reason: f.reason,
					detail: {
						stapleHash: row.stapleHash,
						timestamp: row.timestamp,
						amountDisplay: isTrade
							? `${formatUnits(row.sent.amount, row.sent.decimals)} ${row.sent.symbol} for ${formatUnits(row.received.amount, row.received.decimals)} ${row.received.symbol}`
							: `${formatUnits(row.amount, dec)} ${row.symbol}`,
						symbol: f.symbol || (isTrade ? null : row.symbol),
						type: isTrade ? 'Trade' : row.type,
						anchorNames: (f.anchors || []).map((a) => a.name).filter(Boolean).join(', '),
						declaredAs: (f.anchors || []).map((a) => a.declared || a.name).filter(Boolean).join(', '),
						/* Which attribution signal fired: payload, counterparty, or
						 * both. Recorded so a later divergence is visible in data
						 * rather than only in theory. */
						signals: (f.signals || []).join(' + '),
						chainId: f.chainId !== undefined ? f.chainId : null,
						destination: f.destination || null,
						orderRef: f.orderRef || null,
						count: f.count !== undefined ? f.count : null,
						grossInDisplay: (!isTrade && f.grossIn !== undefined) ? formatUnits(f.grossIn, dec) : null,
						grossOutDisplay: (!isTrade && f.grossOut !== undefined) ? formatUnits(f.grossOut, dec) : null,
						netDisplay: (!isTrade && f.net !== undefined) ? formatUnits(f.net, dec) : null,
						unit: isTrade ? '' : row.symbol,
						hiddenLegRaw: f.hiddenLeg
					}
				});
			}
			}
			continue;
		}

		throw new Error(`Unmappable classification result for a staple: ${JSON.stringify(result).slice(0, 200)}`);
	}

	/*
	 * Sort by timestamp, then staple hash as a deterministic tiebreaker. Staple
	 * timestamps are NOT monotonic (roughly -69s..+82s against block.date), so
	 * without a stable tiebreaker identical input could order differently
	 * between runs -- and between the CLI and the browser.
	 */
	rows.sort((a, b) => {
		const d = a.timestamp.getTime() - b.timestamp.getTime();
		if (d !== 0) {
			return (d);
		}
		return (a.stapleHash < b.stapleHash ? -1 : a.stapleHash > b.stapleHash ? 1 : 0);
	});

	stats.rowsEmitted = rows.length;

	const times = rows.map((r) => r.timestamp.getTime());
	const dateRange = times.length
		? { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) }
		: null;

	return ({ rows, flagged, stats, dateRange });
}

function groupFlags(flagged) {
	const groups = new Map();
	for (const f of flagged) {
		if (!groups.has(f.reason)) {
			groups.set(f.reason, []);
		}
		groups.get(f.reason).push(f);
	}
	return (groups);
}

function explainReason(reason) {
	switch (reason) {
		case REASONS.EXCLUDED_TOKEN:
			return ('These moved a **Keeta token whose ticker is a currency code**, like `USD`, `EUR` or `JPY`.\n\nThey are **excluded on purpose**, and not because of anything wrong with the numbers. The amounts are correct and verified. The problem is the label: these are Keeta-native tokens, not the currencies themselves, and tax software is very likely to read a ticker of `USD` as actual US dollars. That produces a right number attached to the wrong asset, which is far harder to notice than an obviously broken figure.\n\nIf you need these in your return, add them in your tax software as custom assets with names that cannot be confused with real currency, then enter them by hand from the list below.');
		case REASONS.UNRESOLVED_TOKEN:
			return ('For these, the tool could not establish the token\u2019s divisor with confidence.\n\nMost Keeta tokens publish their decimal precision on-chain, and the tool reads it from there. When that information is missing, unreadable, or disagrees with our reference list, there is no safe way to convert the raw number into an amount. Getting it wrong is a factor-of-ten error, so the tool refuses rather than guesses. Each one is listed below with its transaction hash.');
		case REASONS.MULTI_LEG:
			return ('These moved **several tokens at once in a shape that is not a trade**, so they could not be written as one swap of one thing for another.\n\nThe real example seen on-chain is a token launch: a new token is created and its supply issued in the same transaction, so several tokens arrive and none leave. That is not a trade, and forcing it into a trade row would misreport it.\n\nNote that several tokens **leaving** at once is handled now: that is a transfer of each one, and those rows are in your CSV. What is left here is the cases that genuinely have no single sensible shape. They are excluded and listed below.');
		case REASONS.FEE_ONLY:
			return ('In these transactions the only thing that moved was the **network fee**. Nothing else was sent or received.\n\n**They are not in your CSV**, because a row needs an asset in the sent or received column and there is nothing to put there. But the fee was still a real disposal of KTA, so if these matter to your return you will need to add them by hand as a disposal of the amount shown.\n\nThis usually happens when you publish a transaction on behalf of another account and pay its fee.');
		case REASONS.UNRESOLVED_FEE_TOKEN:
			return ('These paid a network fee in a token whose decimal precision could not be established, so the fee amount could not be written safely.\n\n**The transactions themselves ARE in your CSV** with correct amounts. Only the fee figure is missing from those rows. Getting a divisor wrong is a factor-of-ten error, so the tool leaves the fee blank rather than guess.');
		case REASONS.MULTI_TOKEN_FEE:
			return ('These paid their network fee in **more than one token at once**. CoinLedger has a single fee currency column, so there is nowhere to put a split fee.\n\n**The transactions themselves ARE in your CSV** with correct amounts, but with no fee recorded. Add the fees by hand if they matter to your return. This is rare and worth reporting.');
		case REASONS.UNPRICEABLE:
			return ('**These rows ARE in your CSV**, but your tax software probably has no price history for the token.\n\nCoinLedger only carries prices for assets it knows. For anything else you have to add it as a **custom asset** and then supply the price yourself, per transaction, at each date. There is no automatic pricing and no shortcut.\n\nCheck the count above before you import, so you know how much manual work you are taking on. If it is large, it may be easier to import only the assets your software already prices and handle the rest separately.');
		case REASONS.HIGH_PRECISION:
			return ('These amounts carry more decimal places than a spreadsheet or a typical number parser preserves exactly. An 18-decimal token can produce a figure with more than twenty significant digits.\n\n**The exact value is in your CSV**, unrounded. It is flagged because tax software does not document how it handles this, and because opening the CSV in a spreadsheet can quietly round it. If you edit the file before importing, check these rows afterwards.');
		case REASONS.GROSS_FLOW:
			return ('In these transactions KTA moved **both in and out at the same time**. Keeta bundles related movements together, so a single transaction can contain, say, a 5 KTA receipt and a 3 KTA payment at once.\n\n**These rows ARE in your CSV**, as a single net figure (in that example, a 2 KTA withdrawal). That is the real change to your balance. The individual legs are not shown. If you need gross figures rather than net, you will need to enter these manually. Both legs are listed below so you can see exactly what was combined.');
		case REASONS.POSSIBLE_BRIDGE:
			return ('These went to an address known to be a **bridge**. Moving KTA across a bridge is often just moving your own funds between your own holdings, which is usually **not** a taxable disposal. On-chain it looks identical to a sale.\n\n**These rows ARE in your CSV**, currently as ordinary withdrawals. Check each one.\n\n**How to fix one in CoinLedger:** if the receiving wallet is also imported, CoinLedger may pair the two sides for you. Look at its *Potential Bridges, Trades and Transfers* tab. If the receiving wallet is **not** imported, CoinLedger will see a withdrawal with nothing to match it against and will leave it as a disposal. In that case use its **Create Transfer** action on the row to pair it with the destination yourself.\n\n**Important, and please read this bit:** we detect *some* bridge transfers, not all. Only two bridge operators publish their addresses in a way we can read. **If you moved KTA to Base or anywhere else, check those rows yourself.** The tool cannot promise it caught them.');
		case REASONS.FIAT_OFFRAMP:
			return ('These were sent to a **fiat rail**: money leaving Keeta towards a bank, not towards another blockchain. The transaction carries an order reference from the operator rather than a destination address.\n\n**There is no second leg to find, and there never will be.** A bridge to another chain has a matching arrival that can be pointed at. A fiat off-ramp ends outside every blockchain, so no future version of this tool can reconcile these for you. They are listed because you have to account for them yourself, not because they are waiting on a feature.\n\n**These rows ARE in your CSV** as ordinary withdrawals. **Each one is a real disposal.** You sold or redeemed that asset for currency. Check the amount you actually received against your bank or account statement and classify it accordingly.');
		case REASONS.BRIDGE_OUT:
			return ('These moved funds **out of Keeta to another chain**. The transaction itself names the destination chain and address, shown below, so this is read from your own transaction rather than guessed.\n\n**These rows ARE in your CSV** as ordinary withdrawals, which is the safe default. If the destination address is a wallet you control, this was a transfer between your own holdings and usually not a taxable disposal. If it belongs to someone else, it was a payment or a sale, and it is taxable.\n\n**Check the destination address below against your own wallets.** In CoinLedger, if the receiving wallet is also imported it may pair the two sides for you; if not, use its **Create Transfer** action.');
		case REASONS.BRIDGE_IN:
			return ('These are funds **arriving from a bridge**, confirmed from the anchor instruction carried in the transaction rather than inferred from the amount.\n\n**These rows ARE in your CSV** as deposits. If the funds came from a wallet you control on another chain, this is your own money moving rather than income, and the cost basis should carry over from wherever it came from. If it came from someone else, treat it as you would any other incoming payment.\n\nThe thing to check is that you are not recording this as newly acquired at zero cost when it is really a transfer of your own funds.');
		case REASONS.ANCHOR_PAYLOAD_UNREADABLE:
			return ('These carry an **anchor instruction this tool could not decode**. Several encodings exist and this looks like one that is not handled yet.\n\n**These rows ARE in your CSV** as ordinary transfers. This is not a claim that anything is wrong with them. It is the tool telling you it could not read part of the transaction, so any bridge or off-ramp detail it may have contained is missing from the notes above. **Please report these**, because an unreadable instruction is a gap in the tool rather than in your wallet.');
		case REASONS.DECLARED_ANCHOR:
			return ('These went to an account that **describes itself on-chain as an anchor**. The table below shows what each one calls itself, in its own words.\n\nAnchors on Keeta do several unrelated jobs. Some are bridges that move funds to another chain. Others handle identity verification, storage, or issuing a currency. **We are not telling you these were bridge transfers.** We are telling you the recipient is infrastructure rather than an ordinary wallet, and that is worth checking.\n\n**These rows ARE in your CSV** as ordinary transfers, which is the safe default. What to do depends on what the transaction actually was:\n\n- If it moved your funds to another chain or to another wallet you control, it may not be a taxable disposal. In CoinLedger you can pair it with the **Create Transfer** action.\n- If it was a payment, a purchase, a fee, or an identity check, leave it exactly as it is.\n\nOnly you know which. The tool will not guess.');
		case REASONS.ANCHOR_UNCHECKED:
			return ('For these, one of the recipients could not be read from the network, so the tool could not check whether it was a bridge.\n\n**These rows ARE in your CSV** as ordinary withdrawals. That is not a statement that they were not bridges. It is the tool telling you it could not find out. Check them against your own records if you have ever bridged.');
		case REASONS.YEAR_BOUNDARY:
			return ('These fall within two minutes of a **tax-year boundary**. Keeta has two timestamps per transaction: when the block was created, and when the network agreed on it. They can differ by up to about 80 seconds in either direction. Near midnight on 31 December that difference can move a transaction into a different tax year. Confirm which year each belongs to.');
		case REASONS.NET_ZERO:
			return ('These staples touched your balance but netted to exactly zero across every token. They are excluded because there is no gain or loss to report, but they are listed here rather than dropped silently, so nothing disappears without being accounted for.');
		case REASONS.NO_TIMESTAMP:
			return ('The network timestamp for these could not be read, so they cannot be placed in a tax year. They are excluded. This is unusual, so please report it.');
		default:
			return ('');
	}
}

function describeFlag(reason, d) {
	switch (reason) {
		case REASONS.EXCLUDED_TOKEN:
		case REASONS.UNRESOLVED_TOKEN:
			return (d.legs.map((l) => {
				const name = l.symbol ? l.symbol : '`' + shortAddr(l.token) + '`';
				const why = l.status && l.status !== 'ok' ? ' (' + l.status + ')' : '';
				return ((l.direction === 'in' ? '+' : '\u2212') + l.net.replace('-', '') + ' raw ' + name + why);
			}).join(' / '));
		case REASONS.MULTI_LEG:
			return (d.inCount + ' token(s) in, ' + d.outCount + ' out: ' + d.legs.map((l) => (l.direction === 'in' ? '+' : '\u2212') + l.net.replace('-', '') + ' raw ' + (l.symbol || shortAddr(l.token))).join(' / '));
		case REASONS.UNPRICEABLE:
			return ((d.symbol || 'token') + ' has no price data. In CSV, needs a custom asset and a manual price');
		case REASONS.HIGH_PRECISION:
			return (d.type + ': ' + d.amounts.join(' / ') + '. Exact value is in the CSV, do not let a spreadsheet round it');
		case REASONS.GROSS_FLOW:
			return (`in ${d.grossInDisplay} ${d.unit} / out ${d.grossOutDisplay} ${d.unit} → net ${d.netDisplay} ${d.unit} (${d.type}), in CSV as the net only`);
		case REASONS.POSSIBLE_BRIDGE:
			return (`${d.amountDisplay} to ${d.anchorNames}. In CSV, verify yourself`);
		case REASONS.FIAT_OFFRAMP:
			return (`${d.amountDisplay} to a fiat rail, order ref ${d.orderRef || 'unknown'}. A real disposal, and matchable on no chain`);
		case REASONS.BRIDGE_OUT:
			return (`${d.amountDisplay} to chain ${d.chainId || '?'} address ${d.destination || 'unknown'} (evidence: ${d.signals || 'n/a'}). Confirm whether that address is yours`);
		case REASONS.BRIDGE_IN:
			return (`${d.amountDisplay} arriving via ${d.anchorNames || 'an anchor'} (evidence: ${d.signals || 'n/a'})`);
		case REASONS.ANCHOR_PAYLOAD_UNREADABLE:
			return (`${d.amountDisplay}: ${d.count || 1} anchor instruction(s) could not be decoded. Please report`);
		case REASONS.DECLARED_ANCHOR:
			return (`${d.amountDisplay} to an account calling itself "${d.declaredAs}". In CSV, verify what this transaction was`);
		case REASONS.ANCHOR_UNCHECKED:
			return (`${d.amountDisplay}: recipient could not be checked (${d.anchorNames || 'unreadable account'}). In CSV, verify yourself`);
		case REASONS.YEAR_BOUNDARY:
			return (`${d.amountDisplay} (${d.type}). In CSV, confirm tax year`);
		case REASONS.NET_ZERO:
			return (`${d.tokens.length} token(s) touched, net zero`);
		case REASONS.FEE_ONLY:
			return (d.feeDisplay
				? `fee only: ${formatUnits(d.feeDisplay.amount, d.feeDisplay.decimals)} ${d.feeDisplay.symbol} disposed, nothing else moved`
				: 'fee only, nothing else moved');
		case REASONS.UNRESOLVED_FEE_TOKEN:
			return (`fee paid in an unresolvable token (${d.status}). Row is in the CSV, fee column left blank`);
		case REASONS.MULTI_TOKEN_FEE:
			return (`fee split across ${d.tokens ? d.tokens.length : 'several'} tokens. Row is in the CSV, fee column left blank`);
		default:
			return ('');
	}
}

const FLAG_ORDER = [
	REASONS.EXCLUDED_TOKEN,
	REASONS.UNRESOLVED_TOKEN,
	REASONS.MULTI_LEG,
	REASONS.FEE_ONLY,
	REASONS.MULTI_TOKEN_FEE,
	REASONS.UNRESOLVED_FEE_TOKEN,
	REASONS.UNPRICEABLE,
	REASONS.HIGH_PRECISION,
	REASONS.GROSS_FLOW,
	REASONS.FIAT_OFFRAMP,
	REASONS.BRIDGE_OUT,
	REASONS.BRIDGE_IN,
	REASONS.POSSIBLE_BRIDGE,
	REASONS.ANCHOR_PAYLOAD_UNREADABLE,
	REASONS.DECLARED_ANCHOR,
	REASONS.ANCHOR_UNCHECKED,
	REASONS.YEAR_BOUNDARY,
	REASONS.NET_ZERO,
	REASONS.NO_TIMESTAMP
];

function renderFlaggedMd(ctx, groups, stats, generatedAtIso) {
	const L = [];

	L.push('# Transactions you must review before filing');
	L.push('');
	L.push('This file lists every transaction the converter could **not** classify with confidence, plus every row it did emit that still needs your eyes on it.');
	L.push('');
	L.push('**Read this before you import anything.** The CSV is a starting point, not a finished tax return. Nothing here is an error in your wallet. It is the tool telling you where it refused to guess.');
	L.push('');
	L.push(`- Account: \`${ctx.ourKey}\``);
	L.push(`- Network: ${ctx.networkAlias} (network id ${ctx.networkIdHex})`);
	L.push(`- Generated: ${generatedAtIso}`);
	L.push(`- Staples fetched: ${stats.stapleCount}`);
	L.push(`- Rows written to CSV: ${stats.rowsEmitted}`);
	L.push(`- Excluded from CSV: ${stats.excluded}`);
	L.push(`- Skipped as non-financial: ${stats.skipped}`);
	L.push('');

	L.push('## ⚠️ READ THIS BEFORE YOU IMPORT: pick the right KTA');
	L.push('');
	L.push('When you upload this file, CoinLedger will show a **"Shared Ticker Symbols Detected"** prompt. More than one asset uses the ticker `KTA`.');
	L.push('');
	L.push('**Choose `KTA - Keeta`.**');
	L.push('');
	L.push('The other option (`KTA - KTA`) is an unrelated asset. If you pick it, CoinLedger will happily price your entire report against the wrong coin. No error, no warning, just wrong numbers all the way through. This is the single easiest way to get a wrong return out of a correct CSV.');
	L.push('');
	L.push('CoinLedger can remember this mapping, so it is a one-time choice per account.');
	L.push('');
	if (stats.highPrecisionRows > 0) {
		L.push('## A note on very precise amounts');
		L.push('');
		L.push('**' + stats.highPrecisionRows + ' rows carry more decimal places than a spreadsheet reliably preserves** (up to ' + stats.maxSignificantDigits + ' significant digits). Keeta tokens commonly use 18 decimal places, so this is normal rather than a problem with your wallet.');
		L.push('');
		L.push('**The exact values are in your CSV, unrounded.** The warning is about what happens next: if you open the file in Excel, Google Sheets or Numbers and save it, those amounts can be silently rounded before your tax software ever sees them.');
		L.push('');
		L.push('**Upload the CSV as it is. Do not open and re-save it first.**');
		L.push('');
	}
	if (stats.fiatSymbols.size > 0) {
		const syms = [...stats.fiatSymbols].sort().join(', ');
		L.push('## About the currency balances in this file');
		L.push('');
		L.push('Your export contains **' + syms + '**. These are currency balances held on Keeta, and they are exported as ordinary currency rather than as crypto assets.');
		L.push('');
		L.push('That is deliberate. They are redeemable one for one through Keeta Personal, which is a regulated money-movement product: accounts are identity verified and carry real bank details, money arrives by direct deposit and leaves by ACH. They behave as cash, so tax software treats them as cash and computes no gain or loss on them, which is the correct treatment.');
		L.push('');
		L.push('The rows are labeled clearly enough to change if you need to. **If a tax professional advises treating them differently, you can adjust them without re-exporting.**');
		L.push('');
	}
	if (stats.unpriceableRows > 0) {
		/*
		 * Deliberately specific rather than generic. At runtime we know the
		 * exact tokens and row counts, and someone with 3 affected rows and
		 * someone with 1,800 need to make completely different decisions.
		 * Only they can make that call, so give them the real numbers.
		 */
		const byTok = [...stats.unpriceableSymbols].filter(Boolean).sort();
		const pct = Math.round((stats.unpriceableRows / Math.max(stats.rowsEmitted, 1)) * 100);

		L.push('## ⚠️ ' + stats.unpriceableRows + ' of your ' + stats.rowsEmitted + ' rows need a price you supply yourself');
		L.push('');
		L.push('**Everything is included in your CSV. Some of it needs your attention. Here is exactly what, and how much.**');
		L.push('');
		L.push('| Token | Rows |');
		L.push('|---|---|');
		for (const sym of byTok) {
			const n = stats.unpriceableByToken.get(sym) || 0;
			L.push('| ' + sym + ' | ' + n + ' |');
		}
		L.push('');
		L.push('CoinLedger has price history only for assets it already tracks. For these you add a **custom asset**, then supply the price yourself for each transaction at each date. There is no automatic lookup.');
		L.push('');

		if (stats.unpriceableRows <= 20) {
			L.push('**That is ' + stats.unpriceableRows + ' prices to enter.** At this size it is a short job. Work through the rows listed below and you are done.');
		} else if (stats.unpriceableRows <= 200) {
			L.push('**That is ' + stats.unpriceableRows + ' prices to enter, around ' + pct + '% of your export.** Manageable, but set aside real time for it, and consider whether every one of these tokens actually matters to your return.');
		} else {
			L.push('**That is ' + stats.unpriceableRows + ' prices to enter, around ' + pct + '% of your export.** That is a large manual job, and only you can judge whether it is worth doing. One option is to import the assets CoinLedger already prices, handle these separately, and ask an accountant how to treat tokens with no market price.');
		}

		L.push('');
		L.push('Whatever you decide, **reconcile these against your own wallet before filing**. They are in the file. The tool cannot value them for you.');
		L.push('');
	}

	if (stats.byToken.has('CBBTC')) {
		L.push('## ⚠️ CBBTC is not BTC');
		L.push('');
		L.push('Your export contains **CBBTC**, a bridged representation of Bitcoin on Keeta. It is a different asset from BTC and must be mapped as its own asset in CoinLedger.');
		L.push('');
		L.push('**Do not map it to BTC.** If you do, CoinLedger prices it against Bitcoin and treats the two as one holding. The numbers will look entirely reasonable and be wrong, in the same way that picking the wrong KTA would be. This one carries more value per unit, so the error is larger.');
		L.push('');
	}
	/*
	 * This is the single most consequential thing in the file after the shared
	 * ticker, and for the same reason: it produces a wrong return from a correct
	 * CSV, with no error anywhere. Deliberately placed high and never omitted,
	 * even when the count is zero, because a user with no outgoing rows this
	 * year may still have some next year.
	 */
	if (stats.outgoingRows > 0) {
		L.push(`## ⚠️ READ THIS TOO: your ${stats.outgoingRows} outgoing transaction(s) are marked NON-TAXABLE`);
		L.push('');
		L.push(`Every transaction that sent crypto out of your wallet is exported with the type **Withdrawal**. There are ${stats.outgoingRows} of them.`);
		L.push('');
		L.push('**CoinLedger treats a Withdrawal as a non-taxable self-transfer**, meaning money moved between two wallets you own. No gain, no loss, nothing reported.');
		L.push('');
		L.push('**If any of those sends were actually sales or payments, that is wrong.** Selling crypto by sending it to a buyer is a disposal. Paying someone in crypto is a disposal. Both are taxable, and both look exactly like an ordinary transfer on-chain. Left as Withdrawals they will be missing from your return, with no error and no warning to tell you.');
		L.push('');
		L.push('**The tool cannot tell the difference, and it is not guessing.** A send to another address is genuinely ambiguous. Only you know whether you were moving your own funds, paying someone, or selling. Withdrawal is the safest default because it does not invent a taxable event that never happened, but it is a default, not a finding.');
		L.push('');
		L.push('**What to do:** go through your outgoing rows in CoinLedger and change the type on any that were sales or payments.');
		L.push('');
		L.push('| If the send was really | Set the type to | Taxable? |');
		L.push('|---|---|---|');
		L.push('| moving funds to your own wallet | Withdrawal or Transfer | no |');
		L.push('| selling to a buyer | Sells | **yes** |');
		L.push('| paying for goods or services | Payments | **yes** |');
		L.push('| a gift to someone | Gift Sent | no |');
		L.push('');
		L.push('Gifts are the one case you can leave alone. CoinLedger treats Gift Sent as non-taxable too, so the outcome is the same either way. **Sales and payments are the ones that matter.**');
		L.push('');
	}

	L.push('## How to import');
	L.push('');
	L.push('1. In CoinLedger, go to **Import → Other Account** and upload the CSV.');
	L.push('2. When prompted about shared tickers, select **`KTA - Keeta`** (see above).');
	L.push('3. Review everything listed further down this file before filing.');
	L.push('');

	L.push('## About network fees');
	L.push('');
	if (stats.rowsWithFee > 0) {
		const feeLines = [...stats.feeBySymbol.entries()]
			.map(([s, amt]) => `**${formatUnits(amt, stats.feeDecimals.get(s))} ${s}**`)
			.join(', ');

		L.push(`**Network fees are in your CSV, in the Fee Currency and Fee Amount columns.** ${stats.rowsWithFee} rows carry one. Across this export you paid ${feeLines} in fees.`);
		L.push('');
		L.push('**Paying a fee in KTA is a disposal of that KTA.** You gave up an asset, so there is a gain or loss on it based on what it was worth when you acquired it versus when you spent it. That is why a transaction you think of as non-taxable, like moving your own money, can still show a small gain or loss after import. That is correct and expected, not a bug.');
		L.push('');
		L.push('Every fee here was read from the transaction itself, not estimated. Keeta builds each transaction with a separate fee block, one payment per validator that signed it, so the amount is exact.');
		L.push('');
		L.push('**Do not add these fees again by hand.** They are already counted. Entering them a second time would dispose of the same KTA twice and overstate your losses.');
		L.push('');
	} else {
		L.push('**No network fees appear in this export.** Every transaction here had its fee paid by the other party, which is normal for incoming transfers and for swaps where the counterparty publishes the transaction.');
		L.push('');
	}
	L.push('You may also see a raw number called `feeUnits` if you go digging in the data. Ignore it. It measures how big a transaction is, not how much it cost, and it is not an amount of KTA.');
	L.push('');

	if (stats.grossFlowSuppressed > 0) {
		L.push('## Amounts too small to report');
		L.push('');
		L.push(`**${stats.grossFlowSuppressed} rows had an opposing leg below reporting precision (suppressed).**`);
		L.push('');
		L.push(`These transactions moved KTA both in and out, but the smaller side was under ${DUST_THRESHOLD_KTA} KTA. CoinLedger works to 8 decimal places, so amounts that small round to zero everywhere in a tax report. They cannot appear in your return at any precision. They are counted here rather than listed, because asking you to review something that cannot be reported would waste your time.`);
		L.push('');
		L.push('The net figures in your CSV are unaffected and remain exact.');
		L.push('');
	}

	if (groups.size === 0) {
		L.push('## Nothing else flagged');
		L.push('');
		L.push('Every other transaction classified cleanly. Still spot-check a few rows against the explorer before filing.');
		return (L.join('\n') + '\n');
	}

	const reasons = [...groups.keys()].sort((a, b) => {
		const ia = FLAG_ORDER.indexOf(a), ib = FLAG_ORDER.indexOf(b);
		return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib));
	});

	for (const reason of reasons) {
		const items = groups.get(reason).slice();

		/*
		 * Order gross-flow entries by the size of the leg netting hid, largest
		 * first, so a single large concealed leg among many small ones appears
		 * at the top rather than buried.
		 */
		if (reason === REASONS.GROSS_FLOW) {
			items.sort((a, b) => {
				const ha = a.detail.hiddenLegRaw !== undefined ? a.detail.hiddenLegRaw : 0n;
				const hb = b.detail.hiddenLegRaw !== undefined ? b.detail.hiddenLegRaw : 0n;
				return (ha > hb ? -1 : ha < hb ? 1 : 0);
			});
		}

		L.push(`## ${reason}  (${items.length})`);
		L.push('');
		L.push(explainReason(reason));
		L.push('');

		const shown = items.slice(0, 200);
		L.push('| Staple hash | Date (UTC) | Detail |');
		L.push('|---|---|---|');
		for (const it of shown) {
			L.push(`| \`${it.detail.stapleHash}\` | ${it.detail.timestamp ? formatCoinLedgerDate(it.detail.timestamp) : '(none)'} | ${describeFlag(reason, it.detail)} |`);
		}
		if (items.length > shown.length) {
			L.push('');
			L.push(`_…and ${items.length - shown.length} more of the same kind._`);
		}
		L.push('');
	}

	return (L.join('\n') + '\n');
}

const API = {
	NETWORKS, CSV_HEADERS, CSV_HEADER_LINE, PLATFORM,
	assertPublicKeyOnly, indexAddressBook, assertNetworkMatches, buildMemoIndex,
	processHistory, buildCsv, toCsvRow, buildDescription, collectTokens, prefetchTokens,
	collectOutgoingCounterparties, prefetchAnchors, prefetchPayloads,
	groupFlags, renderFlaggedMd, explainReason, describeFlag, FLAG_ORDER
};

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
