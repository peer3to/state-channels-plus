# E2E-MirrorDivergence.test.ts

Test file: [E2E-MirrorDivergence.test.ts](../../../../../../test/e2e/E2E-MirrorDivergence.test.ts)
Exercises: [DisputeValidationService.ts.md](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

One live scenario. `stageMirrorMissingConsumedTopUp` holds the auditor's (peer 1) local-diamond
update for an inbound top-up that the channel has consumed, so the auditor's mirror lags the chain.
The channel runs with the ordinary protocol timing; instead of widening any time setting, the
staging suppresses writer-timeout disputes (`suppressWriterTimeouts`), so the idle next writer
cannot open a competing window and only the self-removal dispute is in play. Peer 2 leaves through a
self-removal dispute (its runtime's own re-upload is suppressed), and the auditor audits that honest
dispute live through the normal event path. The harness mirror service
observes the auditor's `verifyBalanceInvariantCheckSnapshot` reads record-only.

Oracles: the auditor's local answer is `false` and the chain answer is `true`; no peer observes a
`DisputeKilled` for a quiet period; the auditor stores no dispute fraud proof; nobody is slashed
on-chain. After the held update is released, the fork resolves with the remaining peers, the
channel has two participants, and the auditor is `PARTICIPATING`. This is the end-to-end form of
a lagging mirror that reports an honest dispute invalid while the chain reports it valid.

## Tests

- `an auditor whose mirror misses a consumed top-up audits an honest self-removal dispute live → the chain answers its adverse balance check, no proof, no kill, no slash, the auditor keeps participating on the reduced fork`: REQ-MIRROR-4-H9C4YS.T1.P3
