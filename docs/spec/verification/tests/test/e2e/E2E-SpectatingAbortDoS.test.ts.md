# E2E-SpectatingAbortDoS.test.ts

Test file: [test/e2e/E2E-SpectatingAbortDoS.test.ts](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts)

## Overview

A DoS-resistance suite for the spectating/pending-joiner validation context: a non-participant
that feeds a spectator a block it must reject has to be dropped, and must never be able to abort
the victim. The tests stage live channels through the `MathTestSession` harness, add spectator
victims and non-participant attackers, craft junk, outsider-authored, and stale-membership block
confirmations with the byzantine helpers, and deliver them over real transports via
`sendBlockConfirmation`. Unauthenticated junk is rejected synchronously in ingest and blacklists
its sender. An authenticated block from an absent sender (an outsider or an ex-member) triggers
the admission sync; the sender cannot prove the block it sent, so the failed sync is one counted
close of the sender and no blacklist. One test separates supplier from author: an eligible
relayer delivers an outsider-authored block, which reaches `blockAuthorIsNotParticipant` on the
live queue, and both are cut. The last test repeats the stale-membership attack against an active
participant. Oracles are `peerBlacklistedAndDisconnected` for the junk and live-queue cases,
`peerStruckWithoutBlacklist` with a dropped connection for the failed admission syncs, plus the
victim's preserved status (SYNCED, PENDING_PARTICIPANT, or PARTICIPATING), and for the participant
variant additionally no dispute and continued honest-peer sync. The former
deviation/context/hook bundles have been atomized into one-scenario IDs.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.
The pending-participant victim case keeps a spawn-only attacker (`addSpectator`) on purpose: the fork is idle by design under its long chain-fallback window, and a keep-alive block would promote the pending victim.

## Tests

- `cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P1
- `cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running`: none
- `cuts the sender of an authenticated outsider-authored block it cannot prove with a counted close and keeps a SYNCED spectator running`: REQ-GOSSIP-4-J5Z4DF.T1.P49
- `cuts both an eligible relayer and the outsider author while the victim keeps spectating`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P7, UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P9, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P21
- `cuts an ex-member that authors a linked block naming a stale membership snapshot, keeping the spectator SYNCED`: REQ-GOSSIP-4-J5Z4DF.T1.P50
- `cuts an ex-member's stale-membership block, stays PARTICIPATING, starts no dispute`: REQ-GOSSIP-4-J5Z4DF.T1.P51
