# ReductionExecutor.ts

> **Source:** [src/stateManager/reduction/ReductionExecutor.ts](../../../../../../../src/stateManager/reduction/ReductionExecutor.ts)

## Requirements

- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-ENFSNAP-4-ESP98F` (Disputed-fork advance rule)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-4-esp98f)
- [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
- [`REQ-DVP-2-RG8QR3` (Reducer reads event-synchronized windows)](../../../../../specification/disputes/dispute-processing.md#req-dvp-2-rg8qr3)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-SDK-ARCH-5-AAM7YK` (Chain submissions survive concurrent inclusion)](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk)

## UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37

Attempt discipline

- Setup: Race concurrent reducers; drop events then recover; stage a spectator cut off before the window's reduced head, before and after the chain records the window's result, with the recorded reducer, only another peer, only a peer behind the same head, or no peer connected, and after a second reduction moved the chain snapshot past the successor; fail the provider; supersede with a final dispute; hold the fork adoption post while the successor is disputed, a later reduction becomes final, or a leaver's post of a reduced fork with no participant closes the channel; drop a leaving member to SYNCED during its install
- Oracle: Convergence classified; unsynchronized windows never reduce; a reducer behind the reduced head defers, never aborts, retries while the chain has no result, and once it has one syncs the latest state once (reducer first, else a connected peer), naming no fork, with no further attempt unless that sync leaves it on the window's fork; provider failure fatal; supersession stands down; a settled adoption refusal is neither retried nor reported; a member that left during its install sends no reduction

- [ ] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P1` — concurrent convergence
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2` — event recovery before reduce
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3` — empty window escalates
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P4` — superseded stand-down
- [ ] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P5` — provider failure fatal
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P6` — disposal during candidate computation leaves the outbound map and head unchanged and installs nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P8` — a stale synced dispute read after disposal reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9` — an ordinary attempt whose result the chain already records (a final dispute finalized the window) completes locally and submits no chain write; the chain snapshot stays where it was until a snapshot post walks the fork
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P10` — a held dispute read returning no data after live sync changes the fork reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P11` — a held candidate computation returning no candidate after live sync reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P12` — a held real candidate computation resumed after live sync persists and submits nothing obsolete
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P13` — a leaving signer that another peer's chain adoption drops to SYNCED during installation completes the local install and sends no reduction transaction
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P17` — the reduce is sent as its own transaction and a failed adopt-only post is retried once, after which the chain holds the reduced fork
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P18` — when the retry fails too there is no third attempt: the failure surfaces as a detached error, the reduce stays recorded and the chain keeps its fork
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P19` — the first reduce is mined and reverts out of gas, the EVM error handler resends it and the resend is mined: the chain adopts the reduced fork and no detached error is reported
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P20` — the runtime stops while the reduce send is held after the local install, with the teardown parked before the chain provider closes: disposal does not intercept the started send, the reduce goes out once, and its detached submission settles with no rejection and no reported failure
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P21` — an adopt-only post prepared against the successor and sent after a later reduction of the successor became final reverts with `RaceConditionSnapshotUpdateNotLatestFork`; the refusal is settled: no detached failure, no retry, no further adoption post, and the chain snapshot stays where it was
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P22` — an adopt-only post prepared against the successor and sent after the successor's dispute opened reverts with `RaceConditionSnapshotUpdateDisputedFork`; the refusal is settled: no detached failure, no retry, no further adoption post, and the chain snapshot stays where it was
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P23` — an adopt-only post of a reduced fork with no participant, prepared and held at its send while a leaver's post of that fork closes the channel, reverts with `RaceConditionGenesisTimestampNotAvailable`; the refusal is settled: no detached failure and no retry
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P24` — a spectator behind the window's reduced head, while the chain records no result for the window, defers its reduction and reschedules it after `chainFallbackTime`; it keeps its status and does not abort
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P25` — another reducer's committed reduction while this spectator does not hold the reduced head is not challenged and does not throw
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P26` — behind the reduced head after the chain records the result, with every survivor connected: one attempt syncs the latest state from the recorded reducer, installs the successor and schedules no further attempt
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P27` — behind the reduced head after the chain records the result, with only a peer other than the reducer connected: the attempt syncs the latest state from that peer
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P28` — behind the reduced head after the chain records the result, with no peer connected: the attempt syncs nothing, keeps the fork and reschedules after `chainFallbackTime`
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P29` — an unreadable dispute window while the chain records no result defers without aborting or answering with a fresh dispute, and the attempt after the window becomes readable reduces
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P30` — behind the reduced head after the chain records the result, with only another spectator behind the same head connected: the attempt syncs from it, does not throw, keeps the fork, reschedules after `chainFallbackTime`, neither side blacklists the other and the node stays SYNCED
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P31` — behind the reduced head after a second reduction of the successor moved the chain snapshot past it, with a survivor connected: one attempt installs the newest fork, neither side blacklists the other and no further attempt is scheduled
