# test/e2e/E2E-SpectatingAbortDoS.test.ts — Test Report

> **Test file:** [test/e2e/E2E-SpectatingAbortDoS.test.ts](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                 | Covers                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: spectating strategy junk-block handling > cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L21) (line 21)                                | [`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P1`](../../../../implementation/source/src/stateManager/validationStrategy/SpectatingValidationStrategy.ts.md#unit-test-spectatingvalidation-strategy-1-ctd8ah.p1)                                                                                                                                   |
| [`E2E: spectating strategy junk-block handling > cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L57) (line 57)                             | —                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: spectating strategy junk-block handling > cuts the sender of an authenticated outsider-authored block over the live queue and keeps a SYNCED spectator running`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L98) (line 98) | [`REQ-BLOCK-PIPE-3-WW2SB7.T1.P7`](../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7.t1.p7), [`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P9`](../../../../implementation/source/src/stateManager/validationStrategy/SpectatingValidationStrategy.ts.md#unit-test-spectatingvalidation-strategy-1-ctd8ah.p9) |
| [`E2E: spectating strategy junk-block handling > cuts both the relayer and the author when an outsider-authored block arrives via a different peer`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L147) (line 147)                  | [`REQ-GOSSIP-2-9PMMNH.T1.P4`](../../../../specification/peer-communication/block-gossip.md#req-gossip-2-9pmmnh.t1.p4)                                                                                                                                                                                                                                   |
| [`E2E: spectating strategy junk-block handling > cuts an ex-member that authors a linked block naming a stale membership snapshot, keeping the spectator SYNCED`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L206) (line 206)     | —                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: active-participant stale-membership handling > cuts an ex-member's stale-membership block, stays PARTICIPATING, starts no dispute`](../../../../../../test/e2e/E2E-SpectatingAbortDoS.test.ts#L260) (line 260)                            | —                                                                                                                                                                                                                                                                                                                                                       |
