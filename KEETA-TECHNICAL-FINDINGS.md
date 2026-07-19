# Keeta SDK: Technical Findings

Notes gathered while building a transaction-history exporter against
`@keetanetwork/keetanet-client` **v0.18.3** on mainnet, July 2026.

Published because most of this is not written down anywhere else, and several
points contradict the official documentation in ways that cost real debugging
time. If you are building anything that reads Keeta history, start here.

## About the data behind these findings

Everything marked **[DATA]** was verified against two **public, third-party
mainnet addresses taken from the block explorer**. They are not the author's
wallets, and no private wallet data was used at any point:

| Address | Shape |
|---|---|
| `keeta_aab5qz62ifv77udwkziftaeea2isqk6v2qat27feoudcmcc5kw3uw2gu5kpk72i` | ~3,027 staples, KTA only, no swaps |
| `keeta_aabva3ph7du7vxsjlixr3pgzxyvseizddgxzj7uwzixvvlv2tuewaquqkerc24i` | ~2,008 staples, 1,965 swaps, 9 tokens |

Both are visible to anyone on `explorer.keeta.com`. Reading history requires
only a public address. No key material of any kind.

**Evidence tags:** **[DATA]** = observed on mainnet · **[SOURCE]** = verified
against the installed package · **[DOCS]** = documentation claim, unverified.

---

# 1. Documentation vs. reality: seven discrepancies

Published documentation disagreed with the shipped code or live systems **seven
times**. This is the single most useful thing in this document.

**Treat documentation as hypothesis and `node_modules` as truth.** Verify before
relying on any doc claim.

### 1. `history()` pagination: the JSDoc says to paginate, the code already does

The SDK's own doc comment states the request "may return only a partial set" and
that `startBlocksHash` should be used to fetch the next page. **The client loops
internally to exhaustion.** `client/index.js` **[SOURCE]**:

```js
const { depth = Infinity, pageSize = 200, startBlocksHash } = options;
while (retval.length < depth) {
    /* ...fetch page... */
    if (history.history.length === 0) { break; }
    if (typeof history.nextKey === 'string' || history.nextKey === null) {
        if (history.nextKey === null) { break; }
        startVoteStapleID = history.nextKey;
    } else {
        /* @deprecated -- workaround broken API */
        startVoteStapleID = history.history.slice(-1)[0]['$id'];
    }
}
```

`depth` defaults to `Infinity`, so **`client.history()` with no arguments returns
everything.** Writing your own pagination loop duplicates work already done.

Verified on two wallets: the returned set forms an unbroken chain of `previous`
pointers back to exactly one `$opening: true` block, with zero dangling
pointers **[DATA]**. That check is cheap and worth shipping as an assertion.

### 2. `Numeric.fromDecimalString` does not exist

Official examples use a `Numeric` helper for decimal conversion. **It is not
exported in 0.18.3** **[SOURCE]**:

```
lib keys:        Account, Block, Error, Ledger, Log, Node, P2P, Permissions, Stats, Vote, Utils
lib.Numeric:     undefined
lib.Utils keys:  ASN1, Bloom, Buffer, Certificate, Conversion, DomainSeparation, Hash, Helper, Initial
```

Hand-roll decimal formatting on `bigint`. Never route through `Number`.
Amounts routinely exceed 2^53 in base units.

### 3. "A Send decrements the sender and increments the receiver" is incomplete

There is a distinct `RECEIVE` operation type and a `receivable` flag in the
effects model, which suggests a two-step claim model. **Real data says otherwise
for ordinary transfers:** 2,991 staples increased an account's balance and
*none* contained a `RECEIVE` operation **[DATA]**. A plain SEND credits the
recipient directly. `RECEIVE` is swap machinery. See §3.

### 4. The live metadata endpoint does not match its documented schema

Docs specify `{version, currencyMap, services, resolvers}` at the top level. The
live payload at `static.network.keeta.com/metadata/services` has **none of
those**. Service categories (`kyc, fx, assetMovement, storage, notification,
username`) sit at top level, with no `version`, no `currencyMap`, no
`resolvers` **[DATA]**. Code written to the documented shape breaks immediately.

### 5. `client.getAccountState()` does not exist

Used in four separate documents. Zero occurrences in `client/index.d.ts` and
`client/index.js`; `typeof client.getAccountState` is `undefined` **[SOURCE]**.

The real method is **`client.state(options?)`**. Because it accepts
`Pick<UserClientOptions, 'account'>`, you can look up any account without
rebuilding the client:

```js
const info = await client.state({ account: someTokenAccount });
```

Its consistency across four docs suggests they were written against an older
SDK and never revalidated.

### 6. A documented `history()` example matches no version of the API

One guide shows:

```js
const history = await client.history(anchorAccount);
for (const block of history) {
  if (block.type === 'receive') { block.hash; block.sender; block.amount; }
}
```

**Nothing here is correct for 0.18.3.** `history()` takes a *query object* (the
account comes from client options), returns `{voteStaple, effects}[]`, not flat
blocks. `OperationType` is a **numeric enum**, so there is no `'receive'`
string **[DATA]**.

### 7. CoinLedger's CSV header (bonus, different ecosystem, same lesson)

If you export to CoinLedger: their help article omits the `(Optional)` suffixes
present in the real Google Sheet template. **CoinLedger fingerprints the entire
header row before parsing any data**, so the wrong header rejects the whole file
with no indication of which column was at fault. The template is the source of
truth, not the article.

---

# 2. Token decimals: they ARE on-chain, in `info.metadata`

> **CORRECTED 20 July 2026.** An earlier version of this document said Keeta
> publishes decimals nowhere on-chain, and that every token had empty metadata.
> **That was wrong.** The cause is a gotcha worth documenting in its own right,
> so it is kept below rather than quietly deleted. If you read the earlier
> version and built an off-chain registry around it, you do not need one.

Amounts are `bigint` base units, so converting to a human-readable figure needs
a divisor. **Every token checked publishes its own divisor on-chain.**

```js
const st = await client.state({ account: tokenAccount });
const info = st.info;                                  // NOTE: st.info, not st
const meta = JSON.parse(Buffer.from(info.metadata, 'base64').toString('utf8'));
meta.decimalPlaces;                                    // -> 6 for USDC
```

`info.metadata` is a base64-encoded JSON object. Observed keys are
`decimalPlaces` and sometimes `logoURI`. `info.name` carries the ticker and
`info.description` a human-readable name.

## The bug that caused the wrong finding

`client.state()` does **not** return the account info directly. It returns a
wrapper **[SOURCE]**:

```
{ account, currentHeadBlock, currentHeadBlockHeight, representative, info, balances }
```

Reading `.name` or `.metadata` off that wrapper yields `undefined` for every
token, with no error. It looks exactly like a chain that publishes nothing. The
fields live one level down, on `.info`.

**This is the same family of trap as `publicKeyString` and `isReceive` elsewhere
in this document: an SDK shape that degrades into a plausible-looking wrong
answer instead of throwing.** If a Keeta lookup appears to return "nothing",
check you are reading the right level before concluding the chain is empty.

## Verification

Every token in the AnchorFactory registry, checked three ways: the registry's
claim, the on-chain `decimalPlaces`, and a real transaction reconciled against
explorer.keeta.com **[DATA]**.

| Token | Registry | On-chain | Raw sample | Computed | Explorer shows | Match |
|---|---|---|---|---|---|---|
| KTA | 18 | 18 | `10000000000000000000` | 10 | `10 KTA` | yes |
| USDC | 6 | 6 | `2797489383` | 2797.489383 | `2,797.489383 USDC` | yes |
| EURC | 6 | 6 | `459010000` | 459.01 | `459.01 EURC` | yes |
| CBBTC | 8 | 8 | `30000` | 0.0003 | `0.0003 CBBTC` | yes |
| USD | 2 | 2 | `149775` | 1497.75 | `1,497.75 USD` | yes |
| EUR | 2 | 2 | `2272` | 22.72 | `22.72 EUR` | yes |
| GBP | 2 | 2 | `7442` | 74.42 | `74.42 GBP` | yes |
| CAD | 2 | 2 | `12593` | 125.93 | `125.93 CAD` | yes |
| **JPY** | **0** | **0** | `4814` | 4814 | `4,814 JPY` | yes |
| HKD | 2 | 2 | `7800` | 78.00 | `78 HKD` | yes |
| MXN | 2 | 2 | `16703` | 167.03 | `167.03 MXN` | yes |
| CNY | 2 | 2 | `13512` | 135.12 | `135.12 CNY` | yes |
| AED | 2 | 2 | `36359` | 363.59 | `363.59 AED` | yes |

Tokens outside the registry publish decimals too: MURF 18, **CHTA 9**, LUCKY 18,
MKTA 18, LP_KTA_MURF 18 **[DATA]**. CHTA at 9 matters, because it shows the value
genuinely varies and a hardcoded 18 would be wrong.

## The divisor is still network-dependent

| | Mainnet | Testnet |
|---|---|---|
| Network name | `'main'` | `'test'` |
| Network ID | `0x5382` | `0x54455354` |
| **KTA decimals** | **18** | **9** |

Develop against testnet, ship against mainnet, and every amount is wrong by
**10⁹**, silently. Assert that fetched blocks carry the network ID you expect
before trusting any figure.

## What to do

**Read `decimalPlaces` from `info.metadata`.** It is authoritative, per-token,
and removes any dependency on a third-party table.

Three rules still apply:

- **`0` is a real value.** JPY has 0 decimals. Any "falsy means missing" check
  corrupts it. `0` and `undefined` must stay distinct.
- **Still hard-fail when metadata is missing or unparseable.** Nothing forces an
  issuer to set it. A token with no readable divisor has no safe default, and
  guessing 18 produces a plausible, wrong number.
- **A divisor is not an identity.** Knowing a token has 2 decimals does not make
  it safe to label `USD`. A Keeta-native tokenized dollar and the actual US
  dollar are not the same asset, and tax software that resolves the ticker to
  fiat will silently misprice it.

An off-chain table is still useful as a **cross-check** against the chain, but it
is no longer the source of truth. Worth knowing that the AnchorFactory table
carries at least one transcription error: its HKD address is 62 characters where
every other address is 61, and the SDK rejects it outright.

---
# 3. Atomic swaps: the structure is not what the docs imply

Documentation describes a swap as `SEND` + `RECEIVE` in one block. That is true,
**but the block belongs to the counterparty, not to you.**

A real mainnet swap (staple `74F743C37C7C0E4FB2C1C99FC0B95938A47A53DB6E0E8E51B84D02D931288360`) **[DATA]**:

```
BLOCK 726FF420…  our account          isSwapCandidate: false
    SEND  MURF  24902188797697885934532853  -> counterparty
    SEND  KTA   70000000000000000           -> fee collector
    SEND  KTA   77000000000000000           -> fee collector
    SEND  KTA   50000000000000000           -> fee collector
BLOCK 41B8011E…  counterparty          isSwapCandidate: true
    SEND     KTA   70050000000000000000        -> us
    RECEIVE  MURF  24902188797697885934532853  from us
```

**Our own block is four SENDs and contains no RECEIVE.** Detecting swaps by
looking for SEND+RECEIVE in *your* blocks misses the swap entirely and emits
four phantom disposals.

### What works instead

Net the per-token balance deltas **for your account across the whole staple**.
Two or more tokens with a non-zero net = trade.

Our netted deltas for that staple:

```
MURF: -24902188797697885934532853                      (net negative)
KTA:  -0.07, -0.077, -0.05, +70.05  =  net +69.853     (net positive)
```

Note **KTA appears as both negative and positive in one staple**. Routing fees
out, proceeds in. A rule that looks for "one negative entry and one positive
entry" misfires. Only the **net per token** is meaningful. And those same-staple
fee sends belong to the trade; emitting them separately triple-counts it.

`RECEIVE` operations are real and common (1,965 observed) but appeared in
**zero** blocks without a paired SEND **[DATA]**. They are swap machinery, not
a general receive step.

---

# 4. Build from effects, not operations

`client.history()` returns `{voteStaple, effects}[]`. The effects object is the
better data source, and it is easy to miss.

```
effects.accounts[yourPublicKey].fields.balance  →  { [tokenAddress]: TokenEntry[] }
```

Verified across two wallets **[DATA]**:

- Populated on **100%** of staples that had any financial movement.
- `otherAccount` present on **100%** of 26,226 balance entries. **Counterparty comes free**, with no need to parse operations for it.
- Values are **signed bigints**; there were zero zero-value entries.

Effects are already scoped to your account and already netted across the staple,
which is exactly what operations are not. The only thing effects lack is the
`external` memo on SEND. That is the one legitimate reason to reach for
`filterStapleOperations`.

## ⚠️ Do not use `isReceive` for direction

**`isReceive` was `false` on all 26,226 balance entries across both wallets,
including every one of the 3,347 incoming ones** **[DATA]**.

`isReceive: true` belongs to `RequestTokenReceiveEntry`, which pairs with actual
`RECEIVE` operations. Using it as a direction flag silently inverts every
incoming transfer. **Use the sign of `value`.**

## Skip staples with no `balance` field

A staple whose effect fields contain no `balance` key is a non-financial event:
permission change, info update, certificate publish, username claim. Ordinary
users accumulate these. Skip them; do not emit zero-amount rows.

---

# 5. Timestamps: there are two, and neither is strictly ordered

| Source | Meaning |
|---|---|
| `block.date` | Part of the signed block content, **self-reported by the creator** |
| `staple.timestamp()` | **Average of the representative vote timestamps**, network-attested |

Prefer `staple.timestamp()`: it reflects consensus rather than self-report.

Format is ISO 8601 with `Z`; **UTC confirmed** **[DATA]**.

**The two are not reliably ordered.** Divergence across two wallets **[DATA]**:

```
wallet A:  n=6054  min +163ms   median +581ms   max +15.8s   negatives: 0
wallet B:  n=6830  min -69.2s   median +1.03s   max +82.2s   negatives: 17
```

So the real window is roughly **−69s to +82s**. If you bucket by calendar day, whether tax years or daily reports,
a transaction near midnight can land in a different
period depending on which timestamp you pick. Worth flagging rather than
silently choosing.

Vote `validityFrom` / `validityTo` are a validity window, **not** settlement
time. Do not use them as transaction dates.

---

# 6. Fees

There is **no fee operation type**. The complete enum **[SOURCE]**:

```
SEND=0, SET_REP=1, SET_INFO=2, MODIFY_PERMISSIONS=3, CREATE_IDENTIFIER=4,
TOKEN_ADMIN_SUPPLY=5, TOKEN_ADMIN_MODIFY_BALANCE=6, RECEIVE=7, MANAGE_CERTIFICATE=8
```

Fees appear as a **staple-level aggregate**: `effects.metadata.feeUnits`
(alongside `blockCount` and `operationCount`). They can also materialize as a
separate fee block via `UserClientOptions.generateFeeBlock`.

**Open question:** the *unit* of `feeUnits` is undocumented and we could not
verify it. Interpreting it as KTA base units yields implausible values. A
typical fee would be ~0.000000000000002 KTA. The name (`feeUnits`, not
`feeAmount`) hints at a distinct unit. If you need exact fees, confirm this
before relying on it.

---

# 7. Smaller things worth knowing

**`publicKeyString` is an object, not a string.** `String()`, template literals,
and `.get()` all work and are equivalent. **`JSON.stringify` yields `{}`**.
That is silent data loss with no error and no `[object Object]` to grep for **[DATA]**.

**`String(account)` on an `Account` yields `[object Object]`.** Route every
address through one helper.

**Amounts differ by access route.** `Block.toJSON()` emits amounts as **hex
strings** (`"0x1"`); live objects give **bigint**. Normalize both; never through
`Number`.

**`Account.fromPublicKeyString()` is synchronous.** Several docs `await` it.

**`op.type` is a numeric enum**, not a string tag.

**`filterStapleOperations` returns an object keyed by staple hash**, not an
array, and **not in chronological order**. It also takes `VoteStaple[]`, not the
`{voteStaple, effects}` wrapper `history()` returns. Map first.

**Networks are exactly** `"main" | "staging" | "test" | "dev"` **[SOURCE]**.

**The browser bundle needs no polyfills.** Despite documentation warning that
the SDK requires `Buffer`/`process`/`crypto` shims, loading
`static.network.keeta.com/keetanet-browser.js` via a script tag worked with
`Buffer` and `process` both `undefined`, returning an exact match to the Node
result **[DATA]**. The polyfill warning appears to apply to bundling the npm
CommonJS package yourself, not to the pre-built bundle.

**CORS is open.** Keeta's nodes return `access-control-allow-origin: *` for
arbitrary HTTPS origins, including on preflight **[DATA]**. A purely
client-side app is viable.

**Classic scripts share one global scope.** If you load several plain `<script>`
files, a top-level `function foo` in one and `const foo` in another is a
*parse-time* `SyntaxError`. The second file silently never registers, with no
console error. Wrap each file in an IIFE.

**Keeta tickers collide with real-world assets, and a divisor will not save
you.** Several on-chain tokens set `info.name` to a sovereign currency code:
`USD`, `EUR`, `JPY`, `GBP`, `CAD`, `HKD`, `MXN`, `CNY`, `AED` **[DATA]**. These
are Keeta-native tokenized representations, not the currencies themselves.
`CBBTC` is a bridged representation of BTC, not BTC.

If you feed those tickers into anything that resolves symbols to assets, expect
it to resolve them to the real thing and price accordingly. Reading the correct
decimals does not help: the amount will be right and the asset will be wrong,
which is harder to notice than a broken number. Anything consuming these tokens
needs a deliberate naming decision, not a passthrough of `info.name`.

---

*Corrections welcome. Everything here was true of v0.18.3 on mainnet in July
2026; the SDK moves, so re-verify against your own installed version.*
