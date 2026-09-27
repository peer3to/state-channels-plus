# SignerRecoveryCache.ts — Source Report

> **Source:** [src/cache/SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts) > **Status:** Authored — engineer verification pending.
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

The one place the client decides whether a protocol signature is valid and who signed it. Two
exports carry the behavior:

- [`isContractAcceptedSignature(signature)`](../../../../../../src/cache/SignerRecoveryCache.ts#L36)
  — true exactly for the encodings the contracts accept: 65 bytes `(r, s, v)`, `v` of 27 or 28,
  `0 < r < n` and `0 < s <= n/2` (`n` is the secp256k1 group order). This is what OpenZeppelin
  `ECDSA.tryRecover(bytes32, bytes)` accepts, which the contracts' `retrieveSignerAddress` uses.
- [`recoverSigner(message, signature)`](../../../../../../src/cache/SignerRecoveryCache.ts#L51)
  — the EIP-191 signer of `signature` over `message` (a 32-byte digest). It throws for an encoding
  the contracts reject, before any recovery or memo access
  ([#L55](../../../../../../src/cache/SignerRecoveryCache.ts#L55)), and memoizes every successful
  recovery.

Every protocol signature recovery in TypeScript goes through `recoverSigner`: block author and
confirmation signatures ([Block](../models/Block.ts.md) `signatureToAddress`) and join/open
signatures ([SignatureUtils](../utils/SignatureUtils.ts.md) `getSignerAddress`). The transport
challenge in `InitHandshakeService` uses `ethers.verifyMessage` directly; it is a connection
check, not a signature the contracts ever see, so it is outside this rule.

## Key design decisions

1. **One acceptance rule, the contracts' rule, for every signature (engineer decision,
   2026-09-26).** Author authenticity stays in TypeScript with a cache, for speed, but it must match
   the contracts exactly. ethers is more permissive than OpenZeppelin: it accepts 64-byte compact
   signatures, `v` of 0/1 and EIP-155 `v` values, and does not reject a high `s`. Without the check
   a Byzantine author could send one of those encodings of a real signature; the client would
   accept a block that every on-chain proof check rejects. So `recoverSigner` refuses these
   encodings first ([#L55](../../../../../../src/cache/SignerRecoveryCache.ts#L55)). Confirmation
   signatures are the same signatures over the same bytes and go through the same function, so the
   rule is symmetric. This is the signature carve-out of
   [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778).
2. **The rule is a byte check, not a second recovery.** The check reads length, `v`, `r` and `s`
   against constants ([#L8](../../../../../../src/cache/SignerRecoveryCache.ts#L8)); recovery
   itself is still ethers' `verifyMessage`. For an accepted encoding ethers and ecrecover recover
   the same key, so parity reduces to the acceptance predicate.
3. **Rejection is an exception, not a sentinel address.** A rejected encoding throws, like an
   encoding that recovers no key. Callers that need a boolean catch it:
   [Block](../models/Block.ts.md) `isAuthentic` returns false, and confirmation classification in
   [ValidationService](../stateManager/ingest/ValidationService.ts.md) collects the value as
   unrecoverable. A thrown signature is never memoized.
4. **Per-thread FIFO memo, bounded.** The memo is a module-level `Map` keyed by the message bytes
   plus the signature string ([#L22](../../../../../../src/cache/SignerRecoveryCache.ts#L22),
   [#L24](../../../../../../src/cache/SignerRecoveryCache.ts#L24)). Recovery is a pure function of
   its inputs, so a hit never changes who a signature resolves to. Past
   `SIGNER_RECOVERY_CACHE_MAX` (default 100,000, [config](../utils/config.ts.md)) the oldest insert
   is dropped ([#L64](../../../../../../src/cache/SignerRecoveryCache.ts#L64)); an evicted pair is
   recovered again on its next use. Local derived data only: never stored, never sent.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | A message digest and a signature (hex string), usually peer supplied.                                                     |
| Outputs      | The recovered checksum address, or a thrown error for a contract-rejected or unrecoverable encoding; a boolean verdict.   |
| Owned state  | The per-thread memo `Map` (bounded by `SIGNER_RECOVERY_CACHE_MAX`).                                                       |
| Side effects | None beyond the memo. Test-only helpers reset the memo and read its size.                                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                   | Specification IDs                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts) | [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778), [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6), [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) |

Contribution per ID: [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) — owns the signature
carve-out's signature half: the client accepts exactly the encodings the contract logic accepts and
recovers the same signer; [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) — the signature
test inside stage-1 authentication; [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) — the recovery primitive,
with the malleable high-`s` form refused.

## Assumptions, dependencies, trust boundaries, and limits

- The signature is untrusted peer input; the digest is computed locally by the caller from the
  signed bytes (for a block, `keccak256(encodedBlock)`).
- Parity assumes the deployed contracts keep OpenZeppelin `ECDSA.tryRecover(bytes32, bytes)`
  semantics in `retrieveSignerAddress`. A contract change to that rule needs the same change here;
  the parity test obligation below is the guard.
- The memo key uses the signature string as given. Two byte-equal signatures with different hex
  casing make two entries; [Block](../models/Block.ts.md) normalizes casing before recovery, so
  block paths share one entry. The answer is the same either way.
- One memo per worker thread; nothing is shared across threads or persisted.

## Specification adherence

- A client check that is neither more permissive nor stricter than the contracts, as the
  carve-out requires; the same rule serves author and confirmation signatures.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                               | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-MIRROR-1-VAF778`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)                   | Covered               | **Here:** `isContractAcceptedSignature` encodes the contracts' acceptance rule ([#L36](../../../../../../src/cache/SignerRecoveryCache.ts#L36)) and `recoverSigner` applies it before every recovery ([#L55](../../../../../../src/cache/SignerRecoveryCache.ts#L55)). **Other files:** [Block](../models/Block.ts.md) (author and confirmation signatures), [SignatureUtils](../utils/SignatureUtils.ts.md) (join/open signatures), [ValidationService](../stateManager/ingest/ValidationService.ts.md) (confirmation normalization). | None for signatures; envelope decoding is outside the carve-out ([`FIND-DECODE-1-FD1V6V`](../../../../audit/open-findings.md#find-decode-1-fd1v6v)). |
| [`REQ-BLOCK-PIPE-2-PCXNT6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6) | Covered               | **Here:** the signature test of author authentication ([#L51](../../../../../../src/cache/SignerRecoveryCache.ts#L51)). **Other files:** [Block](../models/Block.ts.md) `isAuthentic` compares the signer with the declared author; [BlockQueueManager](../stateManager/ingest/BlockQueueManager.ts.md) and [BlockIngestService](../stateManager/ingest/BlockIngestService.ts.md) decode the block first (`Codec`).                                                                                                                                                         | None.            |
| [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)                             | Covered               | **Here:** EIP-191 recovery over the caller's digest, high `s` refused ([#L43](../../../../../../src/cache/SignerRecoveryCache.ts#L43)). **Other files:** [SignatureUtils](../utils/SignatureUtils.ts.md) and [Block](../models/Block.ts.md) choose the canonical target.                                                                                                                                                                                                                                    | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation                               | Public entry and setup                                                                                                                                                                                                  | Oracle and forbidden effects                                                                                                                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-signer-recovery-cache-1-j4y8zp"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP` | Contract-parity recovery with a bounded memo | Call `recoverSigner` and `isContractAcceptedSignature` directly on real wallet signatures over random digests, with the memo reset before each case; for parity, compare against a deployed `UtilityFacet.retrieveSignerAddress` on the same bytes and every rejected re-encoding of one real signature | Accepted encodings recover the wallet address (equal to `verifyMessage` and to the contract's signer); rejected encodings throw and are refused by the predicate exactly when the contract reports invalid; memo size follows distinct (message, signature) pairs and never exceeds the bound; eviction drops the oldest and never changes a result | <a id="unit-test-signer-recovery-cache-1-j4y8zp.p1"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P1` — an ordinary 65-byte signature recovers the signing wallet's address, equal to `ethers.verifyMessage`; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p2"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P2` — repeated recoveries of one (message, signature) pair keep one memo entry, and a second pair adds a second entry; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p4"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P4` — with `SIGNER_RECOVERY_CACHE_MAX` lowered, inserts past the bound keep the size at the bound, drop the oldest entries first, and the kept entries still resolve to their signers; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p5"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P5` — every contract-rejected encoding class of one real signature (compact 64-byte, `v` of 0/1, EIP-155 `v`, high `s`, zero `r`, zero `s`, `r` at the group order, 66 bytes, 63 bytes, empty) is refused by `isContractAcceptedSignature` and makes `recoverSigner` throw, exactly as the contract's `retrieveSignerAddress` reports invalid, while the ordinary encoding is accepted with the contract's signer; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p6"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P6` — a rejected encoding throws before the memo is read or written: the memo size is unchanged after the throw; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p7"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P7` — the message is part of the key: one signature over two messages recovers, on repeated calls, each message's own signer as the uncached `verifyMessage` does, with two memo entries and one real recovery per message; <a id="unit-test-signer-recovery-cache-1-j4y8zp.p8"></a>`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P8` — the signature is part of the key: one message signed by two wallets recovers, on repeated calls, each wallet as the uncached `verifyMessage` does, with two memo entries and one real recovery per signature |

## Related source reports

- [index.ts](./index.ts.md) — re-exports this module as `@/cache`.
- [EcrecoverCache.ts](./EcrecoverCache.ts.md) — the sibling memo for the local EVM's ecrecover precompile.
- [Block.ts](../models/Block.ts.md), [SignatureUtils.ts](../utils/SignatureUtils.ts.md) — the protocol callers.
- [ValidationService.ts](../stateManager/ingest/ValidationService.ts.md) — confirmation-signature normalization under the same rule.
