# SnapshotAssemblyService.ts

> **Source:** [src/stateManager/block/SnapshotAssemblyService.ts](../../../../../../../src/stateManager/block/SnapshotAssemblyService.ts)

## Requirements

- [`REQ-SP-9-RNXP56` (Both synchronization and dispute audit try the peer's latest finalized state,…)](../../../../../specification/disputes/state-proofs.md#req-sp-9-rnxp56)
- [`REQ-SM-12-J6QD9B` (Every chain-accepted inbound message MUST be processed successfully)](../../../../../specification/protocol-model/state-machines.md#req-sm-12-j6qd9b)
  Missing: `assembleFromTransaction` throws on any inbound failure and does not tell an out-of-gas failure apart from a refusal; tracked by [`FIND-INBOUND-GAS-1-2BZ8DE`](../../../../../audit/open-findings.md#find-inbound-gas-1-2bz8de).

## UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7

Snapshot assembly

- Setup: Drive `createStateSnapshot`, `getPreviousStateSnapshotOrThrow`, and `assembleFromTransaction` host-side on live channels with real storage and state machine
- Oracle: Decoded snapshot fields, heights, hashes, and participant changes match the consumed blocks; refusals are reported, never hidden

- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P1` — carry-forward with no inbound or outbound block
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P2` — a real leave advances the outbound height and total withdrawals
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P3` — a real join binds the consumed inbound hash, height, and total deposits
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P4` — an unknown fork throws instead of assembling
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P5` — the writer's real transaction yields the next-height snapshot binding the post-inbound state with no participant changes
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P6` — own turn succeeds with a new state hash and another peer's header returns `success: false`
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P7` — a transaction the state machine refuses returns `success: false` with nothing else computed
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P8` — supplied pending inbound blocks are bound by head and deposits
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P9` — a leave names the leaver in `participantChanges.left` and builds an outbound block
- [x] `UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P10` — an inbound block the state machine cannot process makes the assembly throw
