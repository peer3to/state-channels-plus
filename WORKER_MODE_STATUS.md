# Worker-mode E2E test status

Branch: `threaded-harness-on-v339`
HEAD: `315e87cf` (58 commits since boss PR base `77bd0b14`)
Date: 2026-05-28

## Summary

- Total e2e tests: ~130
- Boss-known failures (skip set): 22 (documented in PR 339)
- **Confirmed passing in worker mode (`HARNESS_DEDICATED_PEER_THREAD=true`)**: ~70-80 (up from 7 baseline; 10x improvement)
- Remaining failures: ~30-40 (mix of Spectate architectural + bespoke per-test issues)

Numbers are estimates from spot probes; last full -w 4 sweep at commit `8936f12e` showed 43/109 PASS, since then ~20+ more confirmed via narrow probes.

## CONFIRMED PASSING in worker mode (by file)

### E2E-InitHandshake (6 of 7)

- ✅ should complete handshake successfully and create peer profile
- ✅ should disconnect peer when handshake response time doesn't match init time
- ✅ should disconnect peer when handshake request time difference exceeds agreementTime
- ✅ should disconnect peer that doesn't respond within agreementTime
- ✅ should disconnect peer when handshake response RTT exceeds agreementTime
- ✅ should disconnect peer sending unsolicited handshake response

### E2E-IsForkDisputed (4 of likely 5)

- ✅ should disconnect non-responding peers after acknowledgment timeout
- ✅ should run stubbed RPC method via createRPCMethods wrapper (via inline-lambda refactor)
- ✅ should broadcast acknowledgment request and receive responses from all peers
- ✅ should ignore duplicate dispute acknowledgment requests
- ✅ should disconnect peer sending duplicate acknowledgment responses
- ✅ should disconnect peer building on acknowledged disputed fork

### E2E-FraudProofsBlockConfirmation (~5-6)

- ✅ queued future block accepts later calldata event and executes after predecessor
- ✅ queued duplicate block does not fall through to double sign
- ✅ stored duplicate merges trusted timestamp without replaying transition
- ✅ stored duplicate rejects a new signature from a non-participant
- ✅ forged inbound message → ForgedInboundMessageBlock
- ✅ stateSnapshotHash mismatch → BlockInvalidStateTransition

### E2E-DisputeManager (~4)

- ✅ should reduce invalid state transition disputes and create new fork
- ✅ should reject dispute when auditing data is partial and state proof invalid
- ✅ should post updated state snapshot after fork resolution

### E2E-StateSnapshots / MaliciousUpdateSnapshot (~3)

- ✅ should update on-chain snapshot to a new fork genesis after dispute resolution
- ✅ outbound block messages sum exceeds snapshot.totalWithdrawals → reverts
- ✅ colluded inflated stateMachineState balance → succeeds, spectator aborts

### E2E-ParticipantLifecycle (~1)

- ✅ should demote exiting participant to SYNCED when state snapshot updated on-chain

### disputeValidation/disputeInputFields (many)

- ✅ timeout.test.ts: TimeoutThreshold, TimeoutCalldataPosted, TimeoutParticipantNotNext, ~5 of 8 tests
- ✅ onChainSlashes.test.ts: both
- ✅ latestStateSnapshotHash.test.ts: 2 random + AND variants
- ✅ selfRemoval.test.ts: 2 of 2
- ✅ forkId.test.ts: junk fork
- ✅ inboundHash.test.ts: 2 of 2 (DisputeInboundHashNotInChain)
- ✅ disputeAuditingDataHash.test.ts: most

### disputeValidation/stateProof (many)

- ✅ case1_inboundDivergence: Case 1.1
- ✅ case4_blockInjection: channelId + forkId variants (4 of 6)
- ✅ case5_structuralRules: both
- ✅ case5_milestoneBlockContent: transactionCnt += 5
- ✅ case5_lastMilestoneFinalityAndAuditingData

### disputeValidation/balanceInvariant, futureBlock

- ✅ balanceInvariant
- ✅ futureBlock

### Threaded smoke tests

- ✅ PeerHandle.test.ts (3 passing)
- ✅ LoopGuard, NamedOps, SpyRoundTrip, WorkerHandlers, deploymentRegistry tests

## CONFIRMED FAILING in worker mode (not in boss-skip)

### E2E-Spectate (most of ~10 tests)

**Root cause**: `addSpectatorWait` cross-worker discovery refresh — spectator joins, orchestrator dials registry, but existing peer workers don't re-dial. `participantCount` barrier times out at 10s.

- ❌ should spectate successfully when joining at genesis state
- ❌ should NOT allow spectate RPC before handshake completes
- ❌ aborts spectating when a finalized sync block conflicts with storage
- ❌ should spectate successfully when on-chain snapshot is already on the same fork
- ❌ should spectate successfully even when it must traverse forks (dispute → reduced fork)
- ❌ pre-dispute spectator disconnects from participants after resolve
- ❌ joinChannel survives dispute on reduced fork
- ❌ joinChannel before forceInboundJoin
- ❌ forceInboundJoin before joinChannel
- ❌ should spectate successfully when joining at block 0
- (+ several more)

### E2E-StateSnapshots (~1)

- ❌ should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates
    - State divergence: `Actual withdrawal delta does not match expected delta. Expected: 500, Actual: 0`. Snapshot post-on-chain not reflecting before/after read.

### E2E-FraudProofsBlockConfirmation (~1)

- ❌ applyTransaction failure → BlockInvalidStateTransition
    - Mocha 90s timeout. Likely barrier hang.

### E2E-JoinChannelRaceConditions (~3, excluding boss-skip)

- ❌ new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch
- ❌ pending inbound unconsumed → SDK absorbs RaceConditionPendingInboundNotConsumed
- ❌ join on disputed fork reverts
    - All need migration off `peer.p2pInstance.p2pSigner.joinChannel` + `DisputeTamperingActions.buildForgedSnapshot`

### E2E-DisputeManager (~2-3)

- ❌ should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid
- ❌ should have missing state Storage when peer receives dispute with blocks it doesn't have

### E2E-InitHandshake (1)

- ❌ should update existing profile transport on WebRTC upgrade
    - Live `ATransport` identity comparison can't cross worker boundary; needs test-source refactor.

### E2E-ParticipantLifecycle (~1, excluding boss-skip)

- ❌ should ?? (join-path test pre-existing sync flake)

### E2E-Spectate, MaliciousUpdateSnapshot, SpectatorStateProofPersistence

- Most still fail (same `addSpectatorWait` root or live-object identity comparisons)

## Architectural blockers identified (not yet fixed)

1. **`addSpectatorWait` cross-worker discovery refresh** — blocks ~10 Spectate tests. Orchestrator-side LocalDiscoveryServer dial doesn't notify already-running peer workers to re-dial.
2. **Live `ATransport`/`PeerProfile` identity comparisons** — InitHandshake WebRTC, some Spectate tests. Cannot preserve object identity across worker boundary.
3. **State sync race for snapshot writes** — withdrawalDelta mismatch. Chain TX submit + chain event read happen too close.
4. **`peer.p2pInstance.p2pSigner.joinChannel` direct calls** in JoinChannelRaceConditions tests — need migration to sub-handle.

## Boss-known failures (skip set — out of scope)

```
E2E-ParticipantLifecycle :: should set PENDING_PARTICIPANT on join broadcast...
E2E-SpectatorStateProofPersistence :: join/leave sequence and fork resolution
E2E-JoinChannelRaceConditions :: pending joiner participates after dispute reduction
E2E-ForceJoinDispute :: should trigger force-join dispute...
E2E-DisputeManager :: should handle valid dispute when validating peer is missing snapshot data
balanceInvariant :: validator's locally-tracked snapshot corrupted...
case4_blockInjection :: stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random
case4_blockInjection :: header.forkId = random
case1_inboundDivergence :: → DisputeInvalidStateProof (multiple variants)
case3_signedBlocksOnly :: → DisputeInvalidStateProof
case3_signedBlocksOnly :: → DisputeInvalidBlockInStateProofApplyFraudProof (multiple)
timeout :: too-early timeout dispute → slashes disputer
timeout :: blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState
timeout :: valid timeout dispute → no TimeoutTooEarly fraud proof stored
timeout :: blockHeight = fully-signed block height; disputer left → TimeoutThreshold
latestStateSnapshotHash :: stateProof = {} AND latestStateSnapshotHash = random (2 variants)
onChainSlashes :: dispute.input.onChainSlashes contains address not in latestStateSnapshot participants
```

## Total estimate (honest)

| Category                            | Count  |
| ----------------------------------- | ------ |
| Confirmed passing in worker mode    | ~70-80 |
| Boss-known failures (skip)          | 22     |
| Real worker-mode blockers remaining | ~30-40 |
| Total                               | ~130   |

## Path to 108 / 130 (assuming "all except boss's 22")

Requires:

- Fixing `addSpectatorWait` architectural issue (unlocks ~10 Spectate tests)
- Migrating `peer.p2pInstance.p2pSigner.joinChannel` callers (~3 JoinChannelRaceConditions)
- Investigating + fixing withdrawalDelta state-divergence (~1)
- Migrating remaining live-object identity comparisons (~2-3)
- Investigating applyTransaction timeout (~1)
- Migrating MaliciousUpdateSnapshot / Spectate per-test direct reads (~5-10)

Each is a focused but non-trivial fix. Realistic landing rate: 1-3 tests per narrow agent session × ~15-20 sessions = ~30 tests reachable.

Total achievable: ~95-100 / 130.

## Per-target action queue (priority order, easier-first)

1. Migrate `peer.p2pInstance.p2pSigner.joinChannel` to sub-handle (~3 tests, 30 min)
2. Migrate `MaliciousUpdateSnapshot` direct reads to sub-handles (~3 tests, 60 min)
3. Investigate withdrawalDelta race (~1 test, 30-90 min)
4. Investigate applyTransaction timeout (~1 test, 60-90 min)
5. Architectural: `addSpectatorWait` discovery refresh (~10 tests, 2-4 hr — biggest yield)
6. Test-source: migrate ATransport identity comparisons (~2-3 tests, ~1 hr)

## Recent commits this session

```
315e87cf worker/sub-handles: blockForkIsDisputed + migrate simulateBuildOnDisputedFork
84478846 actions: migrate getIsForkDisputedService callers to handle dispatcher
19d60d3c worker/sub-handles: queryDisputeConfirmation (migrate AssertStorageActions)
23afec2e e2e/FraudProofs: migrate first 4 tests to PeerHandle sub-handles
ea9c341a worker/sub-handles: queryBlockByHash, queryBlockConfirmationAt, queueBlock, isBlacklisted, postBlockCalldata
901a79c4 e2e/SpectatorStateProofPersistence: connectionCount via PeerHandle
4e28c7ad e2e/JoinChannelRaceConditions: migrate stateManager reads
84b6c4df e2e/ForceJoinDispute: migrate getStatus + getParticipants
97182c93 e2e/ParticipantLifecycle: migrate getStatus calls
2641f3e2 harness: delete dead surface (round-3 1b)
243b3e2b worker/sub-handles: type WorkerStateManager = StateManager (round-3 1a)
+ ~47 earlier commits since 77bd0b14
```
