/*
 * Formatting helpers. Every function here is a place where a silent wrong
 * number could enter a tax filing, so each one is deliberately dumb and exact.
 */

/*
 * IIFE-wrapped so these names stay private.
 *
 * The browser loads lib/*.js as plain <script> tags, and classic scripts all
 * share ONE global scope. Without this wrapper, `function parseUnits` here and
 * `const parseUnits` in classify.js collide into a parse-time SyntaxError that
 * silently prevents the second file from registering anything at all -- the
 * page then fails with a confusing "undefined" rather than a clear error.
 * Everything crosses file boundaries through globalThis.KeetaTax only.
 */
(function () {
'use strict';

/*
 * bigint base units -> decimal string, using the token's divisor.
 *
 * Never routes through Number: 2^53 is ~9e15 and KTA amounts are routinely
 * larger than that in base units, so Number would lose precision silently.
 *
 * decimals === 0 is VALID and distinct from undefined ($JPY is a 0-decimal
 * token). Callers must pass a real number; this throws on undefined/null
 * rather than defaulting, because defaulting a divisor is the single most
 * dangerous thing this codebase could do.
 */
function formatUnits(value, decimals) {
	if (typeof value !== 'bigint') {
		throw new TypeError(`formatUnits: expected bigint, got ${typeof value}`);
	}

	if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) {
		throw new TypeError(`formatUnits: decimals must be a non-negative integer, got ${String(decimals)}. Refusing to assume a divisor.`);
	}

	const negative = value < 0n;
	const abs = negative ? -value : value;

	if (decimals === 0) {
		return ((negative ? '-' : '') + abs.toString());
	}

	const padded = abs.toString().padStart(decimals + 1, '0');
	const intPart = padded.slice(0, padded.length - decimals);
	const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '');

	return ((negative ? '-' : '') + intPart + (fracPart ? '.' + fracPart : ''));
}

/*
 * Decimal string -> bigint base units. The inverse of formatUnits.
 *
 * Takes a STRING, never a Number: 1e-8 as a float is not exactly 1e-8, and
 * thresholds derived from floats drift with the token's decimal count.
 */
function parseUnits(decimalString, decimals) {
	if (typeof decimalString !== 'string') {
		throw new TypeError(`parseUnits: expected a string, got ${typeof decimalString}. Pass '0.00000001', not 1e-8.`);
	}

	if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) {
		throw new TypeError(`parseUnits: decimals must be a non-negative integer, got ${String(decimals)}`);
	}

	const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(decimalString.trim());
	if (!m) {
		throw new TypeError(`parseUnits: cannot parse "${decimalString}"`);
	}

	const sign = m[1] === '-' ? -1n : 1n;
	const whole = m[2] || '0';
	const frac = (m[3] || '').slice(0, decimals).padEnd(decimals, '0');

	return (sign * BigInt(whole + frac));
}

/*
 * CoinLedger's required timestamp format: mm/dd/yyyy hh:mm:ss
 *
 * Their docs name stray "T", "Z", and "+" characters as the single most common
 * cause of failed imports, so this deliberately builds the string field by
 * field from UTC components rather than transforming an ISO string -- there is
 * no code path here that could leak an ISO artifact through.
 */
function formatCoinLedgerDate(date) {
	if (!(date instanceof Date) || isNaN(date.getTime())) {
		throw new TypeError('formatCoinLedgerDate: invalid Date');
	}

	const p2 = (n) => String(n).padStart(2, '0');

	const mm = p2(date.getUTCMonth() + 1);
	const dd = p2(date.getUTCDate());
	const yyyy = String(date.getUTCFullYear());
	const hh = p2(date.getUTCHours());
	const mi = p2(date.getUTCMinutes());
	const ss = p2(date.getUTCSeconds());

	const out = `${mm}/${dd}/${yyyy} ${hh}:${mi}:${ss}`;

	/* Belt and braces: assert no forbidden character ever escapes. */
	if (/[TZ+]/.test(out)) {
		throw new Error(`formatCoinLedgerDate produced a forbidden character: ${out}`);
	}

	return (out);
}

/*
 * RFC 4180 style field escaping. Quote only when necessary; a field containing
 * a quote doubles it. Blank stays genuinely blank -- never "0", "N/A", "---",
 * which CoinLedger rejects outright.
 */
function csvField(value) {
	if (value === null || value === undefined || value === '') {
		return ('');
	}

	const s = String(value);

	if (/[",\r\n]/.test(s)) {
		return ('"' + s.replace(/"/g, '""') + '"');
	}

	return (s);
}

function csvRow(fields) {
	return (fields.map(csvField).join(','));
}

/* Short, human-scannable form of a Keeta address for logs and descriptions. */
function shortAddr(addr) {
	if (typeof addr !== 'string' || addr.length < 16) {
		return (String(addr));
	}
	return (addr.slice(0, 12) + '…' + addr.slice(-6));
}

/*
 * Dual export: CommonJS for the Node CLI, and a global for the browser page,
 * which loads these files with plain <script> tags and no build step.
 *
 * The browser and the CLI MUST run the same code. Two implementations of the
 * same arithmetic is exactly how a divergence gets shipped without either side
 * looking wrong on its own.
 */
const API = { formatUnits, parseUnits, formatCoinLedgerDate, csvField, csvRow, shortAddr };

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
