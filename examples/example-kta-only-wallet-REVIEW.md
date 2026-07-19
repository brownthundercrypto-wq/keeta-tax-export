# Transactions you must review before filing

This file lists every transaction the converter could **not** classify with confidence, plus every row it did emit that still needs your eyes on it.

**Read this before you import anything.** The CSV is a starting point, not a finished tax return. Nothing here is an error in your wallet. It is the tool telling you where it refused to guess.

- Account: `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i`
- Network: main (network id 0x5382)
- Generated: 2026-07-19T21:36:33.506Z
- Staples fetched: 3054
- Rows written to CSV: 3054
- Excluded from CSV: 0
- Skipped as non-financial: 0

## ⚠️ READ THIS BEFORE YOU IMPORT: pick the right KTA

When you upload this file, CoinLedger will show a **"Shared Ticker Symbols Detected"** prompt. More than one asset uses the ticker `KTA`.

**Choose `KTA - Keeta`.**

The other option (`KTA - KTA`) is an unrelated asset. If you pick it, CoinLedger will happily price your entire report against the wrong coin. No error, no warning, just wrong numbers all the way through. This is the single easiest way to get a wrong return out of a correct CSV.

CoinLedger can remember this mapping, so it is a one-time choice per account.

## A note on very precise amounts

**3025 rows carry more decimal places than a spreadsheet reliably preserves** (up to 16 significant digits). Keeta tokens commonly use 18 decimal places, so this is normal rather than a problem with your wallet.

**The exact values are in your CSV, unrounded.** The warning is about what happens next: if you open the file in Excel, Google Sheets or Numbers and save it, those amounts can be silently rounded before your tax software ever sees them.

**Upload the CSV as it is. Do not open and re-save it first.**

## How to import

1. In CoinLedger, go to **Import → Other Account** and upload the CSV.
2. When prompted about shared tickers, select **`KTA - Keeta`** (see above).
3. Review everything listed further down this file before filing.

## About protocol fees

**Fee columns in the CSV are deliberately left blank.** Keeta reports a per-staple aggregate called `feeUnits`, but the unit it is denominated in is not documented and could not be verified. Interpreting it as KTA base units produces implausibly small values (a typical fee would be about 0.000000000000002 KTA), which strongly suggests it is a different unit entirely.

Across this export the raw `feeUnits` total was **6473830** across 3054 staples. Rather than write a number we cannot justify into a tax document, the tool omits it and tells you here.

If your protocol fees are material to your filing, ask a professional how to treat them.

## Amounts too small to report

**3025 rows had an opposing leg below reporting precision (suppressed).**

These transactions moved KTA both in and out, but the smaller side was under 0.00000001 KTA. CoinLedger works to 8 decimal places, so amounts that small round to zero everywhere in a tax report. They cannot appear in your return at any precision. They are counted here rather than listed, because asking you to review something that cannot be reported would waste your time.

The net figures in your CSV are unaffected and remain exact.

## Nothing else flagged

Every other transaction classified cleanly. Still spot-check a few rows against the explorer before filing.
