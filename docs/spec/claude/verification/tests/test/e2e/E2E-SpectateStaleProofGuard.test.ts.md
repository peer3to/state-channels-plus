# test/e2e/E2E-SpectateStaleProofGuard.test.ts — Test Report

> **Test file:** [test/e2e/E2E-SpectateStaleProofGuard.test.ts](../../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite forces the requester-side sync verification chain to abort by stubbing responders
through the harness RPC-stub layer: both participants answer spectate requests with a proof
pinned to a height behind the posted on-chain snapshot, or with bytes that are not a decodable
`SyncPayload`. A joining spectator then never reaches SYNCED inside its `addSpectatorWait`
timeout, and the oracle is the fail-closed fresh-spectator consequence: the join throws and the
spectator ends with zero open connections after every attempt aborted. The third test drives the
same stale-proof bound from a PARTICIPATING requester via `startSync` and asserts the
participant-role consequence instead — the responder is blacklisted while the requester node keeps
running. Out of scope: forging individual proof elements and the responder-side proving logic
(exercised in the spectate service suites). Most applicable permutations bundle every verification
step or both requester roles into one ID (`INV-SYNC-3.T1.P1`, `UNIT-TEST-SPECTATE-SERVICE-1.P1`/`P3`),
so only the repeated-abort cleanliness permutation is assigned here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                  | Covers                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`E2E: Spectate stale-proof guard > aborts sync when on-chain snapshot is more advanced than what participant proved`](../../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L7) (line 7)             | [`INV-SYNC-3.T1.P2`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-t1-p2) |
| [`E2E: Spectate stale-proof guard > aborts sync when a peer answers with undecodable junk bytes`](../../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L51) (line 51)                                | —                                                                                                      |
| [`E2E: Spectate stale-proof guard > blacklists the responder when a participant requests a target behind the on-chain snapshot`](../../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L93) (line 93) | —                                                                                                      |
