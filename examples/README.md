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
| [`example-kta-only-wallet.csv`](example-kta-only-wallet.csv) | 3,063 rows, ready to import |
| [`example-kta-only-wallet-REVIEW.md`](example-kta-only-wallet-REVIEW.md) | the review file |

Address: `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i`

**This is the clean case.** Every transaction moved KTA and nothing else. 3,081
transactions went in and 3,063 rows came out.

It is also the best illustration of how network fees are handled. Almost every
row here carries one, in the Fee Currency and Fee Amount columns. Keeta builds
each transaction with a separate fee block containing one payment per validator
that signed it, so the tool reads the exact amount rather than estimating it.

That matters for your return, because **paying a fee in KTA is a disposal of
that KTA**. Tax software books a gain or loss on it. So a transaction you think
of as non-taxable can still show a small gain after import. That is correct.

18 transactions are excluded. In those, the fee was the only thing that moved,
and a CSV row needs an asset in the sent or received column. The review file
lists every one so you can add them by hand if they matter to you.

## Example 2: a wallet that trades

| File | |
|---|---|
| [`example-swap-wallet.csv`](example-swap-wallet.csv) | 1,997 rows, mostly trades |
| [`example-swap-wallet-REVIEW.md`](example-swap-wallet-REVIEW.md) | the review file |

Address: `keeta_aabva3ph7du7vxsjlixr3pgzxyvseizddgxzj7uwzixvvlv2tuewaquqkerc24i`

**This wallet trades constantly**, and shows what a swap looks like once
exported. 1,964 of its rows are trades. Each one is a single row: the asset
given up in the Sent columns, the asset received in the Received columns.
Routing fees paid to a market maker in the same transaction are already folded
into those figures rather than appearing as separate withdrawals.

Notice that the fee columns here are empty, unlike Example 1. That is not an
omission. In a swap the counterparty publishes the transaction and pays the
network fee, so there is no fee for this wallet to report.

It also shows the honest limits. 1,990 of its 1,997 rows use tokens CoinLedger
has no price history for, so the review file states plainly how many need a
custom asset and a manually entered price. **That number is worth reading before
importing.** It is the difference between a file you can upload and an afternoon
of manual work.

11 transactions are excluded. Ten netted to exactly zero. One is a token launch
where three tokens arrived and none left. That is not a trade, and forcing it
into a trade row would misreport it.

---

If your wallet only ever held KTA, expect Example 1. If you have traded on
Keeta, expect something closer to Example 2, and read the review file.

Regenerated 20 July 2026 against Keeta mainnet with
`@keetanetwork/keetanet-client` 0.18.3.
