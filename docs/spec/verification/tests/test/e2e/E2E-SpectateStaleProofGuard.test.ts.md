# E2E-SpectateStaleProofGuard.test.ts

Test file: [test/e2e/E2E-SpectateStaleProofGuard.test.ts](../../../../../../test/e2e/E2E-SpectateStaleProofGuard.test.ts)

## Overview

The suite forces the requester-side sync verification chain to abort by stubbing responders
through the harness RPC-stub layer: both participants answer spectate requests with a real proof
captured before chain progress, then served after the on-chain snapshot advances, or with bytes that are not a decodable
`SyncPayload`. A joining spectator then never reaches SYNCED inside its `addSpectatorWait`
timeout, and the oracle is the fail-closed fresh-spectator consequence: the join throws and the
spectator ends with zero open connections after every attempt aborted. The third test drives the
same stale-proof bound from a PARTICIPATING requester via real `startSync` RPC with the responder serving a payload captured before chain progress and asserts the
participant-role consequence instead — the responder is blacklisted while the requester node keeps
running. Out of scope: forging individual proof elements and the responder-side proving logic
(exercised in the spectate service suites). The former step-and-role bundles have been atomized
into one-scenario IDs, so each test now carries the per-step, per-role permutations it forces —
decode failure and the stale short-circuit for both requester roles — alongside the repeated-abort
cleanliness permutation.

## Tests

- `aborts sync when on-chain snapshot is more advanced than what participant proved`: INV-SYNC-3-A7A2ED.T1.P2, INV-SYNC-3-A7A2ED.T1.P13, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P3, REQ-MSG-9-BFN9P5.T1.P3
- `aborts sync when a peer answers with undecodable junk bytes`: INV-SYNC-3-A7A2ED.T1.P1, REQ-MSG-9-BFN9P5.T1.P2
- `blacklists the responder when a participant receives a proof behind the on-chain snapshot`: INV-SYNC-3-A7A2ED.T1.P14, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P12
