# ValidationService.test.ts

Test file: [test/stateManager/ValidationService.test.ts](../../../../../../test/stateManager/ValidationService.test.ts)
Exercises: [ValidationService.ts](../../../../implementation/source/src/stateManager/ingest/ValidationService.ts.md)

## Overview

One long case dissects a single `ValidationService` predicate — the
`blockAuthorIsNotParticipant` author gate — on a live four-peer session, through worker-realm
harness stubs (`probeAuthorGate*`) whose oracle is whether the gate name comes back as the
failing check. It binds the gate to its snapshot anchors: an author in the previous snapshot or
in a resulting snapshot coordinate-matched to the block passes; stale-height, wrong-fork, and
author-excluding snapshots reject; a missing declared snapshot falls back to the previous
snapshot; and with no local anchor at all the on-chain current+pending participant union decides
— proven with a real pending joiner that only the pending half of the union can admit. The other
validation predicates, conflict classification, and time logic are out of scope (owned by
`test/unit/ValidationService.test.ts`); since this file exercises one predicate of the service's
bundled predicate-chain permutations, none of them can be fully assigned here.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

## Tests

- `binds the author to the previous snapshot and to a coordinate-matched resulting snapshot`: UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P20
