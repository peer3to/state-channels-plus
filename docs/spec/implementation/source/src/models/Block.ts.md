# Block.ts

> **Source:** [src/models/Block.ts](../../../../../../src/models/Block.ts)

## Requirements

- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)
- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
  Partial: Envelope decoding is `Codec`, not the contracts' decoder, and is not at parity with it ([`FIND-DECODE-1-FD1V6V`](../../../../audit/open-findings.md#find-decode-1-fd1v6v)).
- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)

## UNIT-TEST-BLOCK-MODEL-1-037DM6

Model semantics

- Setup: Round-trip, expand with dup/malleated signatures, compute relevant timestamps both ways, check author authenticity with every contract-rejected encoding, copy blocks without confirmation signatures
- Oracle: Byte-exact round trips; dedup by signer; timestamp selection per posting state; authentic iff the author signed in a contract-accepted encoding; a signature-free copy shares hash and bytes

- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P1` — round trip
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P2` — duplicate-signature dedup
- [ ] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P3` — didEveryoneSign unions
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P4` — author-signed relevant timestamp
- [ ] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P5` — malleated-signature dedup
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P6` — posted relevant timestamp
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P7` — equivalent byte representations share one recovery-cache entry
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P8` — merge uses canonical equality and keeps its original author envelope
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P9` — struct construction and author re-signing normalize real signer output
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P10` — constructors deduplicate hex casing and byte-array confirmations
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P11` — expansion and removal use the same byte equality
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P12` — keeps malformed envelopes unchanged for authentication failure
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P13` — forged author signature is inauthentic
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P14` — `authorSignedCopy` keeps the author signature and on-chain timestamp, drops every confirmation signature, and returns the same hash and encoded bytes without mutating the source block
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P15` — `authorSignedCopy` gives the copy its own confirmation set: adding to the copy and removing from the source leave the other unchanged
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P21` — `isAuthentic` is false, without throwing, for each contract-rejected author-signature encoding class (compact 64-byte, `v` of 0/1, EIP-155 `v`, high `s`, zero `r`, zero `s`, `r` at the group order, 66 bytes, 63 bytes, empty), while the canonical signature is authentic
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P22` — valid confirmation signatures do not make a block with a forged author signature authentic
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P23` — `isAuthentic` is true when the author signature is contract-accepted and recovers to the header participant
- [ ] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P24` — a confirmation signature in a contract-rejected encoding fails recovery in `signatureToAddress` exactly as the same encoding of the author signature does
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P25` — A high-s confirmation is omitted from accepted signers while the author and valid confirmer remain; strict all-signer access throws
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P26` — A confirmation with contract-rejected v is omitted from accepted signers while valid signers remain; strict all-signer access throws
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P27` — A contract-rejected author signature is omitted from accepted signers while both valid confirmers remain; strict all-signer access throws
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P28` — With all signatures valid, accepted signers equal strict all signers and contain author and both confirmers
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P29` — Logging a block with a rejected confirmation does not throw and lists exactly its accepted author and confirmer

## UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR

Same-block copy merge

- Setup: Merge factory-built copies through Block.mergeFrom and inspect the confirmation signature set and defined/undefined timestamp policy.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P1` — mergeFrom preserves a defined timestamp when the incoming copy has none
- [x] `UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P2` — mergeFrom accepts a zero timestamp from the incoming copy
