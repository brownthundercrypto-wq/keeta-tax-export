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

/*
 * ONE inflate implementation for Node AND the browser.
 *
 * `DecompressionStream` is a web standard present in Node 18+, Chrome, Firefox
 * and Safari 16.4+, so both sides run the SAME code and produce the same bytes.
 * An earlier version used Node's `zlib` and let the browser fall through to
 * UNKNOWN, which was worse than it sounds: it broke the byte-identical
 * guarantee AND reproduced the exact failed-decode-reads-as-absence pattern
 * this project has been bitten by twice.
 *
 * If the runtime has no DecompressionStream we THROW rather than degrade. A
 * shared limitation is acceptable; a silent divergence between the CLI and the
 * page is not.
 *
 * The payload is `0x78`-prefixed, i.e. zlib-wrapped (RFC 1950), which is what
 * 'deflate' means here. 'deflate-raw' would be for a bare RFC 1951 stream.
 */
/*
 * Base64 -> bytes, identically in Node and the browser.
 *
 * `atob` is standard in both, but it is STRICT where `Buffer.from(s,'base64')`
 * is lenient: it rejects missing padding, whitespace, and the base64url
 * alphabet. Swapping Buffer for a bare atob silently broke 50 inbound anchor
 * instructions, which then reported as "unrecognised" -- the same
 * failed-decode-reads-as-absence trap, introduced while fixing an instance of
 * it. So normalise first, then decode.
 */
function base64ToBytes(s) {
	try {
		let t = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
		const pad = t.length % 4;
		if (pad === 2) { t += '=='; } else if (pad === 3) { t += '='; } else if (pad === 1) { return (null); }
		const bin = atob(t);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
		return (out);
	} catch {
		return (null);
	}
}

async function inflate(bytes) {
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			'DecompressionStream is unavailable in this runtime, so anchor ' +
			'instructions cannot be decoded. Node 18+ or a current browser is required.'
		);
	}
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
	const buf = await new Response(stream).arrayBuffer();
	return (new TextDecoder('utf-8').decode(buf));
}

/*
 * The zlib stream sits after a DER wrapper, so scan for its header rather than
 * assuming an offset. Observed at 15 and 16 on real staples.
 */
/*
 * Length of the DER OCTET STRING whose contents begin at `z`, or null.
 *
 * This matters more than it looks. `zlib.inflateSync` silently tolerates bytes
 * after the end of a compressed stream; `DecompressionStream` rejects them with
 * "Trailing junk found after the end of the compressed stream". Real inbound
 * payloads carry 127 such bytes, so slicing to end-of-buffer works in Node and
 * fails in the browser -- a divergence that would only appear on the wallets
 * that matter most. Read the declared length and slice exactly.
 *
 *   ... 04 81 b6 78 9c ...     tag 0x04, long form, one length byte (0xb6)
 */
function derOctetLength(bytes, z) {
	if (z >= 2 && bytes[z - 2] === 0x04 && bytes[z - 1] < 0x80) {
		return (bytes[z - 1]);
	}
	if (z >= 3 && bytes[z - 3] === 0x04 && bytes[z - 2] === 0x81) {
		return (bytes[z - 1]);
	}
	if (z >= 4 && bytes[z - 4] === 0x04 && bytes[z - 3] === 0x82) {
		return ((bytes[z - 2] << 8) | bytes[z - 1]);
	}
	return (null);
}

async function inflateToJson(bytes) {
	for (let i = 0; i < Math.min(bytes.length, 64); i++) {
		if (bytes[i] !== 0x78) {
			continue;
		}

		const declared = derOctetLength(bytes, i);
		/* Exact slice first; end-of-buffer only as a fallback for payloads with
		 * no trailing data, so behaviour is the same on both runtimes. */
		const candidates = [];
		if (declared !== null && i + declared <= bytes.length) {
			candidates.push(bytes.subarray(i, i + declared));
		}
		candidates.push(bytes.subarray(i));

		for (const slice of candidates) {
			try {
				return (JSON.parse(await inflate(slice)));
			} catch (err) {
				/* A missing DecompressionStream is a runtime fault, not a bad
				 * candidate. Surface it rather than scanning past it. */
				if (String(err && err.message).indexOf('DecompressionStream is unavailable') !== -1) {
					throw err;
				}
			}
		}
	}
	return (null);
}

/*
 * Async because form A needs DecompressionStream. Forms B and C are pure string
 * parsing, but they share the signature so callers never branch on form.
 *
 * Decoding happens ONCE per staple in a prefetch step (see
 * pipeline.prefetchPayloads) so that classification stays synchronous and the
 * CLI and the page run identical, ordered work.
 */
async function decodeExternal(raw) {
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
	if (!hex) {
		const bytes = base64ToBytes(raw);
		const json = bytes ? await inflateToJson(bytes) : null;
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
