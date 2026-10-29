# E2E-SpectatorStateProofPersistence.test.ts

Test file: [test/e2e/E2E-SpectatorStateProofPersistence.test.ts](../../../../../../test/e2e/E2E-SpectatorStateProofPersistence.test.ts)

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
following the dispute onto the new fork. The spectator fail-closed permutations have been atomized into
one-scenario IDs, so the adversarial-feed abort now carries its own assignments; the leave/dispute
permutations keep their definitive homes in the lifecycle and dispute suites.
Both spectator spawns run through the shared `addSpectatorAuthoring` helper: the remaining participants author at
least the scripted blocks and keep the writer slot alive until the spectator is synced, so the next leave never
follows an idle window.

## Tests

- `join/leave sequence and fork resolution`: REQ-MSG-9-BFN9P5.T1.P4
