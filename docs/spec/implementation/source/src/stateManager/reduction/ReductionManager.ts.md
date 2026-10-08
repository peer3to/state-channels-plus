# ReductionManager.ts

> **Source:** [src/stateManager/reduction/ReductionManager.ts](../../../../../../../src/stateManager/reduction/ReductionManager.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
- [`REQ-DIS-6-Y92H1M` (Every initiated dispute window MUST end in a canonical successor fork, genesis…)](../../../../../specification/disputes/disputes.md#req-dis-6-y92h1m)
- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)

## UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM

Single completion

- Setup: Complete the same fork from multiple paths and with mismatched outcomes
- Oracle: One installation; later completions join; mismatch fatal; after disposal no attempt, completion, or reduction-owned write is created

- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P1` — multi-path convergence
- [ ] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P2` — mismatch fatal
- [ ] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P3` — restart effects
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P4` — disposal after the completion exists settles the attempt as `undefined` and installs nothing
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P5` — disposal while a direct `completeWithGenesis` waits for the state mutex returns `false` and installs nothing
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P6` — disposal settles the caller while the attempt is still held at its executor entry
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P7` — a fatal attempt error rejects the caller once with the original error and aborts the runtime
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P8` — live sync settles shared callers, cancels obsolete work and permits late chain-event handling
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P9` — admission read returning after sync creates no completion
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P10` — completed result survives pending-operation cleanup
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P11` — direct completion returns false and removes the operation when the fork changes inside its mutex wait
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P12` — disposed reduction manager refuses a new attempt without retaining a completion
- [x] `UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P13` — disposed reduction manager refuses direct genesis completion without retaining it
