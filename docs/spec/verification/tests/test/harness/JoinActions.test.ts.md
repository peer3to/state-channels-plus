# test/harness/JoinActions.test.ts — Test Report

> **Test file:** [test/harness/JoinActions.test.ts](../../../../../../test/harness/JoinActions.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** the harness helper [test/harness/actions/JoinActions.ts](../../../../../../test/harness/actions/JoinActions.ts) (`addSpectatorAuthoring`); harness code has no source report.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`JoinActions spectator spawn helper > rethrows a peer-creation failure unchanged and authors nothing after it`](../../../../../../test/harness/JoinActions.test.ts#L11) (line 11)              | —      |
| [`JoinActions spectator spawn helper > rethrows a beforeConnect failure unchanged without dispatching the connection`](../../../../../../test/harness/JoinActions.test.ts#L30) (line 30)        | —      |
| [`JoinActions spectator spawn helper > rethrows a connection-dispatch failure unchanged and reports no bound error`](../../../../../../test/harness/JoinActions.test.ts#L57) (line 57)          | —      |
| [`JoinActions spectator spawn helper > keeps authoring while beforeConnect is pending and dispatches only after it releases`](../../../../../../test/harness/JoinActions.test.ts#L75) (line 75) | —      |
| [`JoinActions spectator spawn helper > authors the minimum even when the spectator spawns and syncs fast`](../../../../../../test/harness/JoinActions.test.ts#L112) (line 112)                  | —      |
| [`JoinActions spectator spawn helper > installs a beforeConnect stub before the first real sync request runs`](../../../../../../test/harness/JoinActions.test.ts#L131) (line 131)              | —      |
| [`JoinActions spectator spawn helper > spawn-only keeps blocks flowing and leaves the spectator OPENED`](../../../../../../test/harness/JoinActions.test.ts#L157) (line 157)                    | —      |
