# ReductionManager.test.ts

Test file: [test/stateManager/ReductionManager.test.ts](../../../../../../test/stateManager/ReductionManager.test.ts)
Exercises: [ReductionManager.ts](../../../../implementation/source/src/stateManager/reduction/ReductionManager.ts.md)

## Overview

The candidate-computation disposal case releases its held call with an undefined
result after cancellation, then waits for the observed attempt to drain. It does
not start a new provider read after disposal. The no-persistence and no-installation
assertions remain unchanged.

The suite drives `ReductionManager.tryReduce` on real peers via `execOnHost`, staging live
channels, byzantine invalid-transition blocks, and fully resolved final disputes through the
harness. The oracles observe the returned reduction outcome, `hasOperation` retention, spy
counters on record-only wrappers around the manager's chain queries (`isForkDisputed`,
`isKillPeriodExpired`), and the peer's `onSetState` event count. The cases assert: a
non-disputed fork returns `undefined` without retaining an operation; the future-timer state
stays independent of reduction completion; duplicate terminal triggers reuse one resolved
outcome without re-installing state; the dispute status is checked exactly once before reduction
starts; and concurrent ordinary reduction attempts are serialized (one active chain probe, the
second attempt deferred). The `terminal disposal` block disposes the peer's state manager through the
harness at each reduction stage (attempt held, candidate computation held, direct completion waiting for the
state mutex, genesis application held at each of the three state-machine calls) and asserts, while the hold is still closed, that the caller's attempt settled as cancelled and no outbound
block, head move, fork change, status change, or installation happened; two cases make a read reject after the
canonical `setState` and assert the state manager aborts without committing; one holds the submission's gas-limit read after the local install and proves disposal stops the chain write; one makes that released read fail after the host is fully torn down and proves the failure ends as the disposal outcome (no chain write, no detached error; the runtime-level detached-settlement permutation is owned by the `RuntimeLifecycle` suite); one makes the candidate computation throw and proves the caller's promise rejects once with that error while the runtime aborts; two release a held dispute read or candidate computation as unavailable after disposal and prove no reduction timer is added. The `reduction application control boundary` block sends crafted JSON controls through the control port and proves they are rejected before any wrapper is installed; those tests carry no ID because the control is harness-only. Reduction computation itself (successor equivalence across orders) and
completion-mismatch handling are out of scope. The duplicate-terminal-trigger case demonstrates
the manager's single-completion convergence permutation; the mismatch-fatal and restart
permutations, and the executor's convergence-classification permutations, are not demonstrated
here and stay unassigned.

The live-sync cases settle the old fork's pending callers without an outcome, preserve an already
completed reduction result, and resume held reads without obsolete writes or timers. The chain-event
case also observes cancellation of the old timer, the sync installation's leave follow-up, and completion
of later old-fork event delivery.

Terminal-disposal cases share the existing single-disputer staging: one real committed dispute supplies reduction input while unrelated sibling submissions are suppressed. Their cancellation, persistence and installation assertions are unchanged.

The SYNCED-leaver case also uses one real disputer: the leaver itself. It checks
that this peer retained its successful dispute marker and that the reducing peer
observed the commitment. After leave completion it waits for the reduction attempt
to settle before recording membership reads. The zero-read and zero-submission
oracles remain unchanged; sibling uploads cannot exhaust the evidence window first.

The post-install disposal case waits for the held gas-limit read and then the
detached caller's settled outcome before disposal. Reaching the hold alone does
not prove that the result callback has run. The existing no-chain-write oracle
and permutation assignments are unchanged.

The submission-disposal cases hold the completed real gas-limit read until disposal, then release its result into the production disposal check. They do not start a provider read after the provider has closed. The no-write case waits for detached work to settle and rejects any detached failure instead of relying on a fixed sleep.

## Tests

- `direct completion returns false and removes the operation when the fork changes inside its mutex wait`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P11
- `a leaving signer that becomes SYNCED during installation skips reduction submission`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P13
- `a live fork switch after a held dispute read reschedules no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P10
- `a live fork switch after an unavailable candidate reschedules no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P11
- `a live fork switch during candidate computation persists no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P12
- `a live sync during the admission read does not recreate the old operation`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P11, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P9
- `a reduced-result chain event after live sync finishes without an obsolete operation`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P10, REQ-DISPUTE-PIPE-4-3YVDSA.T1.P12, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P8, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P10
- `disposed reduction manager refuses a new attempt without retaining a completion`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P12
- `disposed reduction manager refuses direct genesis completion without retaining it`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P13
- `returns undefined without retaining an operation for a non-disputed fork`: none
- `keeps future timer state independent from reduction completion`: none
- `reuses one resolved outcome for duplicate terminal triggers`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P1
- `checks the dispute status before starting reduction`: none
- `serializes concurrent ordinary reduction attempts`: none
- `disposal after the completion exists settles the attempt as undefined and installs nothing`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P4, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P6, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P11, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P20
- `disposal during candidate computation persists no outbound block and installs nothing`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P6, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P12
- `disposal while a direct completion waits for the state mutex installs nothing`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P5, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P13
- `disposal held at setState during genesis application commits nothing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P4, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P14
- `disposal held at getParticipants during genesis application commits nothing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P5, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P15
- `disposal held at getNextToWrite during genesis application commits nothing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P6, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P16
- `a getParticipants failure after the canonical setState aborts without committing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P7, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P17
- `a getNextToWrite failure after the canonical setState aborts without committing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P8, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P18
- `disposal after the local install and before the chain write submits nothing`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P7, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P22
- `a chain-write read that fails after the runtime is torn down is dropped as the disposal outcome`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P14
- `an ordinary attempt that completes a window the chain already finalized converges without a chain write`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9
- `a fatal attempt error rejects the caller once with the original error and aborts`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P7, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P21
- `a stale dispute read after disposal reschedules nothing`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P8, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P23
- `a stale candidate computation after disposal reschedules nothing`: REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P24
- `rejects a reject outcome at setState without installing a wrapper`: none
- `rejects an unknown location without installing a wrapper`: none
- `rejects an unknown outcome and extra keys without installing a wrapper`: none
