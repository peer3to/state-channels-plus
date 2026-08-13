# test/e2e/E2E-FinalDispute.test.ts — Test Report

> **Test file:** [test/e2e/E2E-FinalDispute.test.ts](../../../../../../../test/e2e/E2E-FinalDispute.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite stages threshold-final disputes (signed by the full participant set) on a real four-peer
channel via the harness helpers `submitFinalDispute` / `submitFinalDisputeFromStoredEvidence` and
resolves them on-chain with `resolveFinalDispute`. It asserts the final-dispute fast path in the
reduction stack: the exact final output (fork id and genesis timestamp) is installed without
running `validateDispute`, a queued ordinary reduction task released afterwards is a no-op (no
second `onSetState`; the completed reduction joins the final fork), duplicate completion via
`awaitReduction` is idempotent, and a peer whose `DisputeCommitted` delivery was withheld still
lands on the exact final output during reduction. A forced failure of final-dispute output
preparation propagates as a fatal host error while the peer stays `PARTICIPATING`. Oracles are
host-side queries (fork ids, genesis timestamps, completed-reduction lookups, status), event-spy
counts, and quiesced host errors. Ordinary (non-final) reduction submission outcomes are out of
scope (`E2E-ReductionManager`, `test/stateManager/ReductionManager.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                           | Covers                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: final dispute resolution > threshold-final dispute installs its exact output and can post the next snapshot`](../../../../../../../test/e2e/E2E-FinalDispute.test.ts#L7) (line 7)   | [`REQ-ENFDIS-1.T1.P4`](../../../../specification/enforcement/dispute-window.md#req-enfdis-1-t1-p4)                                                            |
| [`E2E: final dispute resolution > threshold-final dispute makes a queued reduction timeout a no-op`](../../../../../../../test/e2e/E2E-FinalDispute.test.ts#L78) (line 78)                 | [`UNIT-TEST-REDUCTION-EXECUTOR-1.P4`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1.p4) |
| [`E2E: final dispute resolution > duplicate completion is idempotent`](../../../../../../../test/e2e/E2E-FinalDispute.test.ts#L138) (line 138)                                             | —                                                                                                                                                             |
| [`E2E: final dispute resolution > missed final-dispute delivery recovers the exact final output during reduction`](../../../../../../../test/e2e/E2E-FinalDispute.test.ts#L163) (line 163) | [`REQ-DIS-6.T1.P16`](../../../../specification/disputes/disputes.md#req-dis-6.t1.p16)                                                                         |
| [`E2E: final dispute resolution > failed final-dispute preparation propagates without abandoning participation`](../../../../../../../test/e2e/E2E-FinalDispute.test.ts#L212) (line 212)   | [`REQ-DIS-6.T1.P15`](../../../../specification/disputes/disputes.md#req-dis-6.t1.p15)                                                                         |
