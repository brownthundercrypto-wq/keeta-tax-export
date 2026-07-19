# Sample output

Real, unmodified output from the tool, so you can see what you get before you
paste an address anywhere.

## ⚠️ Whose data is this?

**Both examples come from public third-party addresses taken from
[explorer.keeta.com](https://explorer.keeta.com). Neither is the author's
wallet.** Nothing here required key material of any kind. Every address and
amount below is already public on the block explorer, and anyone can look up the
same transactions.

They were chosen because they show two very different outcomes.

## Example 1: a KTA-only wallet

| File | |
|---|---|
| [`example-kta-only-wallet.csv`](example-kta-only-wallet.csv) | a few thousand rows, ready to import |
| [`example-kta-only-wallet-REVIEW.md`](example-kta-only-wallet-REVIEW.md) | the review file |

Address: `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i`

**This is the clean case.** Every transaction moved KTA and nothing else, so
every one made it into the CSV. Nothing was excluded.

The review file is short. It explains why the fee columns are blank, and notes
that most transactions had a second amount too small to appear in a tax report
at any precision, so they were counted rather than listed.

## Example 2: a wallet that trades

| File | |
|---|---|
| [`example-swap-wallet.csv`](example-swap-wallet.csv) | ~2,000 rows, mostly trades |
| [`example-swap-wallet-REVIEW.md`](example-swap-wallet-REVIEW.md) | the review file |

Address: `keeta_aabva3ph7du7vxsjlixr3pgzxyvseizddgxzj7uwzixvvlv2tuewaquqkerc24i`

**This wallet trades constantly**, and shows what a swap looks like once exported.
Each trade is a single row: the asset given up in the Sent columns, the asset
received in the Received columns. Routing fees paid in the same transaction are
already folded into those figures rather than appearing as separate withdrawals.

It also shows the honest limits. Most of its tokens are ones CoinLedger has no
price history for, so the review file states plainly how many rows need a custom
asset and a manually entered price. That number is worth reading before importing:
it is the difference between a file you can upload and an afternoon of manual work.

A handful of transactions are still excluded, including one token launch where
three tokens arrived and none left. That is not a trade, and forcing it into a
trade row would misreport it.

---|---|
| [`example-kta-only-wallet.csv`](example-kta-only-wallet.csv) | a few thousand rows, ready to import |
| [`example-kta-only-wallet-REVIEW.md`](example-kta-only-wallet-REVIEW.md) | the review file |

Address: `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i`

**This is the clean case.** Every transaction moved KTA and nothing else, so
every one made it into the CSV. Nothing was excluded.

The review file is short. It explains why the fee columns are blank, and notes
that most transactions had a second amount too small to appear in a tax report
at any precision, so they were counted rather than listed.

## Example 2: a wallet that trades

| File | |
|---|---|
| [`example-swap-wallet.csv`](example-swap-wallet.csv) | 7 rows |
| [`example-swap-wallet-REVIEW.md`](example-swap-wallet-REVIEW.md) | the review file, and the interesting part |

Address: `keeta_aabva3ph7du7vxsjlixr3pgzxyvseizddgxzj7uwzixvvlv2tuewaquqkerc24i`

**This one looks alarming until you read the review file, and that is the point.**
2,008 transactions went in and 7 rows came out.

The other 2,001 were swaps and non-KTA token movements. This version handles KTA
only, so it will not price a trade it cannot value. Splitting a swap into two
transfers would double-count it and wreck your cost basis, and guessing a
divisor for a token whose decimals Keeta does not publish would put a silently
wrong number in your return.

So it excludes them, lists every one with its transaction hash, and tells you
why. **A tool that quietly produced 2,008 confident rows here would be worse,
not better.**

If your wallet only ever held KTA, expect Example 1. If you have traded on
Keeta, expect something closer to Example 2, and read the review file.

---

Regenerated 20 July 2026 (v0.2.0) against Keeta mainnet with
`@keetanetwork/keetanet-client` 0.18.3.
