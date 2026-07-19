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

const { formatUnits, formatCoinLedgerDate, csvRow, shortAddr } = _fmt;
const { classifyStaple, REASONS, DUST_THRESHOLD_KTA } = _cls;

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

	const others = row.counterparties.filter(Boolean);
	if (others.length === 1) {
		parts.push(row.direction === 'in' ? `From ${shortAddr(others[0])}` : `To ${shortAddr(others[0])}`);
	} else if (others.length > 1) {
		parts.push(`${others.length} counterparties`);
	}

	if (row.memo) {
		parts.push(`Memo: ${row.memo}`);
	}

	for (const f of row.appliedFlags || []) {
		if (f.reason === REASONS.POSSIBLE_BRIDGE) {
			const names = f.anchors.map((a) => a.name).join(', ');
			parts.push(`REVIEW: possible bridge transfer via ${names}. Verify whether this was a transfer between your own holdings`);
		}
		if (f.reason === REASONS.YEAR_BOUNDARY) {
			parts.push('REVIEW: near tax-year boundary. Confirm which year this belongs to');
		}
	}

	return (parts.join('. '));
}

function toCsvRow(row) {
	const amount = formatUnits(row.amount, row.decimals);
	const dateStr = formatCoinLedgerDate(row.timestamp);
	const description = buildDescription(row);

	/*
	 * Blank fields must be genuinely blank. A Deposit fills only the Received
	 * columns; a Withdrawal only the Sent columns. Never 0, never "N/A".
	 *
	 * Fee Currency / Fee Amount are intentionally left BLANK -- the staple-level
	 * `feeUnits` denomination is unverified, and emitting a fee we cannot
	 * justify is worse than omitting one we can explain. See FLAGGED.md.
	 */
	const assetSent = row.direction === 'out' ? row.symbol : '';
	const amountSent = row.direction === 'out' ? amount : '';
	const assetReceived = row.direction === 'in' ? row.symbol : '';
	const amountReceived = row.direction === 'in' ? amount : '';

	return (csvRow([
		dateStr, PLATFORM, assetSent, amountSent, assetReceived, amountReceived,
		'', '', row.type, description, row.stapleHash
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
		totalIn: 0n,
		totalOut: 0n,
		grossFlowSuppressed: 0
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

		if (result.kind === 'row') {
			const row = result.row;
			row.memo = ctx.memos ? (ctx.memos.get(row.stapleHash) || null) : null;
			row.appliedFlags = result.flags;
			rows.push(row);

			if (row.direction === 'in') {
				stats.totalIn += row.amount;
			} else {
				stats.totalOut += row.amount;
			}

			for (const f of result.flags) {
				/*
				 * Suppressed gross-flow legs are counted but not listed --
				 * they cannot be represented in a tax report at all. Never
				 * silent: the count is always shown.
				 */
				if (f.suppressed) {
					stats.grossFlowSuppressed++;
					continue;
				}

				flagged.push({
					reason: f.reason,
					detail: {
						stapleHash: row.stapleHash,
						timestamp: row.timestamp,
						amountDisplay: formatUnits(row.amount, row.decimals),
						type: row.type,
						anchorNames: (f.anchors || []).map((a) => a.name).join(', '),
						grossInDisplay: f.grossIn !== undefined ? formatUnits(f.grossIn, row.decimals) : null,
						grossOutDisplay: f.grossOut !== undefined ? formatUnits(f.grossOut, row.decimals) : null,
						netDisplay: f.net !== undefined ? formatUnits(f.net, row.decimals) : null,
						hiddenLegRaw: f.hiddenLeg
					}
				});
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
		case REASONS.MULTI_TOKEN:
			return ('These staples moved **more than one token at once**. That is a trade or swap. This version of the tool handles KTA only, so it does not price or pair them. They are **excluded from the CSV entirely**, on purpose: splitting a trade into separate transfers would double-count it and distort your cost basis. You will need to enter these manually, or wait for multi-token support.');
		case REASONS.UNKNOWN_TOKEN:
			return ('These moved a **single non-KTA token**. Keeta does not publish decimal precision on-chain for tokens. Every token checked had empty metadata, so the tool cannot know whether a raw value means 1.0 or 0.000000001. Rather than guess a divisor and silently put a wrong number in your tax return, it refuses these rows.');
		case REASONS.GROSS_FLOW:
			return ('In these transactions KTA moved **both in and out at the same time**. Keeta bundles related movements together, so a single transaction can contain, say, a 5 KTA receipt and a 3 KTA payment at once.\n\n**These rows ARE in your CSV**, as a single net figure (in that example, a 2 KTA withdrawal). That is the real change to your balance. The individual legs are not shown. If you need gross figures rather than net, you will need to enter these manually. Both legs are listed below so you can see exactly what was combined.');
		case REASONS.POSSIBLE_BRIDGE:
			return ('These went to an address known to be a **bridge**. Moving KTA across a bridge is often just moving your own funds between your own holdings, which is usually **not** a taxable disposal. On-chain it looks identical to a sale.\n\n**These rows ARE in your CSV**, currently as ordinary withdrawals. Check each one.\n\n**How to fix one in CoinLedger:** if the receiving wallet is also imported, CoinLedger may pair the two sides for you. Look at its *Potential Bridges, Trades and Transfers* tab. If the receiving wallet is **not** imported, CoinLedger will see a withdrawal with nothing to match it against and will leave it as a disposal. In that case use its **Create Transfer** action on the row to pair it with the destination yourself.\n\n**Important, and please read this bit:** we detect *some* bridge transfers, not all. Only two bridge operators publish their addresses in a way we can read. **If you moved KTA to Base or anywhere else, check those rows yourself.** The tool cannot promise it caught them.');
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
		case REASONS.MULTI_TOKEN:
			return (d.legs.map((l) => {
				const name = l.symbol ? `${l.symbol}` : `\`${shortAddr(l.token)}\``;
				return (`${l.direction === 'in' ? '+' : '−'}${l.net.replace('-', '')} raw ${name}`);
			}).join(' / '));
		case REASONS.UNKNOWN_TOKEN:
			return (`${d.direction === 'in' ? 'received' : 'sent'} ${d.net.replace('-', '')} raw units of ${d.symbol ? d.symbol + ' ' : ''}\`${shortAddr(d.token)}\`, decimals unknown`);
		case REASONS.GROSS_FLOW:
			return (`in ${d.grossInDisplay} KTA / out ${d.grossOutDisplay} KTA → net ${d.netDisplay} KTA (${d.type}), in CSV as the net only`);
		case REASONS.POSSIBLE_BRIDGE:
			return (`${d.amountDisplay} KTA to ${d.anchorNames}. In CSV, verify yourself`);
		case REASONS.YEAR_BOUNDARY:
			return (`${d.amountDisplay} KTA (${d.type}). In CSV, confirm tax year`);
		case REASONS.NET_ZERO:
			return (`${d.tokens.length} token(s) touched, net zero`);
		default:
			return ('');
	}
}

const FLAG_ORDER = [
	REASONS.MULTI_TOKEN,
	REASONS.UNKNOWN_TOKEN,
	REASONS.GROSS_FLOW,
	REASONS.POSSIBLE_BRIDGE,
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
	L.push('## How to import');
	L.push('');
	L.push('1. In CoinLedger, go to **Import → Other Account** and upload the CSV.');
	L.push('2. When prompted about shared tickers, select **`KTA - Keeta`** (see above).');
	L.push('3. Review everything listed further down this file before filing.');
	L.push('');

	L.push('## About protocol fees');
	L.push('');
	L.push('**Fee columns in the CSV are deliberately left blank.** Keeta reports a per-staple aggregate called `feeUnits`, but the unit it is denominated in is not documented and could not be verified. Interpreting it as KTA base units produces implausibly small values (a typical fee would be about 0.000000000000002 KTA), which strongly suggests it is a different unit entirely.');
	L.push('');
	L.push(`Across this export the raw \`feeUnits\` total was **${stats.feeUnitsTotal.toString()}** across ${stats.staplesWithFee} staples. Rather than write a number we cannot justify into a tax document, the tool omits it and tells you here.`);
	L.push('');
	L.push('If your protocol fees are material to your filing, ask a professional how to treat them.');
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
	processHistory, buildCsv, toCsvRow, buildDescription,
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
