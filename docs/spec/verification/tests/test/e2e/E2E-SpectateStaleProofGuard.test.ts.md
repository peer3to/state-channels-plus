# test/e2e/E2E-SpectateStaleProofGuard.test.ts — Test Report

> **Test file:** [test/e2e/E2E-SpectateStaleProofGuard.test.ts](../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts) > **Status:** Authored — engineer verification pending.

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
(exercised in the spectate service suites). The former step-and-role bundles have been atomized
into one-scenario IDs, so each test now carries the per-step, per-role permutations it forces —
decode failure and the stale short-circuit for both requester roles — alongside the repeated-abort
cleanliness permutation.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Spectate stale-proof guard > aborts sync when on-chain snapshot is more advanced than what participant proved`](../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L7) (line 7)             | [`INV-SYNC-3-A7A2ED.T1.P2`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p2), [`INV-SYNC-3-A7A2ED.T1.P13`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p13), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P3`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p3), [`INV-SPC-1-ZV8QM5.T1.P3`](../../../../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-1-zv8qm5.t1.p3), [`INV-SPC-4-WVXS19.T1.P4`](../../../../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-4-wvxs19.t1.p4), [`REQ-MSG-9-BFN9P5.T1.P3`](../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5.t1.p3) |
| [`E2E: Spectate stale-proof guard > aborts sync when a peer answers with undecodable junk bytes`](../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L51) (line 51)                                | [`INV-SYNC-3-A7A2ED.T1.P1`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p1), [`INV-SPC-4-WVXS19.T1.P3`](../../../../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-4-wvxs19.t1.p3), [`REQ-MSG-9-BFN9P5.T1.P2`](../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5.t1.p2)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [`E2E: Spectate stale-proof guard > blacklists the responder when a participant requests a target behind the on-chain snapshot`](../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts#L93) (line 93) | [`INV-SYNC-3-A7A2ED.T1.P14`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p14), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P12`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
