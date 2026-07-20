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
 *   - Token decimals ARE published on-chain, in each token's info.metadata. An
 *     earlier version of this comment said they were not, which was a bug in
 *     how state() was read rather than a fact about the network. Guessing a
 *     divisor is still a silent 10^n error, so an unresolvable token fails
 *     loudly instead. See the BROKEN fixture below.
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
const SIX_DP = 'keeta_sixdecimaltoken000000000000000000000000000000000000000000';
const FIAT = 'keeta_fiattokenusd00000000000000000000000000000000000000000000';
const BROKEN = 'keeta_brokenmetadata000000000000000000000000000000000000000000';

/* Resolved token map, as lib/tokens.js produces it from ON-CHAIN metadata. */
function tokenInfo(o) {
	return (Object.assign({ status: 'ok', exportable: true, priceable: true }, o));
}

const TOKENS = new Map([
	[KTA,         tokenInfo({ address: KTA, symbol: 'KTA', decimals: 18 })],
	[OTHER_TOKEN, tokenInfo({ address: OTHER_TOKEN, symbol: 'MURF', decimals: 18, priceable: false })],
	[SIX_DP,      tokenInfo({ address: SIX_DP, symbol: 'USDC', decimals: 6 })],
	/* Currency balance on Keeta Personal: plain ticker, priceable, treated as
	 * cash. NOT renamed and NOT excluded. See lib/tokens.js for why. */
	[FIAT,        tokenInfo({ address: FIAT, symbol: 'USD', decimals: 2 })],
	[BROKEN,      { address: BROKEN, symbol: null, decimals: null, exportable: false,
	                status: 'token publishes no metadata, so its divisor is unknown', priceable: false }]
]);

const CTX = {
	ourKey: OUR_KEY,
	bridgeAnchors: new Map([[BRIDGE, { address: BRIDGE, name: 'test-bridge' }]]),
	tokens: TOKENS,
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
	/*
	 * Mirrors mainnet staple 74F743C3 exactly: KTA appears three times negative
	 * (routing fees) and once positive (proceeds), against one MURF leg. The
	 * hand-checked net is +69853000000000000000 KTA.
	 */
	const r = classifyStaple(staple({
		balance: {
			[KTA]: [entry(-70000000000000000n, PEER), entry(-77000000000000000n, PEER),
				entry(-50000000000000000n, PEER), entry(70050000000000000000n, PEER)],
			[OTHER_TOKEN]: [entry(-24902188797697885934532853n, PEER)]
		}
	}), CTX);
	check('one token in, one out is a TRADE row', r.kind, 'row');
	check('  row kind is trade', r.row.kind, 'trade');
	check('  sent leg is the net-negative token', r.row.sent.symbol, 'MURF');
	check('  sent amount is unsigned', r.row.sent.amount.toString(), '24902188797697885934532853');
	check('  received leg is the net-positive token', r.row.received.symbol, 'KTA');
	check('  KTA nets +69.853 despite 3 negative entries', r.row.received.amount.toString(), '69853000000000000000');
	check('  received formats correctly', formatUnits(r.row.received.amount, 18), '69.853');
	checkTrue('  unpriceable flag raised for MURF',
		!!r.flags.find((fl) => fl.reason === REASONS.UNPRICEABLE && fl.symbol === 'MURF'));
}
{
	/* Token launch: three tokens in, none out. Not a trade. */
	const r = classifyStaple(staple({
		balance: {
			[KTA]: [entry(10n ** 18n, PEER)],
			[OTHER_TOKEN]: [entry(10n ** 24n, PEER)],
			[SIX_DP]: [entry(1000n, PEER)]
		}
	}), CTX);
	check('three tokens in, none out is NOT a trade', r.kind, 'flag');
	check('  reason is multi-leg', r.reason, REASONS.MULTI_LEG);
	check('  in/out counts reported', r.detail.inCount + '/' + r.detail.outCount, '3/0');
}
{
	/* A trade between an 8-decimal and an 18-decimal asset must keep both. */
	const r = classifyStaple(staple({
		balance: {
			[SIX_DP]: [entry(-2797489383n, PEER)],
			[KTA]: [entry(1234567890123456789n, PEER)]
		}
	}), CTX);
	check('mixed-precision trade emits a row', r.row.kind, 'trade');
	check('  6dp leg keeps its precision', formatUnits(r.row.sent.amount, r.row.sent.decimals), '2797.489383');
	check('  18dp leg keeps its precision', formatUnits(r.row.received.amount, r.row.received.decimals), '1.234567890123456789');
}
{
	/* Excluded fiat poisons the whole staple: emitting the other leg alone
	 * would turn one trade into a phantom one-sided transfer. */
	const r = classifyStaple(staple({
		balance: { [FIAT]: [entry(-14977n, PEER)], [KTA]: [entry(10n ** 18n, PEER)] }
	}), CTX);
	check('trade against a currency balance IS exported', r.kind, 'row');
	check('  it is a trade', r.row.kind, 'trade');
	check('  currency keeps its plain ticker, not a renamed one', r.row.sent.symbol, 'USD');
	check('  currency uses its own 2 decimals', formatUnits(r.row.sent.amount, r.row.sent.decimals), '149.77');
	check('  currency is NOT flagged unpriceable',
		r.flags.filter((fl) => fl.reason === REASONS.UNPRICEABLE && fl.symbol === 'USD').length, 0);
}
{
	const r = classifyStaple(staple({ balance: { [FIAT]: [entry(-14977n, PEER)] } }), CTX);
	check('single currency transfer IS exported', r.kind, 'row');
	check('  ticker is the plain currency code', r.row.symbol, 'USD');
	check('  no unpriceable flag', r.flags.filter((fl) => fl.reason === REASONS.UNPRICEABLE).length, 0);
}
{
	const r = classifyStaple(staple({ balance: { [BROKEN]: [entry(500n, PEER)] } }), CTX);
	check('token with unreadable metadata is refused', r.reason, REASONS.UNRESOLVED_TOKEN);
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
	check('a readable non-KTA token now EXPORTS', r.kind, 'row');
	check('  uses the token own decimals', r.row.decimals, 18);
	check('  uses the token own symbol', r.row.symbol, 'MURF');
	checkTrue('  flagged as unpriceable', !!r.flags.find((fl) => fl.reason === REASONS.UNPRICEABLE));
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
	check('fee columns are blank when the staple carried no fee block', withdrawal[6] + withdrawal[7], '');
	check('date has no ISO artifacts', /[TZ+]/.test(withdrawal[0]), false);
	check('date format', withdrawal[0], '02/01/2026 10:00:00');
}

console.log('');
console.log('Trade CSV row: both pairs on ONE row, Type blank');

{
	const ctx = { ...CTX, memos: new Map() };
	const { rows } = P.processHistory([
		staple({ balance: { [OTHER_TOKEN]: [entry(-24902188797697885934532853n, PEER)],
		                    [KTA]: [entry(69853000000000000000n, PEER)] } },
			{ hash: 'TRADE1', date: new Date('2026-04-01T09:00:00Z') })
	], ctx);
	const line = P.buildCsv(rows).split(String.fromCharCode(13, 10))[1].split(',');
	check('Asset Sent is the net-negative token', line[2], 'MURF');
	check('Amount Sent filled', line[3], '24902188.797697885934532853');
	check('Asset Received is the net-positive token', line[4], 'KTA');
	check('Amount Received filled', line[5], '69.853');
	check('Fee Currency blank when no fee block', line[6], '');
	check('Fee Amount blank when no fee block', line[7], '');
	check('Type is BLANK so CoinLedger infers a trade', line[8], '');
	checkTrue('high-precision row is flagged, not rounded',
		P.processHistory([staple({ balance: { [OTHER_TOKEN]: [entry(-24902188797697885934532853n, PEER)],
			[KTA]: [entry(69853000000000000000n, PEER)] } }, { hash: 'T2' })], ctx).stats.highPrecisionRows === 1);
}

console.log('');
console.log('Network fees are read from the fee block, never guessed from size');

/*
 * The fee block as the SDK builds it in computeFeeBlock: purpose FEE, owned by
 * the payer, one SEND per vote, paid to a rotating payTo address that is NOT
 * the representative's voting identity.
 */
const REP_PAYOUT = ['keeta_payto1', 'keeta_payto2', 'keeta_payto3', 'keeta_payto4'];
const FEE_LEG = 1010000000000000n;      /* 1010 feeUnits, the observed constant */

function feeBlock(amount = FEE_LEG, token = KTA, account = OUR_KEY) {
	return ({
		purpose: 1,
		account: account,
		network: '0x5382',
		operations: REP_PAYOUT.map((to) => ({ type: 0, token: token, amount: amount, to: to }))
	});
}
/* The matching balance entries the fee legs produce in effects. */
function feeEntries(amount = FEE_LEG) {
	return (REP_PAYOUT.map((to) => entry(-amount, to)));
}

{
	/*
	 * THE MULTI_LEG DEFECT, reproduced exactly.
	 *
	 * 1.5 USDC out plus 0.00404 KTA of fees. Before the fix this netted to
	 * "two tokens out, none in", failed the trade test, and the whole staple
	 * was dropped from the CSV -- a real disposal silently missing. Observed on
	 * mainnet 60 times across six unrelated wallets.
	 */
	const r = classifyStaple(staple({
		balance: {
			[SIX_DP]: [entry(-1500000n, PEER)],
			[KTA]: feeEntries()
		}
	}, { blocks: [feeBlock()] }), CTX);

	check('a send plus its cross-token fee is a Withdrawal, not MULTI_LEG', r.kind, 'row');
	check('  the disposal is the non-fee token', r.row.symbol, 'USDC');
	check('  the amount is the principal, not the fee', formatUnits(r.row.amount, 6), '1.5');
	check('  the fee is carried as KTA', r.row.fee ? r.row.fee.symbol : null, 'KTA');
	check('  the fee is the exact sum of the fee block legs',
		r.row.fee ? formatUnits(r.row.fee.amount, 18) : null, '0.00404');
}
{
	/* Fee legs must not be mistaken for the principal on an ordinary send. */
	const r = classifyStaple(staple({
		balance: { [KTA]: [entry(-3n * 10n ** 18n, PEER)].concat(feeEntries()) }
	}, { blocks: [feeBlock()] }), CTX);
	check('same-token fee is split out of the principal', formatUnits(r.row.amount, 18), '3');
	check('  and reported as a fee', r.row.fee ? formatUnits(r.row.fee.amount, 18) : null, '0.00404');
}
{
	/* A fee block belonging to the COUNTERPARTY is not our expense. In a swap
	 * the other side publishes the staple and pays. */
	const r = classifyStaple(staple({
		balance: { [KTA]: [entry(-3n * 10n ** 18n, PEER)] }
	}, { blocks: [feeBlock(FEE_LEG, KTA, PEER)] }), CTX);
	check('a fee block owned by someone else is ignored', r.row.fee, null);
	check('  and does not touch our amount', formatUnits(r.row.amount, 18), '3');
}
{
	/* Nothing moved but the fee. Excluded, but never silently. */
	const r = classifyStaple(staple({
		balance: { [KTA]: feeEntries() }
	}, { blocks: [feeBlock()] }), CTX);
	check('a fee-only staple is flagged, not dropped', r.reason, REASONS.FEE_ONLY);
}
{
	/* Several tokens out and none in is a transfer of each, not a trade. */
	const r = classifyStaple(staple({
		balance: {
			[SIX_DP]: [entry(-1500000n, PEER)],
			[FIAT]: [entry(-2500n, PEER)],
			[KTA]: feeEntries()
		}
	}, { blocks: [feeBlock()] }), CTX);
	check('two real tokens out emits two rows', r.kind, 'rows');
	check('  one row per disposal', r.rows.length, 2);
	checkTrue('  the fee is attached to exactly one row',
		r.rows.filter((x) => x.row.fee !== null).length === 1);
}
{
	/* Tokens IN with none out stays flagged: a fee is always an outflow. */
	const r = classifyStaple(staple({
		balance: {
			[SIX_DP]: [entry(1500000n, PEER)],
			[FIAT]: [entry(2500n, PEER)]
		}
	}), CTX);
	check('several tokens in with none out is still MULTI_LEG', r.reason, REASONS.MULTI_LEG);
}
{
	/* The fee reaches the CSV columns. */
	const { rows } = P.processHistory([staple({
		balance: { [SIX_DP]: [entry(-1500000n, PEER)], [KTA]: feeEntries() }
	}, { blocks: [feeBlock()] })], CTX);
	const line = P.buildCsv(rows).split(String.fromCharCode(13, 10))[1].split(',');
	check('CSV Asset Sent is the principal', line[2], 'USDC');
	check('CSV Amount Sent is the principal', line[3], '1.5');
	check('CSV Fee Currency is the fee asset', line[6], 'KTA');
	check('CSV Fee Amount is exact', line[7], '0.00404');
	check('CSV Type is Withdrawal', line[8], 'Withdrawal');
}

console.log('');
console.log('Anchor wording must match what the account declares, not what we assume');

{
	/*
	 * A registry-listed BRIDGE may be described as a possible bridge. A merely
	 * self-declared anchor may not: "KYC Test Anchor Root" is a real mainnet
	 * account that matches anchor detection and is not a bridge at all. Telling
	 * someone a KYC check was a possible bridge invites them to mark a genuine
	 * disposal as a non-taxable self-transfer.
	 */
	const KYC = 'keeta_kycanchorroot00000000000000000000000000000000000000000000';
	const ctx = Object.assign({}, CTX, {
		anchors: new Map([[KYC, {
			address: KYC, isAnchor: true, checked: true,
			name: null, description: 'KYC Test Anchor Root'
		}]])
	});

	const bridged = classifyStaple(staple({
		balance: { [KTA]: [entry(-2n * 10n ** 18n, BRIDGE)] }
	}), ctx);
	check('a registry bridge is flagged as a possible bridge',
		bridged.flags.some((f) => f.reason === REASONS.POSSIBLE_BRIDGE), true);

	const declared = classifyStaple(staple({
		balance: { [KTA]: [entry(-2n * 10n ** 18n, KYC)] }
	}), ctx);
	check('a self-declared anchor is NOT called a bridge',
		declared.flags.some((f) => f.reason === REASONS.POSSIBLE_BRIDGE), false);
	check('  it gets its own reason instead',
		declared.flags.some((f) => f.reason === REASONS.DECLARED_ANCHOR), true);

	const { rows } = P.processHistory([staple({
		balance: { [KTA]: [entry(-2n * 10n ** 18n, KYC)] }
	}, { hash: 'KYC1' })], ctx);
	const desc = P.buildDescription(rows[0]);
	checkTrue('  the row description quotes the account’s own words',
		desc.includes('KYC Test Anchor Root'), desc);
	checkTrue('  and never asserts it was a bridge',
		!/bridge/i.test(desc), desc);
}

console.log('');
if (failures > 0) {
	console.log(`FAILED - ${failures} assertion(s)`);
	process.exit(1);
}
console.log('All assertions passed.');
