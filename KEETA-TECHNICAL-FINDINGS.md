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

# 2. Token decimals: there is no on-chain source

**This is the highest-severity correctness issue for anything that displays
amounts.**

Amounts are `bigint` base units. Converting to a human-readable figure needs a
divisor, and **Keeta publishes decimal precision nowhere on-chain.**

Every route checked **[SOURCE]** / **[DATA]**:

- `TokenAccountInfo` → `account, name, description, metadata, defaultPermission?, supply`. **No decimals.**
- `Config.getDefaultConfig('main')` → `networkAlias, network, initialTrustedAccount, representatives, validation, publishAidURL`. **No base token entry.**
- `client.baseToken` → an `Account` object, methods only.
- `BaseTokenInfo.decimalPlaces` exists but is a **genesis input**, not queryable at runtime.
- Live metadata endpoint → contains 13 `decimalPlaces` values, but **all are for EVM assets** on the foreign side of bridge configs. **Zero for native `keeta_…` tokens.**

**Observed in production:** across 9 distinct tokens on a real wallet, **every
single one had an empty `name` and empty `metadata`** **[DATA]**. Including the
base token. The gap is total, not theoretical.

### The divisor is network-dependent

| | Mainnet | Testnet |
|---|---|---|
| Network name | `'main'` | `'test'` |
| Network ID | `0x5382` | `0x54455354` |
| **KTA decimals** | **18** | **9** |

Develop against testnet, ship against mainnet, and every amount is wrong by
**10⁹**, silently. Derive the divisor from the network identifier, and assert
that fetched blocks carry the network ID you expect before trusting any figure.

KTA = 18 on mainnet is **confirmed against the explorer** across 19 orders of
magnitude **[DATA]**:

| Raw base units | At 10^18 | Explorer shows |
|---|---|---|
| `1` | 0.000000000000000001 | `0.000000000000000001 KTA` |
| `50000000000000000` | 0.05 | `0.05 KTA` |
| `10000000000000000000` | 10 | `10 KTA` |

### What to do about it

Decimals must come from a maintained off-chain registry. Every code example in
the ecosystem hardcodes them. Bridge implementations ship a hand-written
`TOKEN_MAP` and never derive decimals from chain.

A useful registry (KTA 18, USDC 6, EURC 6, cbBTC 8, on-chain fiat tokens 2, and
`$JPY` **0**) is published at
`theanchorfactory.com/docs/reference/network-constants`. It is third-party, but
it cross-validated three-for-three against real chain data (KTA address, network
ID `0x5382`, chain location `21378`).

Two traps in any such table:

- **`$JPY` has 0 decimals.** Any "falsy means missing" check corrupts it. `0` and `undefined` must be distinct.
- **Unknown tokens must hard-fail.** A token not in your registry has no
  discoverable divisor. Guessing 18 produces a plausible, wrong number. Refuse
  and surface it.

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

---

*Corrections welcome. Everything here was true of v0.18.3 on mainnet in July
2026; the SDK moves, so re-verify against your own installed version.*
