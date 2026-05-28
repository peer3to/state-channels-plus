# Worker-mode regressions (HEAD-inline PASS -> HEAD-worker FAIL)

Tracks tests that pass in inline mode at current HEAD but fail in worker mode (`HARNESS_DEDICATED_PEER_THREAD=true`). These are the ones our work should fix.

HEAD: `80fee8fe` on branch `threaded-harness-on-v339`.

## Processed files

- [ ] E2E-InitHandshake.test.ts
- [ ] E2E-StateTransition.test.ts
- [ ] E2E-Timeouts.test.ts
- [ ] E2E-DisputeManager.test.ts
- [ ] E2E-Spectate.test.ts
- [ ] E2E-StateSnapshots.test.ts
- [ ] E2E-FraudProofsBlockConfirmation.test.ts
- [ ] E2E-MaliciousUpdateSnapshot.test.ts
- [ ] E2E-IsForkDisputed.test.ts
- [ ] E2E-ParticipantLifecycle.test.ts
- [ ] E2E-ForceJoinDispute.test.ts
- [ ] E2E-JoinChannelRaceConditions.test.ts
- [ ] E2E-SpectatorStateProofPersistence.test.ts
- [ ] E2E-SpectateStaleProofGuard.test.ts
- [ ] E2E-PingService.test.ts
- [ ] disputeValidation/balanceInvariant.test.ts
- [ ] disputeValidation/futureBlock.test.ts
- [ ] disputeValidation/inboundHash.test.ts
- [ ] disputeValidation/notLatestState.test.ts
- [ ] disputeValidation/outputState.test.ts
- [ ] disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts
- [ ] disputeValidation/disputeInputFields/forkId.test.ts
- [ ] disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts
- [ ] disputeValidation/disputeInputFields/onChainSlashes.test.ts
- [ ] disputeValidation/disputeInputFields/selfRemoval.test.ts
- [ ] disputeValidation/disputeInputFields/timeout.test.ts
- [ ] disputeValidation/stateProof/case1_inboundDivergence.test.ts
- [ ] disputeValidation/stateProof/case2_empty.test.ts
- [ ] disputeValidation/stateProof/case3_signedBlocksOnly.test.ts
- [ ] disputeValidation/stateProof/case4_blockInjection.test.ts
- [ ] disputeValidation/stateProof/case5_lastMilestoneFinalityAndAuditingData.test.ts
- [ ] disputeValidation/stateProof/case5_milestoneBlockContent.test.ts
- [ ] disputeValidation/stateProof/case5_structuralRules.test.ts
- [ ] disputeValidation/uploadRevert/channelId.test.ts
- [ ] disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts
- [ ] disputeValidation/uploadRevert/disputer.test.ts
- [ ] disputeValidation/uploadRevert/disputerThrottle.test.ts
- [ ] disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts

---
