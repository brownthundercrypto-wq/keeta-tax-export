/*
 * Web tool, Phase 3.
 *
 * This file is GLUE ONLY: DOM wiring, progress reporting, and Blob downloads.
 * Every decision that affects what lands in a tax report comes from ../lib/,
 * the same files the Node CLI requires. Do not reimplement any of it here --
 * two implementations of the same rule is how the browser and the CLI silently
 * disagree.
 *
 * The address never leaves the browser except in requests to Keeta's own nodes.
 * There is no backend. Keep it that way: if a change here would route the
 * address through any server we control, it is the wrong change.
 */

'use strict';

(function () {
	const K = globalThis.KeetaTax;
	const NETWORK = 'main';

	const $ = (id) => document.getElementById(id);

	const el = {
		stateInput: $('state-input'),
		stateProgress: $('state-progress'),
		stateReview: $('state-review'),
		stateDownload: $('state-download'),
		addr: $('addr'),
		go: $('go'),
		inputError: $('input-error'),
		pStaples: $('p-staples'),
		pPages: $('p-pages'),
		pElapsed: $('p-elapsed'),
		pStatus: $('p-status'),
		rStats: $('r-stats'),
		rRange: $('r-range'),
		rFlagSummary: $('r-flagsummary'),
		toDownload: $('to-download'),
		dlCsv: $('dl-csv'),
		dlMd: $('dl-md'),
		mdView: $('md-view')
	};

	let result = null;

	function show(section) {
		for (const s of [el.stateInput, el.stateProgress, el.stateReview, el.stateDownload]) {
			s.classList.add('hidden');
		}
		section.classList.remove('hidden');
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function showInputError(msg) {
		el.inputError.textContent = msg;
		el.inputError.classList.remove('hidden');
	}

	function clearInputError() {
		el.inputError.textContent = '';
		el.inputError.classList.add('hidden');
	}

	/* Minimal inline markdown -> HTML for the explanation strings in lib/.
	 * Deliberately tiny: **bold**, `code`, and paragraph breaks only. */
	function mdInline(s) {
		const esc = String(s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return (esc
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>')
			.replace(/`([^`]+)`/g, '<code>$1</code>'));
	}

	function mdBlock(s) {
		return (String(s).split('\n\n').map((p) => `<p>${mdInline(p)}</p>`).join(''));
	}

	function statCard(k, v) {
		return (`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`);
	}

	/*
	 * Live progress. client.history() paginates internally and exposes no
	 * callback, so rather than reimplement pagination (and risk diverging from
	 * the tested path) we temporarily wrap fetch, clone each response, and
	 * count the staples the node actually returned. Pagination logic is
	 * untouched; we are only observing it.
	 */
	function withFetchProgress(onProgress) {
		const original = window.fetch;
		let pages = 0;
		let staples = 0;

		window.fetch = async function (...args) {
			const res = await original.apply(this, args);
			try {
				const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
				if (url.includes('/history')) {
					const copy = res.clone();
					const body = await copy.json();
					if (body && Array.isArray(body.history)) {
						pages++;
						staples += body.history.length;
						onProgress({ pages, staples });
					}
				}
			} catch {
				/* Progress is cosmetic; never let it break the fetch. */
			}
			return (res);
		};

		return (() => { window.fetch = original; });
	}

	function download(filename, text, mime) {
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function run() {
		clearInputError();

		let publicKey;
		try {
			publicKey = K.assertPublicKeyOnly(el.addr.value);
		} catch (err) {
			showInputError(err.message);
			return;
		}

		if (typeof globalThis.KeetaNet === 'undefined') {
			showInputError('The Keeta SDK did not load. Check your connection and reload the page.');
			return;
		}

		show(el.stateProgress);
		el.pStatus.textContent = 'Connecting to Keeta…';

		const t0 = Date.now();
		const timer = setInterval(() => {
			el.pElapsed.textContent = Math.round((Date.now() - t0) / 1000) + 's';
		}, 500);

		const restoreFetch = withFetchProgress(({ pages, staples }) => {
			el.pPages.textContent = String(pages);
			el.pStaples.textContent = String(staples);
			el.pStatus.textContent = 'Reading transaction history…';
		});

		let client = null;
		try {
			const net = K.NETWORKS[NETWORK];

			/* Address book ships as static JSON next to the page. */
			const book = await (await fetch('../data/known-addresses.json')).json();
			const { bridgeAnchors, tokenRegistry } = K.indexAddressBook(book);

			const account = globalThis.KeetaNet.lib.Account.fromPublicKeyString(publicKey);
			/* signer = null -> read-only. */
			client = globalThis.KeetaNet.UserClient.fromNetwork(net.alias, null, { account: account });

			const baseToken = client.baseToken.publicKeyString !== undefined
				? String(client.baseToken.publicKeyString)
				: String(client.baseToken);

			const history = await client.history();

			el.pStatus.textContent = 'Checking the data…';
			K.assertNetworkMatches(history, net.networkIdHex);

			el.pStatus.textContent = 'Reading token details…';
			const memos = K.buildMemoIndex(client, history.map((e) => e.voteStaple));

			/* One metadata call per distinct token, cached. */
			const tokens = await K.prefetchTokens(
				client, globalThis.KeetaNet.lib.Account, history, publicKey, tokenRegistry,
				(done, total) => { el.pStatus.textContent = `Reading token details… ${done}/${total}`; }
			);

			el.pStatus.textContent = 'Checking recipients for bridges…';
			const anchors = await K.prefetchAnchors(
				client, globalThis.KeetaNet.lib.Account, history, publicKey, bridgeAnchors,
				(done, total) => { el.pStatus.textContent = `Checking recipients for bridges… ${done}/${total}`; }
			);

			const ctx = {
				ourKey: publicKey,
				baseToken: baseToken,
				anchors: anchors,
				baseTokenSymbol: net.baseTokenSymbol,
				baseTokenDecimals: net.baseTokenDecimals,
				bridgeAnchors: bridgeAnchors,
				tokenRegistry: tokenRegistry,
				tokens: tokens,
				networkAlias: net.alias,
				networkIdHex: net.networkIdHex,
				memos: memos
			};

			const { rows, flagged, stats, dateRange } = K.processHistory(history, ctx);
			const groups = K.groupFlags(flagged);

			result = {
				publicKey, ctx, rows, groups, stats, dateRange,
				csv: K.buildCsv(rows),
				md: K.renderFlaggedMd(ctx, groups, stats, new Date().toISOString())
			};

			/* Exposed for the CLI-vs-browser parity check. Harmless otherwise. */
			globalThis.__KEETA_TAX_RESULT__ = { csv: result.csv, md: result.md, stats: stats };

			renderReview();
			show(el.stateReview);
		} catch (err) {
			show(el.stateInput);
			showInputError((err && err.message) ? err.message : String(err));
		} finally {
			clearInterval(timer);
			restoreFetch();
			if (client && typeof client.destroy === 'function') {
				try { client.destroy(); } catch { /* ignore */ }
			}
		}
	}

	function renderReview() {
		const { stats, dateRange, groups, ctx } = result;
		const dec = ctx.baseTokenDecimals;

		el.rStats.innerHTML = [
			statCard('Rows to export', stats.rowsEmitted),
			statCard('Transactions read', stats.stapleCount),
			statCard('Excluded', stats.excluded),
			statCard('Skipped (non-financial)', stats.skipped),
			statCard('Total in (KTA)', K.formatUnits(stats.totalIn, dec)),
			statCard('Total out (KTA)', K.formatUnits(stats.totalOut, dec))
		].join('');

		el.rRange.innerHTML = dateRange
			? `<p><strong>Date range:</strong> ${K.formatCoinLedgerDate(dateRange.from)} to ${K.formatCoinLedgerDate(dateRange.to)} (UTC)</p>`
			: '<p><strong>No exportable rows were found for this address.</strong></p>';

		const parts = [];
		if (groups.size > 0) {
			parts.push('<h3>Needs your review</h3><ul>');
			for (const [reason, items] of groups) {
				parts.push(`<li><strong>${items.length}</strong>: ${mdInline(reason)}</li>`);
			}
			parts.push('</ul>');
		}
		if (stats.grossFlowSuppressed > 0) {
			parts.push(`<p class="note">${stats.grossFlowSuppressed} transactions had an opposing amount too small to appear in a tax report at all; these are counted but not listed.</p>`);
		}
		if (groups.size === 0 && stats.grossFlowSuppressed === 0) {
			parts.push('<p>Nothing needed flagging. Still spot-check a few rows before filing.</p>');
		}
		el.rFlagSummary.innerHTML = parts.join('');
	}

	/* Render the review notes as readable HTML from the SAME group/stat objects
	 * the markdown file is built from -- not by parsing the markdown, so the two
	 * cannot drift apart in content. */
	function renderMdView() {
		const { groups, stats } = result;
		const out = [];

		if (stats.grossFlowSuppressed > 0) {
			out.push('<h3>Amounts too small to report</h3>');
			out.push(`<p><strong>${stats.grossFlowSuppressed} rows had an opposing leg below reporting precision (suppressed).</strong></p>`);
			out.push('<p>CoinLedger works to 8 decimal places. These amounts round to zero everywhere in a tax report, so they cannot appear in your return at any precision. Your CSV totals are unaffected and remain exact.</p>');
		}

		for (const reason of K.FLAG_ORDER) {
			if (!groups.has(reason)) {
				continue;
			}
			const items = groups.get(reason);
			out.push(`<h3>${mdInline(reason)} (${items.length})</h3>`);
			out.push(mdBlock(K.explainReason(reason)));

			const shown = items.slice(0, 50);
			out.push('<div class="tablewrap"><table><thead><tr><th>Transaction</th><th>Date (UTC)</th><th>Detail</th></tr></thead><tbody>');
			for (const it of shown) {
				const d = it.detail;
				out.push('<tr>' +
					`<td class="hash">${d.stapleHash}</td>` +
					`<td>${d.timestamp ? K.formatCoinLedgerDate(d.timestamp) : '-'}</td>` +
					`<td>${mdInline(K.describeFlag(reason, d))}</td>` +
					'</tr>');
			}
			out.push('</tbody></table></div>');
			if (items.length > shown.length) {
				out.push(`<p class="note">…and ${items.length - shown.length} more of the same kind. All are in the downloadable notes.</p>`);
			}
		}

		if (out.length === 0) {
			out.push('<p>Nothing flagged.</p>');
		}

		el.mdView.innerHTML = out.join('');
	}

	el.go.addEventListener('click', run);
	el.addr.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			run();
		}
	});

	function renderDownloadWarnings() {
		const { stats } = result;
		const out = [];

		/*
		 * FIRST, and never omitted. CoinLedger books every Type=Withdrawal as a
		 * non-taxable self-transfer, so a sale or a payment sent on-chain lands
		 * in the return as nothing at all. No error, no warning, from a CSV that
		 * is technically correct. Same failure class as the shared KTA ticker.
		 */
		if (stats.outgoingRows > 0) {
			out.push(
				'<div class="warn"><h3 style="margin-top:0">Your ' + stats.outgoingRows +
				' outgoing transaction' + (stats.outgoingRows === 1 ? ' is' : 's are') +
				' marked non-taxable</h3>' +
				'<p>Everything you sent out is exported as a <strong>Withdrawal</strong>. ' +
				'CoinLedger treats a Withdrawal as moving money between two wallets you own, ' +
				'so it reports no gain and no loss on any of them.</p>' +
				'<p><strong>If any of those sends were sales or payments, that is wrong.</strong> ' +
				'Selling by sending to a buyer is a disposal. Paying someone in crypto is a disposal. ' +
				'Both look identical to an ordinary transfer on-chain, and left as Withdrawals they ' +
				'will be missing from your return with no warning.</p>' +
				'<p><strong>This tool cannot tell the difference and does not guess.</strong> ' +
				'Only you know which sends were which. Change the type in CoinLedger to ' +
				'<strong>Sells</strong> or <strong>Payments</strong> on any that were. ' +
				'Gifts you can leave alone, they are non-taxable either way.</p></div>'
			);
		}

		if (stats.unpriceableRows > 0) {
			const syms = [...stats.unpriceableSymbols].filter(Boolean).join(", ");
			out.push(
				'<div class="warn"><h3 style="margin-top:0">' + stats.unpriceableRows +
				' rows use tokens CoinLedger cannot price</h3>' +
				'<p>Affected: <strong>' + syms + '</strong></p>' +
				'<p>CoinLedger only has prices for assets it knows. For these you must add a ' +
				'<strong>custom asset</strong> and then <strong>enter the price yourself for every ' +
				'transaction, at every date</strong>. There is no automatic pricing.</p>' +
				'<p><strong>' + stats.unpriceableRows + ' rows means ' + stats.unpriceableRows +
				' prices to research and type in.</strong> Decide whether that is worth it before you ' +
				'import.</p></div>'
			);
		}

		if (stats.byToken && stats.byToken.has("CBBTC")) {
			out.push(
				'<div class="warn"><h3 style="margin-top:0">CBBTC is not BTC</h3>' +
				'<p>Your export contains <strong>CBBTC</strong>, a bridged representation of Bitcoin ' +
				'on Keeta. It is a different asset from BTC.</p>' +
				'<p><strong>Map it as its own asset, never as BTC.</strong> If you map it to BTC, ' +
				'CoinLedger prices it against Bitcoin and treats the two as one holding. The numbers ' +
				'will look reasonable and be wrong. Same trap as picking the wrong KTA, with more ' +
				'value per unit at stake.</p></div>'
			);
		}

		if (stats.highPrecisionRows > 0) {
			out.push(
				'<div class="warn"><h3 style="margin-top:0">Upload the file as it is</h3>' +
				'<p>' + stats.highPrecisionRows + ' rows carry more decimal places than a spreadsheet ' +
				'reliably preserves. The exact values are in your CSV.</p>' +
				'<p><strong>Do not open and re-save it in Excel, Sheets or Numbers first.</strong> ' +
				'Doing so can quietly round those amounts before your tax software sees them.</p></div>'
			);
		}

		const el2 = document.getElementById("dl-warnings");
		if (el2) { el2.innerHTML = out.join(""); }
	}

	el.toDownload.addEventListener('click', () => {
		renderDownloadWarnings();
		renderMdView();
		show(el.stateDownload);
	});

	el.dlCsv.addEventListener('click', () => {
		const short = result.publicKey.slice(6, 14);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		download(`coinledger-${short}-${stamp}.csv`, result.csv, 'text/csv;charset=utf-8');
	});

	el.dlMd.addEventListener('click', () => {
		const short = result.publicKey.slice(6, 14);
		download(`REVIEW-${short}.md`, result.md, 'text/markdown;charset=utf-8');
	});
}());
