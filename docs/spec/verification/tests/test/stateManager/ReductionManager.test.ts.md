# ReductionManager.test.ts

Test file: [test/stateManager/ReductionManager.test.ts](../../../../../../test/stateManager/ReductionManager.test.ts)
Exercises: [ReductionManager.ts](../../../../implementation/source/src/stateManager/reduction/ReductionManager.ts.md)

## Overview

The suite drives `ReductionManager.tryReduce` on real peers via `execOnHost`, staging live
channels, byzantine invalid-transition blocks, and fully resolved final disputes through the
harness. The oracles observe the returned reduction outcome, `hasOperation` retention, spy
counters on record-only wrappers around the manager's chain queries (`isForkDisputed`,
`isKillPeriodExpired`), and the peer's `onSetState` event count. The cases assert: a
non-disputed fork returns `undefined` without retaining an operation; the future-timer state
stays independent of reduction completion; duplicate terminal triggers reuse one resolved
outcome without re-installing state; the dispute status is checked exactly once before reduction
starts; and concurrent ordinary reduction attempts are serialized (one active chain probe, the
second attempt deferred). The `terminal disposal` block aborts the peer through the harness while its
reduction is held (at the attempt, or at the genesis application's `setState`), releases the hold after
the disposal cut-off and proves, by the peer's chain nonce one second later, that the attempt sent no
transaction; two cases make a read reject after the canonical `setState` and assert the state manager
aborts without committing and the caller sees no rejection; one holds the reduce send after the local install, aborts the runtime while it is held and proves the send released after the cut-off never settles and reports no failure; one makes the candidate computation throw and proves the caller's promise rejects once with that error while the runtime aborts. The `reduction application control boundary` block sends crafted JSON controls through the control port and proves they are rejected before any wrapper is installed; those tests carry no ID because the control is harness-only. Reduction computation itself (successor equivalence across orders) and
completion-mismatch handling are out of scope. The duplicate-terminal-trigger case demonstrates
the manager's single-completion convergence permutation; the mismatch-fatal and restart
permutations, and the executor's convergence-classification permutations, are not demonstrated
here and stay unassigned.

The live-sync cases settle the old fork's pending callers without an outcome, preserve an already
completed reduction result, and resume held reads without obsolete writes or timers. The chain-event
case also observes cancellation of the old timer, the sync installation's leave follow-up, and completion
of later old-fork event delivery.

Terminal-disposal cases share the existing single-disputer staging: one real committed dispute supplies reduction input while unrelated sibling submissions are suppressed.

The SYNCED-leaver case also uses one real disputer: the leaver itself. It checks
that this peer retained its successful dispute marker and that the reducing peer
observed the commitment. After leave completion it waits for the reduction attempt
to settle and asserts its own attempt resolved with the reduced fork the chain records,
so the local install completed although peer 0's adoption dropped the leaver to SYNCED
during it. It then records membership reads. The zero-read oracle and the zero-submission
oracle (no reduce entered the held send and the leaver sent no multicall at all) remain;
sibling uploads cannot exhaust the evidence window first.

The held-send disposal case (staging in `test/fixtures/ReductionDisposalStaging.ts`) holds the reduce
send after the local install, aborts the runtime with its disposal held and then releases the send:
the peer's chain nonce is unchanged.

## Tests

- `direct completion returns false and removes the operation when the fork changes inside its mutex wait`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P11
- `a leaving signer that becomes SYNCED during installation skips reduction submission`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P13
- `a live fork switch after a held dispute read reschedules no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P10
- `a live fork switch after an unavailable candidate reschedules no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P11
- `a live fork switch during candidate computation persists no old-fork work`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P12
- `a live sync during the admission read does not recreate the old operation`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P11, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P9
- `a reduced-result chain event after live sync finishes without an obsolete operation`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P10, REQ-DISPUTE-PIPE-4-3YVDSA.T1.P12, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P8, UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P10
- `returns undefined without retaining an operation for a non-disputed fork`: none
- `keeps future timer state independent from reduction completion`: none
- `reuses one resolved outcome for duplicate terminal triggers`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P1
- `checks the dispute status before starting reduction`: none
- `serializes concurrent ordinary reduction attempts`: none
- `an abort while a reduction attempt is held sends no transaction once the attempt is released`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P14, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P26
- `an abort while the reduction genesis application is held at setState sends no transaction once it is released`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P15, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P27
- `a getParticipants failure after the canonical setState aborts without committing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P7, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P17
- `a getNextToWrite failure after the canonical setState aborts without committing`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P8, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P18
- `an ordinary attempt that completes a window the chain already finalized converges without a chain write`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P9
- `a fatal attempt error rejects the caller once with the original error and aborts`: UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P7, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P21
- `rejects a reject outcome at setState without installing a wrapper`: none
- `rejects an unknown location without installing a wrapper`: none
- `rejects an unknown outcome and extra keys without installing a wrapper`: none
- `an abort while the reduce send is held after the local install sends no transaction once the send is released`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P20, REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P25
