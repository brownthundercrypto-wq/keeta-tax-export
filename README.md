# Keeta Tax Export

[![test](https://github.com/brownthundercrypto-wq/keeta-tax-export/actions/workflows/test.yml/badge.svg)](https://github.com/brownthundercrypto-wq/keeta-tax-export/actions/workflows/test.yml)

Export your Keeta (KTA) transaction history to a CSV you can import into
CoinLedger. Runs entirely in your browser, or as a local command-line tool.

**You paste a public address. Nothing else.** No seed phrase, no private key, no
account, no server.

**Live tool:** https://brownthundercrypto-wq.github.io/keeta-tax-export/

> **v0.1.0.** Tested against Keeta mainnet and `@keetanetwork/keetanet-client`
> **0.18.3** on **19 July 2026**. If you are reading this much later, check that
> the SDK has not moved. See
> [KEETA-TECHNICAL-FINDINGS.md](KEETA-TECHNICAL-FINDINGS.md) for what was
> verified and how.

## What this does not do

**This builds an import file. It does not calculate your cost basis, and it does
not give you a finished tax return.**

One Keeta address cannot tell you three things you need:

- **What you paid.** The chain records that KTA moved, not what it cost you.
- **Which wallets are yours.** Moving KTA between your own addresses is not a
  sale, but on-chain it looks the same as one.
- **Anything that happened off Keeta.** Exchange buys, other chains, transfers in
  from somewhere else. None of it is here.

Your tax software fills those gaps once you import the rest of your accounts.
That is the job this file feeds into, not the job it finishes.

## See what you get first

[`examples/`](examples/) has a real CSV and its review file, generated from a
public address off the block explorer. Look at those before pasting anything.

---

## What it does

1. Reads your full transaction history straight from Keeta's nodes.
2. Classifies each transaction, and refuses to guess when it cannot be sure.
3. Writes a CoinLedger-ready CSV, plus a review file listing everything you
   should check before filing.

## The privacy model

This is the part that matters, so it is stated plainly.

- **There is no backend.** No server, no database, no analytics that see your
  address. The web page talks directly to Keeta's public nodes.
- **Your address never leaves your browser** except in requests to Keeta's own
  nodes. Those are the same requests any block explorer makes.
- **The CSV is generated in your browser** and saved by your browser. It is
  never uploaded anywhere.
- **It cannot use a seed phrase or private key.** Reading history needs only a
  public address. Paste something that looks like a seed and the tool refuses it
  and tells you why.
- **Nothing is monetized.** No ads, no tracking, no analytics, no affiliate
  links, no server. This project makes no money and collects nothing.

You do not have to take any of that on trust. Open your browser's developer
tools, Network tab, and run it: the only origins contacted are
`static.network.keeta.com` (the Keeta SDK) and Keeta's node API. That is
verifiable in about thirty seconds, and you should verify it.

## Honest limitations

**KTA only.** If your wallet holds other Keeta tokens, those transactions are
detected, deliberately excluded, and listed in your review file.

That is a correctness decision, not a missing feature. Keeta does not publish a
token's decimal precision on-chain. Every token checked had empty metadata. A
raw number could mean `1.0` or `0.000000001`. Guessing wrong puts a silently
wrong figure in a tax return. Better to leave a row out and say so.

**Swaps are excluded.** A swap moves two tokens at once and needs both divisors
to price. Detected, excluded, explained.

**Bridge detection is partial.** Moving KTA to another chain looks exactly like
a sale on-chain. Known bridge addresses are flagged, but only two bridge
operators publish their addresses in a readable way. **If you bridged KTA, check
those rows yourself.**

**This is not tax advice.** Classifications are best-effort. Review every row
before filing. You are responsible for the accuracy of your return.

---

## Using it

### Web

Serve the repository root and open `/web/`:

```bash
node web/serve.js       # → http://localhost:8900/web/
```

Or host the repository on any static host. There is no build step.

### Command line

```bash
git clone https://github.com/brownthundercrypto-wq/keeta-tax-export.git
cd keeta-tax-export
npm install
node convert.js <keeta_public_address> [--network main] [--raw]
```

Writes to `output/`:

- `coinledger-<short>-<timestamp>.csv`: import this
- `FLAGGED.md`: read this before filing
- `raw-<short>-<timestamp>.json`: source data, only with `--raw`

### Tests

```bash
npm test
```

Asserts the CoinLedger header row byte-for-byte, the timestamp format, amount
formatting against explorer-verified values, and the blank-field rules.

---

## Importing into CoinLedger

**Choose `KTA - Keeta`.** CoinLedger will ask you to pick between `KTA - Keeta`
and an unrelated `KTA - KTA`. Picking wrong prices your entire report against
the wrong coin. No error, no warning. CoinLedger remembers the choice, so it is
one-time.

Then: **Import → Other Account**, upload the CSV, and read the review file
before you file anything.

---

## Notes for other Keeta developers

**[KEETA-TECHNICAL-FINDINGS.md](KEETA-TECHNICAL-FINDINGS.md)** documents what was
learned building this, including seven places where published documentation
disagrees with the shipped SDK or live systems.

Short version, if you are reading Keeta history yourself:

- **`history()` already paginates internally.** The JSDoc says otherwise.
- **There is no on-chain source for token decimals**, not even for KTA, and the
  divisor is network-dependent (18 on mainnet, 9 on testnet).
- **Build from `effects`, not operations.** Effects are pre-scoped to your
  account and pre-netted across the staple.
- **Never use `isReceive` for direction.** It was `false` on all 26,226 balance
  entries observed, including every incoming one. Use the sign of `value`.
- **In a swap, the SEND+RECEIVE block belongs to the counterparty**, not to you.
- **`staple.timestamp()` and `block.date` can differ by −69s to +82s** and are
  not reliably ordered.

That file is written to be useful on its own, independent of this tool.

---

## How it is put together

```
lib/format.js     amount + date + CSV formatting
lib/classify.js   per-staple classification (read the header comment first)
lib/pipeline.js   shared conversion pipeline
convert.js        CLI wrapper: argument parsing and file I/O only
web/              the static page
data/             known bridge/anchor addresses and the token registry, with sources
test/             format contract tests
```

The CLI and the web page load **the same `lib/` files**. That is deliberate:
every rule deciding what lands in a tax report has exactly one implementation,
so the two cannot silently disagree. Verified by SHA-256. Both produce
byte-identical CSV for the same address.

Dependencies: `@keetanetwork/keetanet-client`, pinned to an exact version. That
is all. Every dependency is something an auditor has to read.

---

## License

MIT.

---

Built by [@Brown_Thunder76](https://x.com/Brown_Thunder76)
