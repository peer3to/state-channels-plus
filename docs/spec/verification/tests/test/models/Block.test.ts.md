# Block.test.ts

Test file: [test/models/Block.test.ts](../../../../../../test/models/Block.test.ts)
Exercises: [Block.ts](../../../../implementation/source/src/models/Block.ts.md)

## Overview

The suite drives the `Block` model class directly — no protocol harness — using factory-built
blocks from `test/factory` and real Hardhat signers for ECDSA signatures. It asserts that
`fromSignedBlock`/`fromBlockConfirmation` decode back to a `BlockStruct` deep-equal to the
original, that `hash` is the keccak256 of the canonical encoding, and that every property getter
mirrors its `BlockStruct` field. Signature oracles cover `sign`/`signBlock` round trips through
address recovery, `findSignature` for signers and non-signers, and the confirmation-signature set:
expand from array or `Set`, no duplicates, removal that never evicts the author's original
signature, and a `didSign` address cache that stays coherent across expand and remove.
`isAuthentic` is checked as the author predicate: true when the original signature recovers to
the header participant, false when another key signed for the declared author, false without
throwing for a malformed signature, and false when only confirmation signatures are valid.
`getRelevantTimestamp` is checked per branch (signed participant, unsigned with/without
`onChainTimestamp`, max of both), and `onChainTimestamp` is shown to be local-only metadata that
never changes encoding, hash, or equality. Out of scope: validation, storage, and queue behavior
around blocks (owned by the ValidationService and BlockQueueManager suites). Of the first thirteen
`UNIT-TEST-BLOCK-MODEL-1-037DM6` permutations, eleven are covered by single tests here: the round trip
(P1), duplicate-signature dedup (P2), the author-signed (P4) and posted (P6)
relevant-timestamp selections, the canonical signature-byte cases (P7–P12), and the forged-author
rejection (P13). P3 targets `didEveryoneSign`, which this file never calls, and
P5's malleated-signature dedup is never exercised, so those two stay unassigned.

The `Authenticity` block and the last describe exercise the signature-parity work. A positive
author check (P23) and a forged author that valid confirmations cannot rescue (P22) sit beside
the forged-author case. The last describe covers `authorSignedCopy` (the queue entry's
author-signed base block) sharing the struct,
bytes and hash while dropping only the confirmations (P14) and giving the copy its own confirmation
set (P15), and `isAuthentic` false for every contract-rejected author-signature encoding from
`SignatureEncodingFixture` (P21). These are Block behavior tests only; the differential parity
of the signature rule against the contract is the signer-recovery cache suite's. Block decoding is
`Codec` only, so the file has no decoding-parity cases (the open deviation is
`FIND-DECODE-1-FD1V6V`).
Unassigned: P24 — no test puts a rejected encoding in a confirmation signature — and with it
`INV-MIRROR-1-VAF778.T1.P9` (confirmation signatures follow the author rule), which is covered by ValidationService.test.ts (normalization of a contract-rejected confirmation encoding).
The malformed-signature case (`0x1234`) is one wrong-length input, narrower than P21, and stays
unassigned.

## Tests

- `should create Block from BlockStruct`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P1
- `should create Block from BlockConfirmation`: none
- `should compute hash correctly`: none
- `should have consistent hash for same data`: none
- `should return correct coordinates`: none
- `should return correct height`: none
- `should return correct forkId`: none
- `should return correct timestamp`: none
- `should return correct author`: none
- `should return correct channelId`: none
- `should return correct previousBlockHash`: none
- `should return correct stateSnapshotHash`: none
- `should return correct transaction`: none
- `should identify equal blocks`: none
- `should identify different blocks`: none
- `should get signer address from signature`: none
- `should find participant signature`: none
- `should handle participant who didn't sign`: none
- `should sign block`: none
- `should create signed block`: none
- `should return signer address from original signature`: none
- `should return confirmation signatures`: none
- `should return all signatures including original and confirmations`: none
- `should return confirmation signer addresses`: none
- `should return all signer addresses`: none
- `should expand signatures with new signatures array`: none
- `should grow cached signer addresses when expanding signatures`: none
- `should expand signatures with new signatures Set`: none
- `should not duplicate signatures when expanding`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P2
- `should remove confirmation signatures`: none
- `should shrink cached signer addresses when removing signatures`: none
- `should keep the author's original signature when removing`: none
- `should ignore removing unknown signatures`: none
- `should be authentic when the author signature recovers to the header participant`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P23
- `should be inauthentic when another key signed for the declared author`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P13
- `should be inauthentic for a malformed signature without throwing`: none
- `should be inauthentic when confirmation signatures are valid but the author signature is not`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P22
- `should return correct block confirmation struct`: none
- `should return block timestamp when participant has signed`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P4
- `should return onChainTimestamp when participant has not signed and onChainTimestamp is set`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P6
- `should return block timestamp when participant has not signed and onChainTimestamp is not set`: none
- `should return max of onChainTimestamp and block timestamp when both are set`: none
- `should not allow modification of underlying data`: none
- `should have undefined onChainTimestamp by default`: none
- `should set and get onChainTimestamp`: none
- `should not affect encoding when onChainTimestamp is set`: none
- `should not change hash when onChainTimestamp is set`: none
- `should consider blocks equal regardless of onChainTimestamp`: none
- `equivalent byte representations share one recovery-cache entry`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P7
- `merge uses canonical equality and keeps its original author envelope`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P8
- `struct construction and author re-signing normalize real signer output`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P9
- `constructors deduplicate hex casing and byte-array confirmations`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P10
- `expansion and removal use the same byte equality`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P11
- `keeps malformed envelopes unchanged for authentication failure`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P12
- `authorSignedCopy shares the struct, bytes and hash and drops only the confirmations`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P14
- `authorSignedCopy gives the copy its own confirmation set`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P15
- `isAuthentic is false for every author-signature encoding the contracts reject`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P21
