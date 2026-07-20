/*
 * Every shipped script must PARSE.
 *
 * This exists because a syntax error reached production and broke the live
 * tool. `web/app.js` was published containing `(async () => { ... }())`, which
 * is invalid: the trailing `}())` form only works for a function EXPRESSION,
 * and an arrow body swallows the invocation parens. The rest of the file uses
 * `(function () { ... }())`, and that style was pattern-matched onto an arrow.
 *
 * Nothing caught it. The unit tests exercise lib/*.js directly and never load
 * web/app.js, so `npm test` stayed green while the page had no working button.
 * The browser parity check also passed, because it drives the pipeline through
 * globalThis.KeetaTax rather than through the app's own entry point. Both
 * verified the library and neither verified the application.
 *
 * A parse failure is the cheapest possible bug to catch and the most expensive
 * to ship: the page loads, the markup renders, and every handler is silently
 * missing.
 *
 * Run: node test/parse.test.js
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

/* Everything the browser loads, plus the CLI entry point. */
const SHIPPED = [
	'web/app.js',
	'lib/format.js',
	'lib/tokens.js',
	'lib/anchors.js',
	'lib/classify.js',
	'lib/pipeline.js',
	'convert.js'
];

let failures = 0;

console.log('Every shipped script parses');

for (const rel of SHIPPED) {
	const abs = path.join(ROOT, rel);

	if (!fs.existsSync(abs)) {
		failures++;
		console.log(`  ✗ ${rel} is listed here but does not exist`);
		continue;
	}

	try {
		execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
		console.log(`  ✓ ${rel}`);
	} catch (err) {
		failures++;
		const detail = String((err && err.stderr) || err).split('\n').slice(0, 4).join('\n      ');
		console.log(`  ✗ ${rel} DOES NOT PARSE`);
		console.log(`      ${detail}`);
	}
}

/*
 * A regex guard for the specific `(() => {}())` shape was tried here and
 * removed: it matched an arrow anywhere inside a file's outer IIFE and flagged
 * two clean files. `node --check` is the complete and exact test, so a
 * heuristic on top of it adds noise without adding safety.
 */

console.log('');
if (failures > 0) {
	console.log(`FAILED - ${failures} problem(s)`);
	process.exit(1);
}
console.log('All shipped scripts parse.');
