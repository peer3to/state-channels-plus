# test/e2e/E2E-SpectatorStateProofPersistence.test.ts — Test Report

> **Test file:** [test/e2e/E2E-SpectatorStateProofPersistence.test.ts](../../../../../../../test/e2e/E2E-SpectatorStateProofPersistence.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Despite the filename, the file holds one long join/leave tour of a four-participant channel: two
participants leave through leave state transitions at different points, two spectators join
mid-history and sync to the moving tip, and a malicious block finally triggers a dispute that the
remaining honest participant resolves onto a reduced fork. The harness drives everything through
`MathTestSession` lifecycle, transition, join, byzantine, and dispute helpers. Oracles along the
way: participant counts that exclude spectators after each join and leave, per-peer block-height
sync assertions across the leaves, spectator `onAbort` events and OPENED status after the invalid
feed, and a fork-change assertion restricted to the honest participant. The test shows spectators
tracking live participant-set changes and failing closed on a provably invalid feed instead of
following the dispute onto the new fork. No IDs are assigned: the applicable spectator fail-closed
permutations bundle every failure step and both requester roles into one ID (`INV-SYNC-3.T1.P1`,
`REQ-MSG-9.T1.P1`), and the leave/dispute permutations have their definitive homes in the
lifecycle and dispute suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`E2E: Join/Leave Sequence > join/leave sequence and fork resolution`](../../../../../../../test/e2e/E2E-SpectatorStateProofPersistence.test.ts#L6) (line 6) | —      |
