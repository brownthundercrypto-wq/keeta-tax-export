/*
 * Behavioural tests for the classifier and the CSV writer.
 *
 * These cover the rules where a bug would put a WRONG NUMBER in someone's tax
 * return rather than throw an error. Each test below corresponds to a mistake
 * that was actually made, or actually observed on mainnet, during development:
 *
 *   - isReceive was false on all 26,226 balance entries observed, including
 *     every incoming one. Using it as a direction flag inverts every deposit.
 *   - Real swaps net across a staple with the same token appearing on both
 *     sides, so per-entry rules misfire.
 *   - Keeta publishes no decimals for non-KTA tokens, so guessing a divisor is
 *     a silent 10^n error.
 *   - $JPY has 0 decimals, so "falsy means missing" corrupts it.
 *   - KTA is 18 decimals on mainnet and 9 on testnet.
 *
 * Run: node test/classify.test.js
 */

'use strict';

const { classifyStaple, REASONS, DUST_THRESHOLD_KTA } = require('../lib/classify');
const { formatUnits, parseUnits } = require('../lib/format');
const P = require('../lib/pipeline');

const OUR_KEY = 'keeta_ourtestaccount000000000000000000000000000000000000000000000';
const KTA = 'keeta_ktatoken00000000000000000000000000000000000000000000000000';
const OTHER_TOKEN = 'keeta_othertoken0000000000000000000000000000000000000000000000';
const BRIDGE = 'keeta_bridgeanchor000000000000000000000000000000000000000000000';
const PEER = 'keeta_counterparty00000000000000000000000000000000000000000000';

const CTX = {
	ourKey: OUR_KEY,
	baseToken: KTA,
	baseTokenSymbol: 'KTA',
	baseTokenDecimals: 18,
	bridgeAnchors: new Map([[BRIDGE, { address: BRIDGE, name: 'test-bridge' }]]),
	tokenRegistry: new Map([[OTHER_TOKEN, { address: OTHER_TOKEN, symbol: 'OTHER', decimals: undefined }]]),
	networkAlias: 'main',
	networkIdHex: '0x5382'
};

let failures = 0;

function check(name, actual, expected) {
	if (actual !== expected) {
		failures++;
		console.log(`  ✗ ${name}`);
		console.log(`      expected: ${JSON.stringify(expected)}`);
		console.log(`      actual:   ${JSON.stringify(actual)}`);
	} else {
		console.log(`  ✓ ${name}`);
	}
}

function checkTrue(name, cond, detail) {
	if (!cond) {
		failures++;
		console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
	} else {
		console.log(`  ✓ ${name}`);
	}
}

/* Build a balance entry as the SDK emits it. Note isReceive is false even for
 * incoming value; that is what mainnet actually returns. */
function entry(value, otherAccount, isReceive = false) {
	return ({ value: value, isReceive: isReceive, receivable: value > 0n, set: false, otherAccount: otherAccount });
}

function staple(balance, opts = {}) {
	const date = opts.date || new Date('2026-06-15T12:00:00Z');
	return ({
		voteStaple: {
			hash: opts.hash || 'STAPLEHASH0000000000000000000000000000000000000000000000000000',
			timestamp: () => date,
			toJSON: () => ({ blocks: opts.blocks || [{ network: '0x5382' }] })
		},
		effects: {
			accounts: balance === null ? {} : { [OUR_KEY]: { type: 'ACCOUNT', fields: balance } },
			metadata: { feeUnits: opts.feeUnits !== undefined ? opts.feeUnits : 2050n }
		}
	});
}

console.log('Direction comes from the sign of value, never isReceive');

{
	/* isReceive: false on an INCOMING entry. This is the real mainnet shape. */
	const r = classifyStaple(staple({ balance: { [KTA]: [entry(5n * 10n ** 18n, PEER, false)] } }), CTX);
	check('positive delta with isReceive=false is a Deposit', r.kind === 'row' ? r.row.type : r.kind, 'Deposit');
	check('  direction is in', r.row.direction, 'in');
	check('  amount is the magnitude', formatUnits(r.row.amount, 18), '5');
}
{
	const r = classifyStaple(staple({ balance: { [KTA]: [entry(-3n * 10n ** 18n, PEER, false)] } }), CTX);
	check('negative delta is a Withdrawal', r.row.type, 'Withdrawal');
	check('  amount is unsigned', formatUnits(r.row.amount, 18), '3');
}

console.log('');
console.log('Netting across a staple (the real swap shape)');

{
	/* Mirrors mainnet staple 74F743C3: same token both directions, plus a
	 * second token. Fees out, proceeds in. */
	const r = classifyStaple(staple({
		balance: {
			[KTA]: [entry(-70000000000000000n, PEER), entry(-77000000000000000n, PEER),
				entry(-50000000000000000n, PEER), entry(70050000000000000000n, PEER)],
			[OTHER_TOKEN]: [entry(-24902188797697885934532853n, PEER)]
		}
	}), CTX);
	check('two tokens net non-zero is excluded, not a row', r.kind, 'flag');
	check('  reason is multi-token', r.reason, REASONS.MULTI_TOKEN);
	check('  both legs reported', r.detail.legs.length, 2);
	const kta = r.detail.legs.find((l) => l.token === KTA);
	check('  KTA nets positive despite 3 negative entries', kta.net, '69853000000000000000');
	check('  KTA direction is in', kta.direction, 'in');
}
{
	/* Same token both ways, netting to a single direction: emitted, but the
	 * hidden leg must be surfaced. */
	const r = classifyStaple(staple({
		balance: { [KTA]: [entry(2n * 10n ** 18n, PEER), entry(-5n * 10n ** 18n, PEER)] }
	}), CTX);
	check('one token both directions still emits a row', r.kind, 'row');
	check('  net direction is out', r.row.direction, 'out');
	check('  net amount is 3', formatUnits(r.row.amount, 18), '3');
	const gf = r.flags.find((f) => f.reason === REASONS.GROSS_FLOW);
	checkTrue('  gross-flow flag raised', !!gf);
	check('  hidden leg is the smaller side', formatUnits(gf.hiddenLeg, 18), '2');
	check('  hidden leg NOT suppressed at 2 KTA', gf.suppressed, false);
}

console.log('');
console.log('Dust threshold (set by report precision, not by opinion)');

{
	const dust = parseUnits(DUST_THRESHOLD_KTA, 18);
	check('threshold parses to 1e10 base units at 18 decimals', dust.toString(), '10000000000');

	const r = classifyStaple(staple({
		balance: { [KTA]: [entry(1n, PEER), entry(-4040000000000000n, PEER)] }
	}), CTX);
	const gf = r.flags.find((f) => f.reason === REASONS.GROSS_FLOW);
	check('1 base unit hidden leg is suppressed', gf.suppressed, true);
	check('  but the net is still exact', r.row.amount.toString(), '4039999999999999');

	/* Just under and just over the line. */
	const under = classifyStaple(staple({ balance: { [KTA]: [entry(dust - 1n, PEER), entry(-(10n ** 18n), PEER)] } }), CTX);
	const over = classifyStaple(staple({ balance: { [KTA]: [entry(dust, PEER), entry(-(10n ** 18n), PEER)] } }), CTX);
	check('  one unit below threshold is suppressed', under.flags.find((f) => f.reason === REASONS.GROSS_FLOW).suppressed, true);
	check('  exactly at threshold is NOT suppressed', over.flags.find((f) => f.reason === REASONS.GROSS_FLOW).suppressed, false);
}

console.log('');
console.log('Unknown tokens hard-fail rather than assume a divisor');

{
	const r = classifyStaple(staple({ balance: { [OTHER_TOKEN]: [entry(1000000n, PEER)] } }), CTX);
	check('single non-KTA token is excluded', r.kind, 'flag');
	check('  reason is unknown token', r.reason, REASONS.UNKNOWN_TOKEN);
	check('  registry decimals are NOT trusted', r.detail.registryDecimals, null);
}
{
	checkTrue('formatUnits refuses undefined decimals', (() => {
		try { formatUnits(1n, undefined); return (false); } catch { return (true); }
	})(), 'must throw rather than default');
	check('0 decimals is valid and distinct from missing ($JPY)', formatUnits(12345n, 0), '12345');
	check('parseUnits at 0 decimals', parseUnits('123', 0).toString(), '123');
}

console.log('');
console.log('Network-dependent divisor (KTA is 18 on mainnet, 9 on testnet)');

{
	check('mainnet decimals', P.NETWORKS.main.baseTokenDecimals, 18);
	check('testnet decimals', P.NETWORKS.test.baseTokenDecimals, 9);
	check('same raw value, mainnet', formatUnits(10n ** 18n, P.NETWORKS.main.baseTokenDecimals), '1');
	check('same raw value, testnet', formatUnits(10n ** 18n, P.NETWORKS.test.baseTokenDecimals), '1000000000');

	let refused = false;
	try {
		P.assertNetworkMatches([{ voteStaple: { toJSON: () => ({ blocks: [{ network: '0x54455354' }] }) } }], '0x5382');
	} catch { refused = true; }
	checkTrue('testnet blocks on a mainnet run are refused', refused);
	check('matching network passes', P.assertNetworkMatches(
		[{ voteStaple: { toJSON: () => ({ blocks: [{ network: '0x5382' }] }) } }], '0x5382').join(), '0x5382');
}

console.log('');
console.log('Non-financial staples are skipped, not emitted as zero rows');

{
	check('no balance field is skipped', classifyStaple(staple({ permissions: [] }), CTX).kind, 'skip');
	check('account absent from effects is skipped', classifyStaple(staple(null), CTX).kind, 'skip');
	check('all tokens netting to zero is flagged, not silently dropped',
		classifyStaple(staple({ balance: { [KTA]: [entry(10n, PEER), entry(-10n, PEER)] } }), CTX).reason,
		REASONS.NET_ZERO);
}

console.log('');
console.log('Bridge and year-boundary flags');

{
	const r = classifyStaple(staple({ balance: { [KTA]: [entry(-(10n ** 18n), BRIDGE)] } }), CTX);
	check('send to a known bridge is still emitted', r.kind, 'row');
	checkTrue('  but flagged as a possible bridge', !!r.flags.find((f) => f.reason === REASONS.POSSIBLE_BRIDGE));

	const clean = classifyStaple(staple({ balance: { [KTA]: [entry(-(10n ** 18n), PEER)] } }), CTX);
	check('  unknown counterparty is NOT flagged as a bridge',
		clean.flags.filter((f) => f.reason === REASONS.POSSIBLE_BRIDGE).length, 0);
}
{
	const near = classifyStaple(staple({ balance: { [KTA]: [entry(10n ** 18n, PEER)] } },
		{ date: new Date('2025-12-31T23:59:01Z') }), CTX);
	checkTrue('31 Dec 23:59:01 is flagged near the year boundary',
		!!near.flags.find((f) => f.reason === REASONS.YEAR_BOUNDARY));

	const far = classifyStaple(staple({ balance: { [KTA]: [entry(10n ** 18n, PEER)] } },
		{ date: new Date('2026-06-15T12:00:00Z') }), CTX);
	check('  mid-year is not flagged',
		far.flags.filter((f) => f.reason === REASONS.YEAR_BOUNDARY).length, 0);
}

console.log('');
console.log('CSV row shape (CoinLedger rejects 0 / N/A in unused columns)');

{
	const ctx = { ...CTX, memos: new Map() };
	const { rows } = P.processHistory([
		staple({ balance: { [KTA]: [entry(10n ** 18n, PEER)] } }, { hash: 'AAA', date: new Date('2026-03-01T10:00:00Z') }),
		staple({ balance: { [KTA]: [entry(-(2n * 10n ** 18n), PEER)] } }, { hash: 'BBB', date: new Date('2026-02-01T10:00:00Z') })
	], ctx);

	check('rows are sorted oldest first', rows.map((r) => r.stapleHash).join(','), 'BBB,AAA');

	const csv = P.buildCsv(rows);
	const lines = csv.split('\r\n').filter(Boolean);
	const withdrawal = lines[1].split(',');
	const deposit = lines[2].split(',');

	check('CRLF line endings', csv.includes('\r\n'), true);
	check('withdrawal fills Asset Sent', withdrawal[2], 'KTA');
	check('withdrawal fills Amount Sent', withdrawal[3], '2');
	check('withdrawal leaves Asset Received BLANK', withdrawal[4], '');
	check('withdrawal leaves Amount Received BLANK', withdrawal[5], '');
	check('deposit leaves Asset Sent BLANK', deposit[2], '');
	check('deposit leaves Amount Sent BLANK', deposit[3], '');
	check('deposit fills Asset Received', deposit[4], 'KTA');
	check('fee columns are blank (denomination unverified)', withdrawal[6] + withdrawal[7], '');
	check('date has no ISO artifacts', /[TZ+]/.test(withdrawal[0]), false);
	check('date format', withdrawal[0], '02/01/2026 10:00:00');
}

console.log('');
if (failures > 0) {
	console.log(`FAILED - ${failures} assertion(s)`);
	process.exit(1);
}
console.log('All assertions passed.');
