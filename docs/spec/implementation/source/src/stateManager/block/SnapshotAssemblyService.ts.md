# SnapshotAssemblyService.ts

> **Source:** [src/stateManager/block/SnapshotAssemblyService.ts](../../../../../../../src/stateManager/block/SnapshotAssemblyService.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

No specified behavior: Assembles the next state snapshot for a transaction: carries the previous snapshot forward, binds consumed inbound blocks (hash, height, deposits), builds the outbound block for a leave (height, withdrawals, `participantChanges`), and reports the writer-turn and state-machine refusals as `success: false` or a throw.

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
