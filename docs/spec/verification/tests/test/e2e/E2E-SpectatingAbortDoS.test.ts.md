# E2E-SpectatingAbortDoS.test.ts

Test file: [test/e2e/E2E-SpectatingAbortDoS.test.ts](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts)

## Overview

A DoS-resistance suite for the spectating/pending-joiner validation context: a non-participant
that feeds a spectator a block it must reject has to be dropped and blacklisted, and must never be
able to abort the victim. The tests stage live channels through the `MathTestSession` harness, add
spectator victims and non-participant attackers, craft junk, outsider-authored, and
stale-membership block confirmations with the byzantine helpers, and deliver them over real
transports via `sendBlockConfirmation`. Both rejection paths are exercised: synchronous ingest
rejection of unauthenticated junk, and queued rejection of an authenticated outsider-authored
block when `executeQueuedEntry` runs `onBlockConfirmation` on the live queue — the vector that
used to abort the spectator. One test separates supplier from author (relayed outsider block) and
asserts both are cut; the last test repeats the stale-membership attack against an active
participant. Oracles are `peerBlacklistedAndDisconnected` plus the victim's preserved status
(SYNCED, PENDING_PARTICIPANT, or PARTICIPATING), and for the participant variant additionally no
dispute and continued honest-peer sync. The former deviation/context/hook bundles have been atomized into
one-scenario IDs, so the ingest-rejection, live-queue, and supplier-vs-author tests now carry the
per-hook and per-context permutations they drive.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.
The pending-participant victim case keeps a spawn-only attacker (`addSpectator`) on purpose: the fork is idle by design under its long chain-fallback window, and a keep-alive block would promote the pending victim.

## Tests

- `cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P1
- `cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running`: none
- `cuts the sender of an authenticated outsider-authored block over the live queue and keeps a SYNCED spectator running`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P7, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P9
- `cuts both an eligible relayer and the outsider author while the victim keeps spectating`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P21
- `cuts an ex-member that authors a linked block naming a stale membership snapshot, keeping the spectator SYNCED`: none
- `cuts an ex-member's stale-membership block, stays PARTICIPATING, starts no dispute`: none
