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

const API = { resolveAnchor, resolveAnchors, describesAnchor, ANCHOR_STATUS };

if (typeof module !== 'undefined' && module.exports) {
	module.exports = API;
}
if (typeof globalThis !== 'undefined') {
	globalThis.KeetaTax = globalThis.KeetaTax || {};
	Object.assign(globalThis.KeetaTax, API);
}

}());
