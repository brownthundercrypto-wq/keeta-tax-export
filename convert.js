/*
 * Phase 2. CLI converter.
 *
 * Usage:
 *   node convert.js <keeta_public_key> [--network main] [--raw]
 *
 * Outputs:
 *   output/coinledger-<shortkey>-<timestamp>.csv
 *   output/FLAGGED.md
 *   output/raw-<shortkey>-<timestamp>.json      (only with --raw)
 *
 * READ-ONLY. Public key only. Never accepts a seed or private key; the client
 * is constructed with signer=null.
 *
 * All conversion logic lives in lib/pipeline.js so that this CLI and the web
 * page in web/ run byte-for-byte identical code. This file is only argument
 * parsing, network fetch, and file I/O.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { UserClient, lib: KeetaNetLib } = require('@keetanetwork/keetanet-client');

const { formatUnits, formatCoinLedgerDate } = require('./lib/format');
const P = require('./lib/pipeline');

const OUT_DIR = path.join(__dirname, 'output');
const ADDRESS_BOOK = path.join(__dirname, 'data', 'known-addresses.json');

function parseArgs(argv) {
	const args = { publicKey: null, network: 'main', raw: false };

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--raw') {
			args.raw = true;
		} else if (a === '--network') {
			args.network = argv[++i];
		} else if (a.startsWith('--network=')) {
			args.network = a.slice('--network='.length);
		} else if (!args.publicKey) {
			args.publicKey = a;
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}

	if (!args.publicKey) {
		throw new Error('Usage: node convert.js <keeta_public_key> [--network main] [--raw]');
	}
	if (!P.NETWORKS[args.network]) {
		throw new Error(`Unknown network "${args.network}". Known: ${Object.keys(P.NETWORKS).join(', ')}`);
	}

	return (args);
}

async function main() {
	const args = parseArgs(process.argv);
	const publicKey = P.assertPublicKeyOnly(args.publicKey);

	const net = P.NETWORKS[args.network];
	const book = JSON.parse(fs.readFileSync(ADDRESS_BOOK, 'utf8'));
	const { bridgeAnchors, tokenRegistry } = P.indexAddressBook(book);

	const account = KeetaNetLib.Account.fromPublicKeyString(publicKey);
	const client = UserClient.fromNetwork(net.alias, null, { account: account });

	const baseToken = client.baseToken.publicKeyString !== undefined
		? String(client.baseToken.publicKeyString)
		: String(client.baseToken);

	console.log(`account:    ${publicKey}`);
	console.log(`network:    ${net.alias} (${net.networkIdHex})`);
	console.log(`base token: ${baseToken}  [${net.baseTokenSymbol}, ${net.baseTokenDecimals} decimals]`);
	console.log('');
	console.log('fetching history…');

	const started = Date.now();
	const history = await client.history();
	const fetchMs = Date.now() - started;

	console.log(`fetched ${history.length} vote staples in ${fetchMs}ms`);

	const networksSeen = P.assertNetworkMatches(history, net.networkIdHex);
	console.log(`network id verified in blocks: ${networksSeen.join(', ')}`);

	const memos = P.buildMemoIndex(client, history.map((e) => e.voteStaple));

	const ctx = {
		ourKey: publicKey,
		baseToken: baseToken,
		baseTokenSymbol: net.baseTokenSymbol,
		baseTokenDecimals: net.baseTokenDecimals,
		bridgeAnchors: bridgeAnchors,
		tokenRegistry: tokenRegistry,
		networkAlias: net.alias,
		networkIdHex: net.networkIdHex,
		memos: memos
	};

	const { rows, flagged, stats, dateRange } = P.processHistory(history, ctx);
	const groups = P.groupFlags(flagged);

	/* ---------- console summary BEFORE writing anything ---------- */
	console.log('');
	console.log('=================== SUMMARY ===================');
	console.log(`staples fetched:            ${stats.stapleCount}`);
	console.log(`rows emitted to CSV:        ${stats.rowsEmitted}`);
	console.log(`skipped (non-financial):    ${stats.skipped}`);
	console.log(`excluded (needs review):    ${stats.excluded}`);
	console.log('');
	console.log('flagged by reason:');
	for (const [reason, items] of groups) {
		console.log(`  ${String(items.length).padStart(6)}  ${reason}`);
	}
	if (groups.size === 0) {
		console.log('  (none)');
	}
	if (stats.grossFlowSuppressed > 0) {
		console.log(`  ${String(stats.grossFlowSuppressed).padStart(6)}  (suppressed: opposing leg below reporting precision)`);
	}
	console.log('');
	if (dateRange) {
		console.log(`date range:                 ${formatCoinLedgerDate(dateRange.from)}  ->  ${formatCoinLedgerDate(dateRange.to)}`);
	} else {
		console.log('date range:                 (no rows)');
	}
	console.log(`total in  (${net.baseTokenSymbol}):            ${formatUnits(stats.totalIn, net.baseTokenDecimals)}`);
	console.log(`total out (${net.baseTokenSymbol}):            ${formatUnits(stats.totalOut, net.baseTokenDecimals)}`);
	console.log(`raw feeUnits (not exported):${String(stats.feeUnitsTotal).padStart(14)}  across ${stats.staplesWithFee} staples`);
	console.log('===============================================');

	/* ---------- write files ---------- */
	fs.mkdirSync(OUT_DIR, { recursive: true });

	const shortKey = publicKey.slice(6, 14);
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const csvPath = path.join(OUT_DIR, `coinledger-${shortKey}-${stamp}.csv`);
	const flaggedPath = path.join(OUT_DIR, 'FLAGGED.md');

	fs.writeFileSync(csvPath, P.buildCsv(rows), { encoding: 'utf8' });
	fs.writeFileSync(flaggedPath, P.renderFlaggedMd(ctx, groups, stats, new Date().toISOString()), { encoding: 'utf8' });

	console.log('');
	console.log(`wrote ${csvPath}`);
	console.log(`wrote ${flaggedPath}`);

	if (args.raw) {
		const rawPath = path.join(OUT_DIR, `raw-${shortKey}-${stamp}.json`);
		const raw = history.map((e) => ({
			stapleHash: String(e.voteStaple.hash),
			voteStaple: e.voteStaple.toJSON(),
			effectsMetadata: e.effects && e.effects.metadata ? {
				blockCount: e.effects.metadata.blockCount,
				operationCount: e.effects.metadata.operationCount,
				feeUnits: String(e.effects.metadata.feeUnits)
			} : null
		}));
		fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2), { encoding: 'utf8' });
		console.log(`wrote ${rawPath}`);
	}

	client.destroy();
}

main().catch((err) => {
	console.error('');
	console.error('FAILED: ' + (err && err.message ? err.message : String(err)));
	process.exit(1);
});
