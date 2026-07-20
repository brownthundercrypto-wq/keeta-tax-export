/*
 * Anchor detection that does not depend on the registry being complete.
 *
 * ============================================================================
 * WHY THIS EXISTS: THE REGISTRY WAS THE CEILING, AND IT WAS TOO LOW
 * ============================================================================
 *
 * `data/known-addresses.json` was built by enumerating `keeta_` addresses in
 * the live service-discovery metadata at static.network.keeta.com. That found
 * two bridge anchors. Across eight real mainnet wallets, traffic to those two:
 * ZERO.
 *
 * Meanwhile every sampled wallet that sent a non-KTA token bridged through
 * `EVM_ANCHOR`, 98 outgoing legs in total. That address returns zero
 * occurrences in the metadata endpoint, so the enumeration could not see it.
 * It was found by looking at who wallets actually pay, then asking the chain
 * what that account says it is:
 *
 *     const st = await client.state({ account });
 *     st.info.name         // "EVM_ANCHOR"
 *     st.info.description  // "EVM Anchor Bridge Account"
 *
 * Anchors self-declare on-chain. Service-discovery metadata is a different set
 * from "accounts that behave as bridges", and treating the former as the latter
 * meant 98 real bridge transfers exported as clean disposals. Spec 5.1 calls
 * that the worst realistic output this tool can produce.
 *
 * So the registry is now a FLOOR, not a limit: it supplies verified provenance
 * and names, and this module catches anchors it never heard of.
 *
 * Two deliberate constraints:
 *
 *   - OUTGOING counterparties only. Spec 5.1's risk is a send to a bridge being
 *     reported as a disposal. Resolving every incoming counterparty as well
 *     would mean thousands of network calls on a busy wallet for a case that
 *     carries no disposal risk. Registry matching still covers both directions,
 *     because that is free.
 *   - An unreadable counterparty is NEVER assumed innocent. It is surfaced, so
 *     "we could not check" can never be silently rendered as "not a bridge".
 * ============================================================================
 */

(function () {
'use strict';

const ANCHOR_STATUS = {
	ANCHOR: 'self-declares as an anchor or bridge on-chain',
	NOT_ANCHOR: 'no anchor or bridge wording in its on-chain info',
	NO_INFO: 'account publishes no info, so it could not be checked',
	LOOKUP_FAILED: 'account could not be read from the network'
};

/*
 * Word-boundary matched so "anchor"/"bridge" have to appear as words. Loose
 * enough to catch an issuer who writes "Bridge Account" or "USDC anchor",
 * tight enough not to fire on an address that merely contains the letters.
 *
 * A false positive costs the user one review prompt on a row that is still
 * emitted. A false negative is a bridge silently reported as a disposal. The
 * asymmetry is why this errs toward matching.
 */
const ANCHOR_WORDS = /\b(anchor|bridge)\b/i;

function describesAnchor(info) {
	if (!info) {
		return (false);
	}
	const name = typeof info.name === 'string' ? info.name : '';
	const desc = typeof info.description === 'string' ? info.description : '';
	/* Underscored forms like EVM_ANCHOR do not word-break on their own. */
	const haystack = (name + ' ' + desc).replace(/[_\-]+/g, ' ');
	return (ANCHOR_WORDS.test(haystack));
}

/*
 * Resolve one counterparty. Never throws: a single unreadable account must not
 * abort an export, but it is recorded as unchecked rather than as clean.
 */
async function resolveAnchor(client, Account, address) {
	let info;
	try {
		const st = await client.state({ account: Account.fromPublicKeyString(address) });
		info = (st && st.info) ? st.info : null;   /* .info, NOT the wrapper */
	} catch (err) {
		return ({
			address,
			status: ANCHOR_STATUS.LOOKUP_FAILED,
			isAnchor: false,
			checked: false,
			detail: String(err && err.message).slice(0, 120)
		});
	}

	if (!info) {
		return ({ address, status: ANCHOR_STATUS.NO_INFO, isAnchor: false, checked: false });
	}

	const hit = describesAnchor(info);
	return ({
		address,
		status: hit ? ANCHOR_STATUS.ANCHOR : ANCHOR_STATUS.NOT_ANCHOR,
		isAnchor: hit,
		checked: true,
		name: (typeof info.name === 'string' && info.name.length) ? info.name : null,
		description: (typeof info.description === 'string' && info.description.length) ? info.description : null
	});
}

/*
 * Resolve many, one call each, cached by address. Addresses already in the
 * registry are skipped: they are known, and re-reading them wastes a call.
 */
async function resolveAnchors(client, Account, addresses, registryAnchors, onProgress) {
	const resolved = new Map();
	const unique = [...new Set(addresses)].filter(Boolean)
		.filter((a) => !(registryAnchors && registryAnchors.has(a)));

	let done = 0;
	for (const addr of unique) {
		/* eslint-disable no-await-in-loop -- one call per distinct counterparty */
		resolved.set(addr, await resolveAnchor(client, Account, addr));
		done++;
		if (typeof onProgress === 'function') {
			onProgress(done, unique.length);
		}
	}

	return (resolved);
}

/*
 * ============================================================================
 * ANCHOR PAYLOAD DECODING
 * ============================================================================
 *
 * `op.external` on an anchor transfer carries the anchor's instruction. THREE
 * distinct encodings exist on mainnet and none of them is universal. One wallet
 * produced only form A; two produced both B and C.
 *
 *   A. base64 -> DER wrapper -> zlib -> JSON, zlib header at offset ~15.
 *      { "a": { "<anchorAddress>": { "t": "<decimal id>" } }, "v": 1 }
 *      Inbound arrivals additionally carry "b": { "o": 0, "p": "<hash>" }.
 *      `p` resolves to a `previous` pointer in the ANCHOR's chain (93/93), not
 *      ours, so it identifies nothing about our transaction. Do not use it.
 *
 *   B. plain hex, 130 chars:
 *        01 | 32-byte id | 4 bytes | 8-byte chainId | 20-byte EVM address
 *      chainId was 0x2105 (8453, Base) on 26/26 observed. This names a CRYPTO
 *      destination and is matchable against that chain.
 *
 *   C. plain hex, 42 chars:
 *        00 00 00 00 03 | 16-byte RFC 4122 v4 UUID
 *      All observed were EURC leaving to a fiat rail. This is an ORDER
 *      REFERENCE, not a destination. It is matchable against nothing.
 *
 * A previous version of this project base64-decoded form B, got the byte
 * pattern d34d34d3... (which is simply base64-decoded ASCII "0000"), read it as
 * opaque binary, and concluded the Keeta side carries no EVM destination. That
 * conclusion pushed outbound bridge pairing out of scope for a release. Hence:
 * UNKNOWN is returned loudly and is never treated as "no destination".
 * ============================================================================
 */

const PAYLOAD_FORM = {
	ANCHOR_JSON: 'anchor-json',       /* A */
	CRYPTO_DEST: 'crypto-destination',/* B */
	FIAT_REF: 'fiat-reference',       /* C */
	UNKNOWN: 'unrecognised'
};

function inflateToJson(bytes) {
	/* Node only. The browser has no zlib, so form A degrades to UNKNOWN there
	 * rather than throwing. Forms B and C are pure string parsing and work in
	 * both, which is why attribution never depends on A alone. */
	if (typeof require !== 'function') {
		return (null);
	}
	let zlib;
	try { zlib = require('zlib'); } catch { return (null); }

	for (let i = 0; i < Math.min(bytes.length, 64); i++) {
		if (bytes[i] !== 0x78) {
			continue;
		}
		try {
			return (JSON.parse(zlib.inflateSync(bytes.subarray(i)).toString('utf8')));
		} catch { /* not the zlib stream, keep scanning */ }
	}
	return (null);
}

function decodeExternal(raw) {
	if (typeof raw !== 'string' || raw.length === 0) {
		return (null);
	}

	const hex = /^[0-9a-fA-F]+$/.test(raw) ? raw.toLowerCase() : null;

	/* Form B: crypto destination. */
	if (hex && hex.length === 130 && hex.startsWith('01')) {
		const chainId = parseInt(hex.slice(-56, -40), 16);
		return ({
			form: PAYLOAD_FORM.CRYPTO_DEST,
			id: hex.slice(2, 66),
			chainId: Number.isFinite(chainId) ? chainId : null,
			address: '0x' + hex.slice(-40),
			matchable: true
		});
	}

	/* Form C: fiat rail order reference. */
	if (hex && hex.length === 42 && hex.startsWith('00')) {
		const u = hex.slice(10);
		const isUuidV4 = u.length === 32 && u[12] === '4' && '89ab'.includes(u[16]);
		return ({
			form: PAYLOAD_FORM.FIAT_REF,
			tag: hex.slice(0, 10),
			orderRef: [u.slice(0, 8), u.slice(8, 12), u.slice(12, 16), u.slice(16, 20), u.slice(20)].join('-'),
			isUuidV4: isUuidV4,
			/* No second leg exists on any chain. Permanently unmatchable. */
			matchable: false
		});
	}

	/* Form A: base64 DER + zlib JSON. */
	if (typeof Buffer !== 'undefined' && !hex) {
		let bytes = null;
		try { bytes = Buffer.from(raw, 'base64'); } catch { bytes = null; }
		const json = bytes ? inflateToJson(bytes) : null;
		if (json && json.a && typeof json.a === 'object') {
			const anchors = Object.keys(json.a);
			const first = anchors.length ? json.a[anchors[0]] : null;
			return ({
				form: PAYLOAD_FORM.ANCHOR_JSON,
				anchors: anchors,
				id: first && first.t !== undefined ? String(first.t) : null,
				matchable: true
			});
		}
	}

	/* Anything else is surfaced, never assumed harmless. */
	return ({
		form: PAYLOAD_FORM.UNKNOWN,
		length: raw.length,
		sample: raw.slice(0, 24),
		matchable: false
	});
}

const API = { resolveAnchor, resolveAnchors, describesAnchor, ANCHOR_STATUS,
	decodeExternal, PAYLOAD_FORM };

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
