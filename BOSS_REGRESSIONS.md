# Tests broken by PR 339 (pre-339 PASS -> 339+ FAIL)

Tracks tests that worked before boss's PR 339 but stopped after.

Sweep modes:

- **pre-339 inline**: worktree `/tmp/scp-pre` @ `03e3930f`
- **PR 339 inline**: worktree `/tmp/scp-pr339` @ `77bd0b14`
- **HEAD inline**: main checkout @ `80fee8fe`

A test is a boss regression if pre-339 PASS but (339 FAIL OR HEAD-inline FAIL).

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
