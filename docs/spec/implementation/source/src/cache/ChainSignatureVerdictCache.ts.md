# ChainSignatureVerdictCache.ts — Source Report

> **Source:** [src/cache/ChainSignatureVerdictCache.ts](../../../../../../src/cache/ChainSignatureVerdictCache.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

A per-thread memo of the chain's verdict on a (message digest, signature) pair: whether on-chain
recovery (`UtilityFacet.retrieveSignerAddresses`, OpenZeppelin `ECDSA.tryRecover`) accepts it.

## Key design decisions

1. **Memo only, rule stays in Solidity.** The cache stores the verdict the local diamond returned;
   it never decides one ([getChainSignatureVerdict](../../../../../../src/cache/ChainSignatureVerdictCache.ts#L20)).
   A missing entry means "ask the chain".
2. **Same key and bound as the signer recovery cache.** Keys come from the shared
   `signatureCacheKey`, and the size is bounded by `SIGNER_RECOVERY_CACHE_MAX` with oldest-first
   eviction ([setChainSignatureVerdict](../../../../../../src/cache/ChainSignatureVerdictCache.ts#L27)).
   An evicted pair is classified again.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | Message digest bytes, a normalized signature, the chain verdict.         |
| Outputs      | The stored verdict, or `undefined` when none is held.                    |
| Owned state  | One module-level map per thread.                                         |
| Side effects | None beyond its map; never serialized or sent.                           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file | Specification IDs |
| --- | --- |
| [ChainSignatureVerdictCache.ts](../../../../../../src/cache/ChainSignatureVerdictCache.ts) | [`REQ-BLKSTORE-4-RQTR2Y`](../../../../specification/storage/blocks.md#req-blkstore-4-rqtr2y) — remembers which confirmation values the chain rejects, so classification of relayed copies needs no repeated call. |

## Assumptions, dependencies, trust boundaries, and limits

- Local-only derived data; no peer input reaches it except through the classifier that asks the chain.
- A verdict is a pure function of (digest, signature), so a stale entry cannot exist.

## Specification adherence

- Keeps the on-chain rule as the only classifier; the memo changes cost, not outcomes.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| --- | --- | --- | --- |
| [`REQ-BLKSTORE-4-RQTR2Y`](../../../../specification/storage/blocks.md#req-blkstore-4-rqtr2y) | Covered | **Here:** verdict memo ([#L20](../../../../../../src/cache/ChainSignatureVerdictCache.ts#L20), [#L27](../../../../../../src/cache/ChainSignatureVerdictCache.ts#L27)). **Other files:** [ValidationService.ts](../stateManager/ingest/ValidationService.ts.md) asks the chain and stores the verdict. | None for this contribution. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="unit-test-chain-signature-verdict-cache-1-9h0xz0"></a>`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0` | Verdict memo | Set and get verdicts for real signatures over random digests through the exported functions. | Exact stored verdicts; no verdict for unknown pairs; size bound and oldest-first eviction. | <a id="unit-test-chain-signature-verdict-cache-1-9h0xz0.p1"></a>`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P1` — unknown pair has no verdict; <a id="unit-test-chain-signature-verdict-cache-1-9h0xz0.p2"></a>`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P2` — accepted and rejected verdicts are returned for their own pairs; <a id="unit-test-chain-signature-verdict-cache-1-9h0xz0.p3"></a>`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P3` — the digest is part of the key; <a id="unit-test-chain-signature-verdict-cache-1-9h0xz0.p4"></a>`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P4` — size bound with oldest-first eviction |

## Related source reports

- [ValidationService.ts.md](../stateManager/ingest/ValidationService.ts.md)
