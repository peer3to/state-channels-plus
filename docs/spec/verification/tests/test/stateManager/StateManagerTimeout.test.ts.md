# StateManagerTimeout.test.ts

Test file: [test/stateManager/StateManagerTimeout.test.ts](../../../../../../test/stateManager/StateManagerTimeout.test.ts)
Exercises: [StateManager.ts](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The suite drives `StateManager` timeout scheduling through the full harness runtime: it stages a
pre-dispute setup with a short `evidenceTime`, marks a peer AFK, posts a valid self-removal dispute from
another peer, and waits until the dispute is committed on chain. The oracle is the window-age
guard on timeout submission: because the committed dispute window predates the timeout's
deadline, the observing peer must not submit a timeout — after sleeping almost the whole evidence
window, `getTimeout` for the active fork still returns `null` via the harness query. Due-time
computation, forced-versus-normal timeout selection, and the other scheduling branches are out of
scope here; the single case isolates the early-window rejection.

## Tests

- `does not submit a timeout when the existing dispute window predates its deadline`: UNIT-TEST-STATE-MANAGER-3-32QM46.P4
