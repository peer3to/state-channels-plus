# Codec.ts

> **Source:** [src/utils/Codec.ts](../../../../../../src/utils/Codec.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)
- [`INV-DATA-1-F8CG0P` (Equal logical values have one canonical encoding and decode identically in…)](../../../../specification/protocol-model/data-types.md#inv-data-1-f8cg0p)
- [`REQ-DATA-4-HFEAEA` (Integers and bytes cross ABI, off-chain runtime, worker, RPC, and persistence…)](../../../../specification/protocol-model/data-types.md#req-data-4-hfeaea)

## UNIT-TEST-CODEC-1-HFAA3B

Complete codec public surface

- Setup: Encode/decode every schema; decode EVM values; normalize Results; exercise bad inputs
- Oracle: Canonical bytes and values survive; every enum mapping is reachable; invalid input throws with no partial output

- [x] `UNIT-TEST-CODEC-1-HFAA3B.P1` — Block round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P2` — max uint256 and canonical Balance bytes
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P3` — corrupt and truncated payloads
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P4` — BlockCommitment round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P5` — JoinChannel round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P6` — SignedJoinChannel round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P7` — JoinChannelConfirmation round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P8` — OpenChannel round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P9` — BlockConfirmation round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P10` — Transaction round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P11` — Dispute round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P12` — DisputeConfirmation round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P13` — StateSnapshot round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P14` — SnapshotData round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P15` — JoinChannelBlock round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P16` — ExitChannelBlock round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P17` — ExitChannel round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P18` — DisputeAuditingData round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P19` — MessageBlock round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P20` — Balance round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P21` — SignedBlock round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P22` — StateProof round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P23` — SyncPayload round trip
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P24` — cross-module ethers Result normalization
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P25` — BlockDoubleSign proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P26` — BlockInvalidStateTransition proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P27` — InvalidTimestamp proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P28` — WrongGenesis proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P29` — ForgedInboundMessageBlock proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P30` — DisputeNotLatestState proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P31` — DisputeInvalidOutputState proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P32` — DisputeInvalidStateProof proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P33` — DisputeInvalidBalanceInvariant proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P34` — DisputeOnChainSlashesNotSubset proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P35` — TimeoutThreshold proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P36` — TimeoutCalldataPosted proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P37` — TimeoutNotLinkedToLatestState proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P38` — TimeoutParticipantNotNext proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P39` — TimeoutTooEarly proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P40` — DisputeInvalidBlockInStateProofApplyFraudProof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P41` — DisputeLastMilestoneNotFinalAndNoAuditingData proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P42` — InvalidDisputeReason proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P43` — DisputeStateProofHeaderMismatch proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P44` — DisputeInboundHashNotInChain proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P45` — DisputeInvalidBlockStructure proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P46` — DisputeBlockAuthorNotParticipant proof
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P47` — primitive EVM result
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P48` — dynamic-array EVM result
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P49` — named-tuple EVM result
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P50` — invalid forced object conversion
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P51` — recursive nested Result conversion
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P52` — contextual bigint-safe encode error
- [x] `UNIT-TEST-CODEC-1-HFAA3B.P53` — unmapped encode/decode type rejection

## UNIT-TEST-CODEC-2-8VTG2N

EVM decode failures

- Setup: Decode malformed return bytes and an invalid ABI type through `decodeEvmResult`
- Oracle: Both inputs throw; neither yields a partial decoded value

- [x] `UNIT-TEST-CODEC-2-8VTG2N.P1` — malformed EVM bytes and ABI schema rejection
