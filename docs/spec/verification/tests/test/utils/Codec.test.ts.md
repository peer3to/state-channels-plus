# Codec.test.ts

Test file: [test/utils/Codec.test.ts](../../../../../../test/utils/Codec.test.ts)
Exercises: [Codec.ts](../../../../implementation/source/src/utils/Codec.ts.md)

## Overview

The suite exercises the public codec surface with factory-built domain values. Every
`Type`, `FraudProofType`, and `DisputeFraudProofType` mapping is encoded and decoded, and canonical
round-trip enforcement is proved for every type: the per-type round trips prove canonical acceptance,
and one corpus case proves that the same bytes with a trailing word are rejected for every type.
Separate cases
cover max-uint256 canonical bytes, primitive/array/tuple EVM returns, recursive Result conversion,
corrupt and truncated bytes, contextual encode errors, and unmapped enum values. Cross-module
Result normalization remains mapped in the dedicated cross-module suite. The block canonical boundary is
proved differentially: a shared `canonicalBlockCorpus` factory (real factory block with a nonempty
dynamic body and a nested message, plus trailing-word/byte, offset-gap, dirty-padding, truncated
and empty members) feeds identical bytes to `Codec.decode` and a Hardhat-deployed `UtilityFacet`,
comparing accept/reject on both sides with byte-identical re-encoding for accepted bytes. The
corpus rejection, normalized acceptance, and every-type trailing rejection cases own
`UNIT-TEST-CODEC-1-HFAA3B.P54`–`P56`. The corpus rejection declaration, which also asserts canonical
acceptance on both sides, owns the neutral block-data permutations `REQ-DATA-1-1KNRQS.T1.P10`–`P12`. The `Block` model
wrappers' failure policy (`from*` throw, `tryFrom*` null, canonical construction succeeds) is proved
by the wrapper declaration here and owns `UNIT-TEST-BLOCK-MODEL-1-037DM6.P30`.

## Tests

- `the existing-window flag survives nested confirmation encoding and binds the signature`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P16, UNIT-TEST-DISPUTE-INPUT-CODEC-1-CWJV98.P1
- `round-trips Block`: UNIT-TEST-CODEC-1-HFAA3B.P1
- `round-trips BlockCommitment`: UNIT-TEST-CODEC-1-HFAA3B.P4
- `round-trips JoinChannel`: UNIT-TEST-CODEC-1-HFAA3B.P5
- `round-trips SignedJoinChannel`: UNIT-TEST-CODEC-1-HFAA3B.P6
- `round-trips JoinChannelConfirmation`: UNIT-TEST-CODEC-1-HFAA3B.P7
- `round-trips OpenChannel`: UNIT-TEST-CODEC-1-HFAA3B.P8
- `round-trips BlockConfirmation`: UNIT-TEST-CODEC-1-HFAA3B.P9
- `round-trips Transaction`: UNIT-TEST-CODEC-1-HFAA3B.P10
- `round-trips Dispute`: UNIT-TEST-CODEC-1-HFAA3B.P11
- `round-trips DisputeConfirmation`: UNIT-TEST-CODEC-1-HFAA3B.P12
- `round-trips StateSnapshot`: UNIT-TEST-CODEC-1-HFAA3B.P13
- `round-trips SnapshotData`: UNIT-TEST-CODEC-1-HFAA3B.P14
- `round-trips JoinChannelBlock`: UNIT-TEST-CODEC-1-HFAA3B.P15
- `round-trips ExitChannelBlock`: UNIT-TEST-CODEC-1-HFAA3B.P16
- `round-trips ExitChannel`: UNIT-TEST-CODEC-1-HFAA3B.P17
- `round-trips DisputeAuditingData`: UNIT-TEST-CODEC-1-HFAA3B.P18
- `round-trips MessageBlock`: UNIT-TEST-CODEC-1-HFAA3B.P19
- `round-trips Balance`: UNIT-TEST-CODEC-1-HFAA3B.P20
- `round-trips SignedBlock`: UNIT-TEST-CODEC-1-HFAA3B.P21
- `round-trips StateProof`: UNIT-TEST-CODEC-1-HFAA3B.P22
- `round-trips SyncPayload`: UNIT-TEST-CODEC-1-HFAA3B.P23
- `preserves uint256 values above Number.MAX_SAFE_INTEGER and canonical ABI bytes`: UNIT-TEST-CODEC-1-HFAA3B.P2
- `round-trips BlockDoubleSign fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P25
- `round-trips BlockInvalidStateTransition fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P26
- `round-trips InvalidTimestamp fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P27
- `round-trips WrongGenesis fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P28
- `round-trips ForgedInboundMessageBlock fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P29
- `round-trips DisputeNotLatestState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P30
- `round-trips DisputeInvalidOutputState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P31
- `round-trips DisputeInvalidStateProof fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P32
- `round-trips DisputeInvalidBalanceInvariant fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P33
- `round-trips DisputeOnChainSlashesNotSubset fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P34
- `round-trips TimeoutThreshold fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P35
- `round-trips TimeoutCalldataPosted fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P36
- `round-trips TimeoutNotLinkedToLatestState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P37
- `round-trips TimeoutParticipantNotNext fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P38
- `round-trips TimeoutTooEarly fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P39
- `round-trips DisputeInvalidBlockInStateProofApplyFraudProof`: UNIT-TEST-CODEC-1-HFAA3B.P40
- `round-trips DisputeLastMilestoneNotFinalAndNoAuditingData fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P41
- `round-trips InvalidDisputeReason fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P42
- `round-trips DisputeStateProofHeaderMismatch fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P43
- `round-trips DisputeInboundHashNotInChain fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P44
- `round-trips DisputeInvalidBlockStructure fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P45
- `round-trips DisputeBlockAuthorNotParticipant fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P46
- `round-trips DisputeInboundAnchorBehindLatestState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P57
- `round-trips DisputeStateProofBelowOnChainAnchor fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P58
- `round-trips TimeoutSupersededByFinalState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P59
- `round-trips DisputeConflictsWithFinalState fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P60
- `round-trips DisputeInvalidOutboundRun fraud proof`: UNIT-TEST-CODEC-1-HFAA3B.P61
- `decodes a primitive EVM return value without object conversion`: UNIT-TEST-CODEC-1-HFAA3B.P47
- `decodes a dynamic EVM array without object conversion`: UNIT-TEST-CODEC-1-HFAA3B.P48
- `decodes a named EVM tuple to an object by default`: UNIT-TEST-CODEC-1-HFAA3B.P49
- `rejects forced object conversion for a primitive EVM result`: UNIT-TEST-CODEC-1-HFAA3B.P50
- `recursively converts nested named and unnamed ethers Results`: UNIT-TEST-CODEC-1-HFAA3B.P51
- `rejects malformed EVM return bytes and ABI schemas`: UNIT-TEST-CODEC-2-8VTG2N.P1
- `throws for corrupt and truncated encoded structs`: UNIT-TEST-CODEC-1-HFAA3B.P3
- `adds type and bigint-safe value context to encode failures`: UNIT-TEST-CODEC-1-HFAA3B.P52
- `rejects unmapped encode and decode type values`: UNIT-TEST-CODEC-1-HFAA3B.P53
- `rejects noncanonical block bytes identically to UtilityFacet`: UNIT-TEST-CODEC-1-HFAA3B.P54, INV-MIRROR-1-VAF778.T1.P11, REQ-DATA-1-1KNRQS.T1.P10, REQ-DATA-1-1KNRQS.T1.P11, REQ-DATA-1-1KNRQS.T1.P12
- `accepts canonical block bytes across hex casing and byte arrays`: UNIT-TEST-CODEC-1-HFAA3B.P55
- `rejects trailing-word encodings for every Codec type`: UNIT-TEST-CODEC-1-HFAA3B.P56, REQ-DATA-1-1KNRQS.T1.P13
- `Block model wrappers enforce canonical decoding failure policy`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P30
