# SignerRecoveryCache.ts — Source Report

> **Source:** [src/cache/SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [protocol/finality.md](../../../views/protocol/finality.md)

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

The single off-chain entry for ECDSA signer recovery over protocol-object messages (blocks,
transactions, opens, joins, disputes). `recoverSigner(message, signature)` returns the recovered
address and memoizes it per thread. On every memo miss it also checks that the recovered signer has
only one canonical signature over that message, and publishes a double-signature report to the
listeners registered with `onDoubleSignature`. The module has no network side effects; acting on a
report is the listener's job.

## Key design decisions

- **Detection lives in the one recovery path.** Every protocol signature is recovered through
  [`recoverSigner`](../../../../../../src/cache/SignerRecoveryCache.ts#L98), so one check covers every
  message kind without per-kind hooks.
- **Canonical comparison.** A signature is compared in its ethers canonical 65-byte form
  ([`checkDoubleSignature`](../../../../../../src/cache/SignerRecoveryCache.ts#L69)); v 0/1, v >= 35 and
  64-byte compact encodings map onto one value, so a relayer that re-encodes an honest signature
  cannot frame its signer. The first canonical value per (message, signer) is kept; later distinct
  values are each reported against it.
- **Same bound for both memos.** The recovery memo and the (message, signer) → canonical-signature
  memo both use `SIGNER_RECOVERY_CACHE_MAX` with insertion-order eviction
  ([`setBounded`](../../../../../../src/cache/SignerRecoveryCache.ts#L55)). An evicted canonical entry
  only means a later conflict against it goes unreported.
- **Thread-wide listeners.** The memo is a module singleton shared by every runtime in the thread,
  so only the first runtime to recover a conflicting signature can observe it. Every registered
  listener therefore hears every report
  ([listener set](../../../../../../src/cache/SignerRecoveryCache.ts#L49)); registration returns its own
  removal function.
- **Listener failures are isolated.** Each listener call is wrapped so a throwing listener neither
  fails the recovery that found the conflict nor keeps later listeners from hearing it. Listeners own
  their logging; the cache has no logger.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Inputs       | Message digest bytes and a signature in any encoding `verifyMessage` accepts; listener registrations.      |
| Outputs      | Recovered checksummed address; double-signature reports (signer, message hex, both canonical signatures). |
| Owned state  | Two bounded per-thread maps and one listener set; local-only, never serialized.                            |
| Side effects | Synchronous listener calls on a detected conflict. None towards the network.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                | Specification IDs                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts) | [`REQ-ID-5-GW1ZEY`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey), [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) |

- [`REQ-ID-5-GW1ZEY` (One signature per signer per message)](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey): detects the
  second canonical signature value and reports its signer; exclusion is the listener's.
- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9): memoized
  off-chain recovery returns exactly what `verifyMessage` returns.

## Assumptions, dependencies, trust boundaries, and limits

- Signers are deterministic; a random-nonce signer is reported whenever it re-signs.
- Canonicalization is ethers `Signature.from(...).serialized`. For 65-byte input ethers rejects
  only s >= 2^255 and does not enforce low-s, so a signature and its flipped form (s, n - s) are two
  canonical values. Relayer framing stays impractical: flipping an honest low-s signature lands in
  the accepted window only with negligible probability.
  The on-chain canonical-form rules are not re-implemented here.
- Detection is per thread and bounded. A worker thread without a registered listener detects but
  nobody acts; a conflict split across threads or nodes is not seen.
- Listeners run synchronously inside recovery; a throwing listener is ignored by the cache, so each
  listener logs its own failures.

## Specification adherence

- One canonical value per (message, signer), compared after canonicalization, for every
  protocol-object kind.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                  | Gap / divergence |
| ----------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-5-GW1ZEY`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey) | Covered               | **Here:** [canonical conflict check](../../../../../../src/cache/SignerRecoveryCache.ts#L69) on every recovery miss, bounded memo, thread-wide listener reports. **Other files:** [P2PManager](../P2PManager.ts.md) blacklists the reported signer, never the relayer and never itself; [SignatureUtils](../utils/SignatureUtils.ts.md) and [Block](../models/Block.ts.md) route every recovery here. | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="unit-test-signerrecoverycache-1-gv89w4"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4` | Memoized recovery and double-signature reports | Call `recoverSigner`, directly or through the `SignatureUtils` join, transaction, dispute and open recovery helpers, with real signatures from random ethers wallets (RFC 6979 and explicit-nonce variants, plus re-encodings); register listeners with `onDoubleSignature`, including a throwing one; lower `SIGNER_RECOVERY_CACHE_MAX` for bound cases. | Recovered address equals the signing wallet; reports carry the signer, message hex and both canonical signatures; no report for identical values, re-encodings, other messages or other signers. | <a id="unit-test-signerrecoverycache-1-gv89w4.p1"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P1` — recovers the same address as `verifyMessage`; <a id="unit-test-signerrecoverycache-1-gv89w4.p2"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P2` — a repeated (message, signature) adds no recovery entry; <a id="unit-test-signerrecoverycache-1-gv89w4.p3"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P3` — the message is part of the recovery key; <a id="unit-test-signerrecoverycache-1-gv89w4.p4"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P4` — the recovery memo is bounded with oldest-first eviction; <a id="unit-test-signerrecoverycache-1-gv89w4.p5"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5` — the same signature twice reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p6"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6` — a second nonce signature reports the signer, message and both canonical signatures; <a id="unit-test-signerrecoverycache-1-gv89w4.p7"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7` — v 0/1 re-encoding reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p8"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8` — v 35/36 re-encoding reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p9"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9` — 64-byte compact re-encoding reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p10"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10` — the 65-byte form after its compact form reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p11"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11` — one signer on different messages reports nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p12"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12` — two signers on one message report nothing; <a id="unit-test-signerrecoverycache-1-gv89w4.p13"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13` — the canonical-signature memo is bounded; <a id="unit-test-signerrecoverycache-1-gv89w4.p14"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14` — a conflict with an evicted entry is unreported while a retained one is reported; <a id="unit-test-signerrecoverycache-1-gv89w4.p15"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15` — every registered listener hears a report; <a id="unit-test-signerrecoverycache-1-gv89w4.p16"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16` — a removed listener hears no later report; <a id="unit-test-signerrecoverycache-1-gv89w4.p17"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P17` — a throwing listener neither fails recovery nor starves another listener; <a id="unit-test-signerrecoverycache-1-gv89w4.p18"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P18` — join recovery reports a nonce-variant signer; <a id="unit-test-signerrecoverycache-1-gv89w4.p19"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P19` — transaction recovery reports a nonce-variant signer; <a id="unit-test-signerrecoverycache-1-gv89w4.p20"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P20` — dispute recovery reports a nonce-variant signer; <a id="unit-test-signerrecoverycache-1-gv89w4.p21"></a>`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P21` — open-channel recovery reports a nonce-variant signer |

## Related source reports

- [P2PManager.ts](../P2PManager.ts.md) — registers the blacklisting listener.
- [SignatureUtils.ts](../utils/SignatureUtils.ts.md) and [Block.ts](../models/Block.ts.md) — recovery callers.
- [index.ts](./index.ts.md) — re-exports this module.
