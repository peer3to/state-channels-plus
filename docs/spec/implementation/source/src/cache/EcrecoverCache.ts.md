# EcrecoverCache.ts — Source Report

> **Source:** [src/cache/EcrecoverCache.ts](../../../../../../src/cache/EcrecoverCache.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

A per-thread memo in front of the local EVM's `ecrecover` precompile.
[`installEcrecoverCache(evm)`](../../../../../../src/cache/EcrecoverCache.ts#L43) replaces the
EVM's `common.customCrypto.ecrecover` with a memoized wrapper around the function that was there
(or the `@ethereumjs/util` default). [EvmFactory](../evm/EvmFactory.ts.md) `createEvm` installs it on
every EVM it builds, so every local EVM call — finality, state-proof, balance and fraud-proof checks —
recovers each distinct signature once per thread.

It is a performance measure only. It never decides whether a signature is valid: the contract code
running in the EVM still does that, exactly as on-chain.

## Key design decisions

1. **Memo below the contracts, not a client check.** Mirror calls re-verify the same confirmation
   signatures many times (every finality, state-proof and balance check of a dispute), and each
   recovery is pure-JavaScript secp256k1 on the VM thread. Memoizing the precompile keeps the
   contract logic unchanged, so the mirror stays the same logic as the chain
   ([`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)); only the cost of repeating a pure
   function goes away.
2. **Key is every input of the recovery.** The key is `(hash, v, r, s, chainId)`
   ([#L28](../../../../../../src/cache/EcrecoverCache.ts#L28)), so two calls share an entry only when
   the recovery inputs are identical, and the result is the same public key the unwrapped function
   returns.
3. **Failures are not memoized.** When the wrapped function throws (no key recovers, for example a
   zero `r`), nothing is stored ([#L32](../../../../../../src/cache/EcrecoverCache.ts#L32)) and the
   precompile fails as before; the next call throws again.
4. **Callers own the returned bytes.** A hit returns a copy of the stored key, and the stored
   value is a copy of the first result ([#L31](../../../../../../src/cache/EcrecoverCache.ts#L31),
   [#L33](../../../../../../src/cache/EcrecoverCache.ts#L33)), so no caller can change a later
   answer by mutating a returned array.
5. **Bounded FIFO, shared bound.** The memo shares `SIGNER_RECOVERY_CACHE_MAX` with
   [SignerRecoveryCache](./SignerRecoveryCache.ts.md) and drops the oldest insert past it
   ([#L34](../../../../../../src/cache/EcrecoverCache.ts#L34)); an evicted entry is recovered again.
   Local derived data only: never stored, never sent.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Inputs       | An `EVM` to instrument; at run time, the precompile's `(msgHash, v, r, s, chainId)`.                        |
| Outputs      | The recovered 64-byte public key (a fresh copy), or the wrapped function's exception.                      |
| Owned state  | The per-thread memo `Map` (bounded by `SIGNER_RECOVERY_CACHE_MAX`).                                        |
| Side effects | Replaces `evm.common.customCrypto.ecrecover`. Test-only helpers reset the memo and read its size.          |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [EcrecoverCache.ts](../../../../../../src/cache/EcrecoverCache.ts) | [`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)       |

Contribution per ID: [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb) — the memo keeps the "same logic" constraint: a
mirrored predicate that calls `ecrecover` gets the answer the unmemoized precompile gives.

## Assumptions, dependencies, trust boundaries, and limits

- Relies on `@ethereumjs/evm` routing its ecrecover precompile through
  `common.customCrypto.ecrecover`. A library upgrade that bypasses that hook silently removes the
  memo (slower, never wrong).
- Installing twice on one `common` wraps the memo in a memo; results are unchanged.
- One memo per worker thread, shared by every EVM on that thread; recovery is pure, so sharing
  cannot leak one EVM's answer into another's.

## Specification adherence

- The mirror executes the same contract code; the memo changes cost only.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                            | Gap / divergence |
| ---------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-MIRROR-1-XCY9CB`](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb) | Covered               | **Here:** the memo wraps the precompile's recovery function without changing its inputs or output, and keeps no failed recovery ([#L27](../../../../../../src/cache/EcrecoverCache.ts#L27)). **Other files:** [EvmFactory](../evm/EvmFactory.ts.md) installs it on every local EVM. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation                              | Public entry and setup                                                                                                                                      | Oracle and forbidden effects                                                                                                                                                            | Required permutations |
| ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| <a id="unit-test-ecrecover-cache-1-s0eeq5"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5` | Memoized precompile, unchanged results | Build an EVM with `createEvm` (memo installed) and a plain `EVM.create()`; call the ecrecover precompile (address `0x01`) with real `(digest, v, r, s)` from a random wallet; reset the memo before each case | The memoized EVM returns the same output and uses the same gas as the plain EVM and resolves to the wallet address; memo size counts distinct recoveries only; a failed recovery returns empty output and adds no entry; a mutated returned key never changes a later hit; the size never exceeds the bound | <a id="unit-test-ecrecover-cache-1-s0eeq5.p1"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P1` — the memoized precompile returns the same output as an EVM without the memo, and that output is the signing wallet's address; <a id="unit-test-ecrecover-cache-1-s0eeq5.p2"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P2` — three calls with one signature return one output and keep one entry, and a second signature adds a second entry; <a id="unit-test-ecrecover-cache-1-s0eeq5.p3"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P3` — a signature that recovers no key (zero `r`) returns empty output and keeps no entry; <a id="unit-test-ecrecover-cache-1-s0eeq5.p4"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P4` — mutating the key returned by a miss or a hit does not change the key a later hit returns; <a id="unit-test-ecrecover-cache-1-s0eeq5.p5"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P5` — with `SIGNER_RECOVERY_CACHE_MAX` lowered, recoveries past the bound keep the size at the bound, drop the oldest first, and an evicted signature recovers the same key again; <a id="unit-test-ecrecover-cache-1-s0eeq5.p6"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P6` — repeated calls after a cache fill return the plain EVM's output and gas, and only the first runs a real recovery; <a id="unit-test-ecrecover-cache-1-s0eeq5.p7"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P7` — a high-`s` signature (accepted by the precompile, unlike the contracts' author check) returns the plain EVM's output and gas, also from a memo hit; <a id="unit-test-ecrecover-cache-1-s0eeq5.p8"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P8` — a `v` other than 27 or 28 returns the plain EVM's empty output and gas, runs no recovery and keeps no entry; <a id="unit-test-ecrecover-cache-1-s0eeq5.p9"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P9` — one gas below the precompile cost fails out of gas like the plain EVM with no recovery, the exact cost succeeds, and a memo hit is still refused below the cost; <a id="unit-test-ecrecover-cache-1-s0eeq5.p10"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P10` — the digest is part of the key: in a cache already holding other entries, one signature under two digests returns, on repeated calls, the plain EVM's result for each digest (a different key for the second), and runs one real recovery per digest; <a id="unit-test-ecrecover-cache-1-s0eeq5.p11"></a>`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P11` — the signature is part of the key: in a cache already holding other entries, two wallets' signatures under one digest return, on repeated calls, the plain EVM's result naming each wallet, and run one real recovery per signature |

## Related source reports

- [index.ts](./index.ts.md) — re-exports this module as `@/cache`.
- [SignerRecoveryCache.ts](./SignerRecoveryCache.ts.md) — the client-side signature check; shares the size bound.
- [EvmFactory.ts](../evm/EvmFactory.ts.md) — installs the memo on every local EVM.
