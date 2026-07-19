/*
 * Token identity resolution.
 *
 * ============================================================================
 * THE CHAIN IS THE SOURCE OF TRUTH FOR DECIMALS. The registry is a cross-check.
 * ============================================================================
 *
 * Every Keeta token publishes its own divisor on-chain:
 *
 *     const st   = await client.state({ account: tokenAccount });
 *     const info = st.info;                          // NOTE: st.info, not st
 *     const meta = JSON.parse(Buffer.from(info.metadata, 'base64').toString());
 *     meta.decimalPlaces;
 *
 * `client.state()` returns a WRAPPER, and the fields live one level down on
 * `.info`. Reading `.metadata` off the wrapper returns undefined for every
 * token with no error, which looks exactly like a chain that publishes nothing.
 * An earlier version of this project drew that conclusion and shipped an
 * unnecessary hard-fail because of it. Do not "simplify" the `.info` access.
 *
 * Rules encoded here, each of which prevents a wrong number reaching a return:
 *
 *   - Chain wins, registry cross-checks. If they DISAGREE we do not pick one.
 *     A disagreement means one of our two sources is wrong about a divisor, and
 *     silently choosing either could be a power-of-ten error. Fail that token.
 *   - Missing or unparseable metadata is a hard fail, not a default. Nothing
 *     forces an issuer to set it, and there is no safe fallback.
 *   - `decimalPlaces: 0` is VALID (JPY is 0). Never treat 0 as absent.
 *   - Lookups are cached per token address. A wallet touching 9 tokens across
 *     2,000 staples must make 9 calls, not thousands.
 */

/*
 * IIFE-wrapped: the browser loads these as plain <script> tags and classic
 * scripts share ONE global scope. Cross-file access goes through
 * globalThis.KeetaTax.
 */
(function () {
'use strict';

/* Why a token cannot be exported. */
const TOKEN_STATUS = {
	OK: 'ok',
	NO_METADATA: 'token publishes no metadata, so its divisor is unknown',
	UNPARSEABLE: 'token metadata could not be decoded, so its divisor is unknown',
	NO_DECIMALS: 'token metadata has no decimalPlaces field, so its divisor is unknown',
	CONFLICT: 'on-chain decimals disagree with the reference registry',
	EXCLUDED: 'token is deliberately excluded from export',
	LOOKUP_FAILED: 'token account could not be read from the network'
};

/*
 * Base64 -> UTF-8, in Node AND in the browser.
 *
 * The page runs with no polyfills (verified), so `Buffer` does not exist there.
 * Using it unguarded would make the browser silently fail to read any token's
 * decimals while Node succeeded, which is exactly the CLI/browser divergence
 * the shared-lib design exists to prevent.
 */
function base64ToUtf8(b64) {
	if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
		return (Buffer.from(b64, 'base64').toString('utf8'));
	}

	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}
	return (new TextDecoder('utf-8').decode(bytes));
}

function decodeMetadata(raw) {
	if (typeof raw !== 'string' || raw.length === 0) {
		return ({ ok: false, status: TOKEN_STATUS.NO_METADATA });
	}

	/* Some issuers may store plain JSON rather than base64. Try both. */
	let parsed = null;
	try {
		parsed = JSON.parse(raw);
	} catch {
		try {
			parsed = JSON.parse(base64ToUtf8(raw));
		} catch {
			return ({ ok: false, status: TOKEN_STATUS.UNPARSEABLE });
		}
	}

	if (!parsed || typeof parsed !== 'object') {
		return ({ ok: false, status: TOKEN_STATUS.UNPARSEABLE });
	}

	/*
	 * `decimalPlaces` is what Keeta tokens actually use. `decimals` is accepted
	 * as a courtesy in case another issuer follows the EVM convention.
	 * Both must be checked with !== undefined, never truthiness: 0 is valid.
	 */
	let d = parsed.decimalPlaces;
	if (d === undefined) {
		d = parsed.decimals;
	}

	if (d === undefined || d === null) {
		return ({ ok: false, status: TOKEN_STATUS.NO_DECIMALS, meta: parsed });
	}

	if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 100) {
		return ({ ok: false, status: TOKEN_STATUS.UNPARSEABLE, meta: parsed });
	}

	return ({ ok: true, decimals: d, meta: parsed });
}

/*
 * Resolve one token. Returns a record; never throws for a bad token, because a
 * single unreadable token must not abort a whole export.
 */
async function resolveToken(client, Account, address, registryEntry) {
	const reg = registryEntry || null;

	if (reg && reg.excluded === true) {
		return ({
			address, status: TOKEN_STATUS.EXCLUDED, exportable: false,
			symbol: reg.symbol || null, decimals: null,
			excludedReason: reg.excludedReason || null,
			priceable: reg.priceable === true
		});
	}

	let info;
	try {
		const st = await client.state({ account: Account.fromPublicKeyString(address) });
		info = (st && st.info) ? st.info : null;      /* .info, NOT the wrapper */
	} catch (err) {
		return ({
			address, status: TOKEN_STATUS.LOOKUP_FAILED, exportable: false,
			symbol: reg ? reg.symbol : null, decimals: null,
			detail: String(err && err.message).slice(0, 120),
			priceable: reg ? reg.priceable === true : false
		});
	}

	if (!info) {
		return ({
			address, status: TOKEN_STATUS.NO_METADATA, exportable: false,
			symbol: reg ? reg.symbol : null, decimals: null,
			priceable: reg ? reg.priceable === true : false
		});
	}

	const decoded = decodeMetadata(info.metadata);
	const onChainSymbol = (typeof info.name === 'string' && info.name.length) ? info.name : null;

	if (!decoded.ok) {
		return ({
			address, status: decoded.status, exportable: false,
			symbol: onChainSymbol || (reg ? reg.symbol : null), decimals: null,
			description: info.description || null,
			priceable: reg ? reg.priceable === true : false
		});
	}

	/*
	 * Cross-check. A disagreement is NOT resolved by preferring one source:
	 * one of them is wrong about a divisor, and either choice risks a
	 * power-of-ten error in a tax figure. Refuse the token and surface both.
	 */
	if (reg && reg.decimals !== undefined && reg.decimals !== null && reg.decimals !== decoded.decimals) {
		return ({
			address, status: TOKEN_STATUS.CONFLICT, exportable: false,
			symbol: onChainSymbol || reg.symbol, decimals: null,
			onChainDecimals: decoded.decimals,
			registryDecimals: reg.decimals,
			priceable: reg.priceable === true
		});
	}

	return ({
		address,
		status: TOKEN_STATUS.OK,
		exportable: true,
		decimals: decoded.decimals,
		symbol: onChainSymbol || (reg ? reg.symbol : null),
		description: info.description || null,
		/* Unknown tokens are assumed unpriceable. Conservative on purpose: it
		 * produces a warning, never a silently wrong price. */
		priceable: reg ? reg.priceable === true : false,
		crossChecked: !!(reg && reg.decimals === decoded.decimals),
		registryDecimals: reg ? reg.decimals : null
	});
}

/*
 * Resolve many tokens with one network call each, cached by address.
 * `onProgress(done, total)` is optional.
 */
async function resolveTokens(client, Account, addresses, registryMap, onProgress) {
	const resolved = new Map();
	const unique = [...new Set(addresses)].filter(Boolean);

	let done = 0;
	for (const addr of unique) {
		if (!resolved.has(addr)) {
			/* eslint-disable no-await-in-loop -- one call per distinct token */
			resolved.set(addr, await resolveToken(client, Account, addr, registryMap.get(addr)));
		}
		done++;
		if (typeof onProgress === 'function') {
			onProgress(done, unique.length);
		}
	}

	return (resolved);
}

const API = { resolveToken, resolveTokens, decodeMetadata, TOKEN_STATUS };

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
