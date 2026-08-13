# test/e2e/E2E-StateTransition.test.ts — Test Report

> **Test file:** [test/e2e/E2E-StateTransition.test.ts](../../../../../../../test/e2e/E2E-StateTransition.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Happy-path smoke suite for the core state-transition loop. It starts real 3–4 peer sessions
through the harness lifecycle, advances state through the real state-transition gossip path
(`h.transition.advanceState` by count and by full leader-rotation rounds), and asserts
convergence: all peers in sync and at the exact expected block height (n transitions after
genesis land at height n−1). The fourth test stages an invalid-state-transition dispute against a
malicious peer, resolves it on-chain, advances three more blocks on the reduced fork, and asserts
only the honest peers remain in sync — i.e. ordinary block production keeps working after fork
resolution. Oracles are the sync/height assertion helpers and dispute lifecycle waits only; the
suite inspects no queue, storage, signature, or timestamp detail. Fault classification, timing
windows, and queue behavior are out of scope (owned by the fraud-proof, timestamp-grace, and
BlockQueueManager suites). After the permutation atomization the round-robin leader-election
scenarios stand alone, so the full-rotation and post-fork-recovery tests carry their
[`REQ-FIN-6-YZWJX2.T1`](../../../../specification/protocol-model/finality.md#req-fin-6-yzwjx2.t1) scenarios; the remaining candidates (signature/authentication variants,
[`UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS`](../../../../implementation/source/src/rpc/services/stateTransition/StateTransitionService.ts.md#unit-test-state-transition-service-1-w4mkds).\*` gating) still have no dedicated demonstration here and
stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                        | Covers                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`E2E: State Transitions > Basic State Advancement > should handle consecutive blocks between participants`](../../../../../../../test/e2e/E2E-StateTransition.test.ts#L13) (line 13)   | —                                                                                                       |
| [`E2E: State Transitions > Basic State Advancement > should handle full round rotation`](../../../../../../../test/e2e/E2E-StateTransition.test.ts#L21) (line 21)                       | [`REQ-FIN-6-YZWJX2.T1.P1`](../../../../specification/protocol-model/finality.md#req-fin-6-yzwjx2.t1.p1) |
| [`E2E: State Transitions > Basic State Advancement > should handle multiple rotation rounds`](../../../../../../../test/e2e/E2E-StateTransition.test.ts#L29) (line 29)                  | —                                                                                                       |
| [`E2E: State Transitions > State Modifications > should handle honest peer transitions after fork resolution`](../../../../../../../test/e2e/E2E-StateTransition.test.ts#L39) (line 39) | [`REQ-FIN-6-YZWJX2.T1.P7`](../../../../specification/protocol-model/finality.md#req-fin-6-yzwjx2.t1.p7) |
