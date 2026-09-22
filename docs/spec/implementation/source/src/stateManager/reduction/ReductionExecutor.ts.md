# ReductionExecutor.ts

> **Source:** [src/stateManager/reduction/ReductionExecutor.ts](../../../../../../../src/stateManager/reduction/ReductionExecutor.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)

## UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37

Attempt discipline

- Setup: Race concurrent reducers; drop events then recover; fail the provider; supersede with a final dispute
- Oracle: Convergence classified; unsynchronized windows never reduce; provider failure fatal; supersession stands down

- [ ] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P1` — concurrent convergence
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2` — event recovery before reduce
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3` — empty window escalates
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P4` — superseded stand-down
- [ ] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P5` — provider failure fatal
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P6` — disposal during candidate computation leaves the outbound map and head unchanged and installs nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P7` — disposal after the local install and before the chain write submits nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P8` — a stale synced dispute read after disposal reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9` — an ordinary attempt whose result the chain already records (a final dispute finalized the window) completes locally and submits no chain write; the chain snapshot stays where it was until a snapshot post walks the fork
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P10` — a held dispute read returning no data after live sync changes the fork reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P11` — a held candidate computation returning no candidate after live sync reschedules nothing
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P12` — a held real candidate computation resumed after live sync persists and submits nothing obsolete
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P13` — a leaving signer that becomes SYNCED during installation skips reduction submission
- [x] `UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P14` — a released chain-write read that fails after the runtime is torn down ends as the disposal outcome: no chain write, no detached error
