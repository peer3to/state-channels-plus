# JoinActions.test.ts

Test file: [test/harness/JoinActions.test.ts](../../../../../../test/harness/JoinActions.test.ts)
Exercises: the harness helper [test/harness/actions/JoinActions.ts](../../../../../../test/harness/actions/JoinActions.ts) (`addSpectatorAuthoring`); harness code has no source report.

## Overview

The suite proves the contract of the shared spectator spawn helper that every migrated test relies
on: the spawn (peer creation, `beforeConnect` staging, connection dispatch, sync) runs as one
unawaited chain while the named participants keep authoring blocks, so a spawn never sits inside
an idle authoring window. Each phase failure is rethrown unchanged with no bound error masking it;
a gated `beforeConnect` keeps blocks flowing and dispatches the connection only after it releases;
the minimum block count is authored even when the spectator syncs faster than that; a
`beforeConnect` stub is installed before the first real sync request runs (proved by a
`recordSpectateSync` counter that is zero at staging time); and a spawn-only call with the
participants' sync suppressed leaves the spectator `OPENED` while the fork keeps moving. Oracles
are the helper's result (`blocksAuthored`, `height`), peer status through the control port, and the
error identity of rethrown failures. The helper is harness code, so no unit or integration test ID
family exists for it and every row stays unassigned.

## Tests

- `rethrows a peer-creation failure unchanged and authors nothing after it`: none
- `rethrows a beforeConnect failure unchanged without dispatching the connection`: none
- `rethrows a connection-dispatch failure unchanged and reports no bound error`: none
- `keeps authoring while beforeConnect is pending and dispatches only after it releases`: none
- `authors the minimum even when the spectator spawns and syncs fast`: none
- `installs a beforeConnect stub before the first real sync request runs`: none
- `spawn-only keeps blocks flowing and leaves the spectator OPENED`: none
- `JoinActions spectator spawn helper > counts a slow authoring completion inside the next keep-alive window`: none
