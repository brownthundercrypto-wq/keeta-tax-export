/*
 * Byte-for-byte assertion on the CoinLedger header row.
 *
 * WHY THIS TEST EXISTS: CoinLedger fingerprints the entire header line BEFORE
 * parsing any data row. A single character out of place rejects the whole file
 * — no partial import, no indication of which column was wrong. In testing, a
 * header taken from CoinLedger's own help article (which omits the "(Optional)"
 * suffixes) caused a total rejection. The source of truth is the Google Sheet
 * template, not the help article.
 *
 * If you change CSV_HEADERS in convert.js, this test must fail first.
 *
 * Run: node test/header.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { csvRow, formatCoinLedgerDate, formatUnits, csvField } = require('../lib/format');

/*
 * The known-good header, transcribed from the CoinLedger Universal Manual
 * Import Google Sheet template. Verified by a real successful import of 3,024
 * transactions on 2026-07-19.
 */
const EXPECTED_HEADER = 'Date (UTC),Platform (Optional),Asset Sent,Amount Sent,Asset Received,Amount Received,Fee Currency (Optional),Fee Amount (Optional),Type,Description (Optional),TxHash (Optional)';

let failures = 0;

function check(name, actual, expected) {
	const pass = actual === expected;
	if (!pass) {
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
		console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
	} else {
		console.log(`  ✓ ${name}`);
	}
}

console.log('CoinLedger header contract');

/* Pull CSV_HEADERS out of convert.js without executing main(). */
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
const m = src.match(/const CSV_HEADERS = \[([\s\S]*?)\];/);
if (!m) {
	console.log('  ✗ could not locate CSV_HEADERS in lib/pipeline.js');
	process.exit(1);
}
const headers = m[1]
	.split('\n')
	.map((l) => l.trim())
	.filter((l) => l.startsWith("'"))
	.map((l) => l.replace(/^'/, '').replace(/',?$/, ''));

check('header line matches template byte-for-byte', csvRow(headers), EXPECTED_HEADER);
checkTrue('exactly 11 columns', headers.length === 11, `got ${headers.length}`);

/* The five "(Optional)" columns must keep their suffix. Dropping them was the
 * exact bug that caused the first import to be rejected outright. */
const mustHaveOptional = ['Platform', 'Fee Currency', 'Fee Amount', 'Description', 'TxHash'];
for (const base of mustHaveOptional) {
	checkTrue(`"${base}" retains the (Optional) suffix`, headers.includes(`${base} (Optional)`));
}

/* These five must NOT carry a suffix. */
for (const base of ['Date (UTC)', 'Asset Sent', 'Amount Sent', 'Asset Received', 'Amount Received', 'Type']) {
	checkTrue(`"${base}" has no (Optional) suffix`, headers.includes(base));
}

/* The embedded guard string in convert.js must agree with this test. */
const guard = src.match(/const CSV_HEADER_LINE = '([^']+)';/);
checkTrue('pipeline.js CSV_HEADER_LINE guard is present', !!guard);
if (guard) {
	check('pipeline.js guard matches template', guard[1], EXPECTED_HEADER);
}

console.log('');
console.log('Timestamp contract (CoinLedger rejects T / Z / +)');

check('formats as mm/dd/yyyy hh:mm:ss', formatCoinLedgerDate(new Date('2026-06-30T22:15:27.697Z')), '06/30/2026 22:15:27');
check('midnight boundary', formatCoinLedgerDate(new Date('2026-01-01T00:00:00Z')), '01/01/2026 00:00:00');
checkTrue('no forbidden characters', !/[TZ+]/.test(formatCoinLedgerDate(new Date('2026-12-31T23:59:59Z'))));

console.log('');
console.log('Amount contract (explorer-verified values)');

check('1 base unit @18', formatUnits(1n, 18), '0.000000000000000001');
check('5e16 @18', formatUnits(50000000000000000n, 18), '0.05');
check('1e19 @18', formatUnits(10000000000000000000n, 18), '10');
check('0-decimal token keeps integer', formatUnits(12345n, 0), '12345');
checkTrue('refuses undefined decimals', (() => {
	try { formatUnits(1n, undefined); return (false); } catch { return (true); }
})(), 'must throw rather than default a divisor');

console.log('');
console.log('Blank-field contract (CoinLedger rejects 0 / N/A / ---)');

check('null renders blank', csvField(null), '');
check('undefined renders blank', csvField(undefined), '');
check('empty string stays blank', csvField(''), '');

console.log('');
if (failures > 0) {
	console.log(`FAILED — ${failures} assertion(s)`);
	process.exit(1);
}
console.log('All assertions passed.');
