# Transactions you must review before filing

This file lists every transaction the converter could **not** classify with confidence, plus every row it did emit that still needs your eyes on it.

**Read this before you import anything.** The CSV is a starting point, not a finished tax return. Nothing here is an error in your wallet. It is the tool telling you where it refused to guess.

- Account: `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i`
- Network: main (network id 0x5382)
- Generated: 2026-07-20T00:08:38.866Z
- Staples fetched: 3081
- Rows written to CSV: 3063
- Excluded from CSV: 18
- Skipped as non-financial: 0

## ⚠️ READ THIS BEFORE YOU IMPORT: pick the right KTA

When you upload this file, CoinLedger will show a **"Shared Ticker Symbols Detected"** prompt. More than one asset uses the ticker `KTA`.

**Choose `KTA - Keeta`.**

The other option (`KTA - KTA`) is an unrelated asset. If you pick it, CoinLedger will happily price your entire report against the wrong coin. No error, no warning, just wrong numbers all the way through. This is the single easiest way to get a wrong return out of a correct CSV.

CoinLedger can remember this mapping, so it is a one-time choice per account.

## How to import

1. In CoinLedger, go to **Import → Other Account** and upload the CSV.
2. When prompted about shared tickers, select **`KTA - Keeta`** (see above).
3. Review everything listed further down this file before filing.

## About network fees

**Network fees are in your CSV, in the Fee Currency and Fee Amount columns.** 3061 rows carry one. Across this export you paid **12.35735 KTA** in fees.

**Paying a fee in KTA is a disposal of that KTA.** You gave up an asset, so there is a gain or loss on it based on what it was worth when you acquired it versus when you spent it. That is why a transaction you think of as non-taxable, like moving your own money, can still show a small gain or loss after import. That is correct and expected, not a bug.

Every fee here was read from the transaction itself, not estimated. Keeta builds each transaction with a separate fee block, one payment per validator that signed it, so the amount is exact.

**Do not add these fees again by hand.** They are already counted. Entering them a second time would dispose of the same KTA twice and overstate your losses.

You may also see a raw number called `feeUnits` if you go digging in the data. Ignore it. It measures how big a transaction is, not how much it cost, and it is not an amount of KTA.

## the only movement was the network fee  (18)

In these transactions the only thing that moved was the **network fee**. Nothing else was sent or received.

**They are not in your CSV**, because a row needs an asset in the sent or received column and there is nothing to put there. But the fee was still a real disposal of KTA, so if these matter to your return you will need to add them by hand as a disposal of the amount shown.

This usually happens when you publish a transaction on behalf of another account and pay its fee.

| Staple hash | Date (UTC) | Detail |
|---|---|---|
| `386A5EA8A88AAFE59C1145561007817195426705B70A4E262A064BE62D9E826F` | 06/30/2026 22:18:29 | fee only: 0.0492 KTA disposed, nothing else moved |
| `F632C32DC7DB032AAC7C02B1846A88173ECB99B53C78FF6F8F817A37D633DC29` | 06/30/2026 22:18:27 | fee only: 0.0492 KTA disposed, nothing else moved |
| `6A4A4389444E315E701D9298D14D07DD78EA90E3768C405BBC3AC95FC2A5F7B3` | 06/30/2026 22:18:25 | fee only: 0.0492 KTA disposed, nothing else moved |
| `AAEF02CE486488E1D5F7CE8FD13B901A36F58053BBF0B1C377B7D6CDABCCF0E3` | 06/30/2026 22:18:22 | fee only: 0.0492 KTA disposed, nothing else moved |
| `CECDFDCE62BE186066F8C74F67AF4A06C715969196DD8095D142CF87A639D941` | 06/30/2026 22:18:20 | fee only: 0.0492 KTA disposed, nothing else moved |
| `9FCD4A541577B78B2E9E62B872069DBE52446CF7C0F8A9E6928ADEFEA75BAC29` | 06/30/2026 22:18:17 | fee only: 0.0492 KTA disposed, nothing else moved |
| `C2DCEEBB66312ED9CF0A22411C1A3D4296FB200AB895EE402A495935A85C27BF` | 06/30/2026 22:18:14 | fee only: 0.0492 KTA disposed, nothing else moved |
| `A0F85F75ED732A898D897B358731BD7D618F8E8EDAB4BB77CAC3CB26DF7828EA` | 06/30/2026 22:18:12 | fee only: 0.0492 KTA disposed, nothing else moved |
| `612194099516CAF1EBE618239C8B6F45AB509862C2ECC8499F3835EEE4A9F5A0` | 06/30/2026 22:18:09 | fee only: 0.0492 KTA disposed, nothing else moved |
| `D6AE849357A4F5ED0142A7A3556A62053E9307EBBA9DEDBA7EF681AD7278BD65` | 06/30/2026 22:16:32 | fee only: 0.0492 KTA disposed, nothing else moved |
| `AD84D8965B8E40914EDFB88594746BDBC9A89E5435E8A504FAB2237664D08E2B` | 06/30/2026 22:16:29 | fee only: 0.0492 KTA disposed, nothing else moved |
| `C28B9B55722040B9CDA1DD502FB6B239A766E18F14029E228FB85CE6D054EB41` | 06/30/2026 22:16:27 | fee only: 0.0492 KTA disposed, nothing else moved |
| `DA806B64091155C75666D2CA8A9508D11BFAD88FA139338921378A5070249ED5` | 06/30/2026 22:16:24 | fee only: 0.0492 KTA disposed, nothing else moved |
| `39DB5EC8C4679C494451FA11DED98CF5E17179D86CBFCF2F8186447F947D77C3` | 06/30/2026 22:16:22 | fee only: 0.0492 KTA disposed, nothing else moved |
| `E47FC6C63602DDE6F2A0B777122B07188384853345163A7FF219EDACAD3033DF` | 06/30/2026 22:16:20 | fee only: 0.0492 KTA disposed, nothing else moved |
| `8DDEF3342A14D67AD636BB14AD5FC2815A479EA70856C718C4AFAEE673510F82` | 06/30/2026 22:16:17 | fee only: 0.0492 KTA disposed, nothing else moved |
| `9FFD5AF82292B78F52EEBAFA5EB2EB9878CB5237B826DAF63EA4B6CF8FBCE9FF` | 06/30/2026 22:16:15 | fee only: 0.0492 KTA disposed, nothing else moved |
| `BCADFCF8FCCEC7A987948C59995A38A06F395A59F86ACFE84A16A5071B248A2A` | 06/30/2026 22:16:14 | fee only: 0.0892 KTA disposed, nothing else moved |

