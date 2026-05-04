# E2E Test Cases — Gap Analysis & Priority Queue

Derived from Trello cards vs. existing test coverage as of 2026-04-29.

---

## Top 3 Most Valuable

### #1 — False-positive `TimeoutTooEarly` (Card 5)

**Why this matters more than any other gap:**

The existing test `"TimeoutTooEarly: posted before wait period elapses"` verifies the true-positive path: the wait period genuinely has not elapsed, the pipeline correctly flags it, the fraud proof lands on-chain, and the dispute dies. That path is covered.

What is _not_ covered is the false-positive path, which was observed in a real production incident (see logs link in Card 5):

> Validation pipeline detects `TimeoutTooEarly` → auditing fails → tries to kill dispute → on-chain rejects with `ErrorInvalidFraudProof` → dispute survives, system is in a degraded/confused state.

The root cause mentioned in the card: "the dispute was constructed with 9 signedBlocks and 0 milestones — that should not have been the case." This means the state proof shape fed into the timeout validator was anomalous, causing the pipeline to compute a wrong minimum timestamp.

**Signal provided by this test:**

- Regression guard for the exact production bug
- Catches any future case where timeout boundary arithmetic drifts from what the contract expects
- Validates that a valid timeout dispute resolves correctly end-to-end (liveness property), not just that bad ones are killed (safety property)

**Suggested test:** Set up a valid timeout dispute where the wait period has genuinely elapsed. Verify: honest peers do NOT attempt to kill it, dispute resolves cleanly with `forkId` reduced, and no `ErrorInvalidFraudProof` is emitted.

---

### #2 — All Peers Malicious: Inflated L2 Balance in `updateSnapshot` (Card 6b)

**Why this matters:**

The on-chain contract validates withdrawal amounts against the on-chain channel balance, but it has no visibility into L2 state machine balances. All participants can collude to construct a snapshot where the L2 state machine shows a larger balance than the funds actually locked in the channel. The `updateSnapshot` call succeeds on-chain (because the withdrawal itself fits within the on-chain balance), but the L2 state machine balance is fraudulently inflated.

The spectator is the only watchdog for this. The balance invariant check in `SpectatingValidationStrategy` is the last line of defence before a user proves fraudulent state to another peer or an off-chain service.

**No existing test covers this.** All `E2E-StateSnapshots` tests use honest participants. The balance invariant tests in `E2E-DisputeValidationPipeline` target dispute fraud proofs, not the `updateSnapshot` path.

**Signal provided by this test:**

- Validates that the spectator's balance invariant check fires on the `updateSnapshot` path (not just during dispute validation)
- Confirms the proof presented to a joining spectator is rejected, preventing a victim peer from being deceived into accepting a fraudulent state

**Suggested test:** All participants agree on an `updateSnapshot` with a tampered state machine balance (inflated). On-chain call succeeds. A spectator that then tries to sync should fail the balance invariant check and abort/disconnect.

---

### #3 — Dispute with Correct Auditing Data but State is in the Future (Card 2)

**Why this matters:**

`"DisputeNotLatestState: proof height below last signed"` covers the case where the dispute's state proof height is _below_ what honest peers have already signed — the disputer is hiding recent state. Card 2 describes the opposite vector: the auditing data is correct and internally consistent, but the state in the dispute is _ahead_ of any block honest peers have signed.

These are distinct attack surfaces:

- Height-below: attacker rolls back to an earlier favourable state.
- Height-above: attacker projects forward to a future state that doesn't yet exist on any signed block.

If the protocol doesn't correctly detect the height-above case, a malicious peer could advance the channel to an unsigned "future" state and potentially claim funds from it.

**Signal provided by this test:**

- Verifies the `DisputeNotLatestState` (or equivalent) fraud proof fires for the forward-projection case
- Confirms honest peers stay at their current state and kill the dispute rather than accepting the future state

**Suggested test:** After N transitions, tamper the dispute's state proof to reference a block height of N+K (beyond what any peer has signed), but with correct auditing data structure. Honest peers should detect and kill the dispute.

---

## Full Priority Queue

All items below are ordered by: _(uncovered signal) × (protocol safety/liveness importance)_.

Items already substantially covered are excluded.

---

### Priority 1 — False-positive `TimeoutTooEarly`

_(See Top 3 #1 above)_

**Target file:** `E2E-DisputeValidationPipeline.test.ts` or `E2E-Timeouts.test.ts`

---

### Priority 2 — Malicious `updateSnapshot`: inflated L2 balance → spectator balance invariant

_(See Top 3 #2 above)_

**Target file:** New `E2E-MaliciousUpdateSnapshot.test.ts`

---

### Priority 3 — Dispute with correct auditing data, state is in the future

_(See Top 3 #3 above)_

**Target file:** `E2E-DisputeValidationPipeline.test.ts`

---

### Priority 4 — Malicious `updateSnapshot`: withdraw more than channel balance → should fail on-chain (Card 6a)

**Gap:** All `E2E-StateSnapshots` tests use valid withdrawal amounts. There is no test that attempts to `updateSnapshotSameFork` with a withdrawal exceeding the on-chain channel balance.

**Signal:** Confirms the on-chain guard is wired and the SDK does not silently swallow the revert. Important regression guard if the withdrawal encoding ever changes.

**Target file:** `E2E-MaliciousUpdateSnapshot.test.ts`

---

### Priority 5 — `updateSnapshot` during active dispute, empty `StateProof`, `getGenesisTimestamp` returns false → should NOT prune current state, only previous ones (Card 4)

**Gap:** No existing test exercises the interaction between an in-flight dispute and an `updateSnapshot` call with an empty state proof where genesis timestamp validation fails. The pruning invariant ("don't prune current, only previous") is untested.

**Signal:** Incorrect pruning here could corrupt the state machine, causing honest peers to lose the data needed to defend the dispute.

**Target file:** `E2E-DisputeManager.test.ts` or `E2E-StateSnapshots.test.ts`

---

### Priority 6 — `selfRemoval = true` valid case (Card 3 — `selfRemoval` both cases)

**Gap:** The existing selfRemoval test covers only the tampered case (`DisputeInvalidOutputState` when the output hash is not recomputed after toggling). There is no test for a _correctly constructed_ `selfRemoval = true` dispute resolving successfully.

**Signal:** Without this, a regression that breaks the positive selfRemoval path would go undetected. The existing test only exercises fraud detection, not the acceptance path.

**Target file:** `E2E-DisputeJunkData.test.ts`

---

### Priority 7 — `stateProof` with no milestones and no signedBlocks, but `latestStateSnapshotHash` ≠ genesis (Card 3, case 1 base)

**Gap:** The card asks: "stateProof no milestones and no signedBlocks (this should be genesis) — what happens if this is not genesis?" The existing `E2E-DisputeValidationLatestStateSnapshotHash` tests cover wrong hashes with signedBlocks or milestones present, but the empty-proof-non-genesis case is not explicitly tested.

**Signal:** An empty state proof should only be valid at genesis. A dispute with an empty proof but `latestStateSnapshotHash ≠ genesis` should be killed. Without this test, a bug that lets an empty proof pass with an arbitrary hash would be invisible.

**Target file:** `E2E-DisputeValidationLatestStateSnapshotHash.test.ts`

---

### Priority 8 — Spectator `joinWaited` vs `joinDetached` variants (Card 1)

**Gap:** `E2E-Spectate.test.ts` has several spectate tests but they all follow a single flow. `E2E-ForceJoinDispute` covers force-join via dispute. The card asks for a scenario parameterised over `{justSpectate, joinDetached, joinWaited}` where `joinWaited` is synchronous (blocks until PARTICIPATING) and `joinDetached` is fully async (fire-and-forget then assert eventual state). These represent meaningfully different execution paths through `SpectateService`.

**Signal:** `joinWaited` and `joinDetached` surface different race conditions. A bug where the detached path races with a fork resolution and misses the PARTICIPATING promotion would be invisible in a wait-only test.

**Target file:** `E2E-Spectate.test.ts` — new parameterised scenario, or `E2E-ForceJoinDispute` extended with scenario options.

---

### Priority 9 — Injecting blocks with wrong `channelId` or `forkId` _inside_ the `stateProof` body (Card 3, case 4)

**Gap:** Existing tests (`E2E-DisputeJunkData` channelId/forkId describe blocks) verify that top-level `dispute.input.channelId` / `forkId` junk is caught. Card 3 case 4 asks about injecting mismatched headers _inside_ individual `signedBlocks` or `milestones` in the `stateProof`. The header mismatch tests (`ErrorDisputeStateProofHeaderChannelMismatch`) appear to cover this partially, but the randomly-injected-mid-proof variant (not just the first block) is worth an explicit test.

**Signal:** If the validation loop exits early or only checks the first/last block, a mid-proof injection could slip through.

**Target file:** `E2E-DisputeJunkData.test.ts`

---

### Priority 10 — `M2` inbound hash valid, `stateSnapshot` updated to `M2` — the "stay-at" case (Card 3, case 1.2)

**Gap:** Cases 1.3 (skip-ahead to M3) and 1.4 (stay-back at M1) are both covered. Case 1.2 — where `M2`'s inbound hash is valid on-chain and the snapshot commits exactly to `M2` — is the boundary case: is this accepted as valid, or should the snapshot always commit to the _last_ milestone? The expected behaviour needs to be confirmed and locked in with a test.

**Signal:** If this case should be accepted, a test confirms the happy path. If it should be rejected (because `latestStateSnapshotHash` must commit to the very last milestone), a test guards against regressions that let it through.

**Target file:** `E2E-DisputeJunkData.test.ts`

---

### Priority 11 — Skipped timeout tests: `TimeoutThreshold` and `TimeoutCalldataPosted` (Card 5 related, already `it.skip`-ed in pipeline)

**Gap:** Two tests are already `it.skip`-ed in `E2E-DisputeValidationPipeline.test.ts` with TODO comments explaining the missing harness helpers:

- `"should kill dispute and store TimeoutThreshold when all participants have already signed the block claimed as timed out"`
- `"should kill dispute and store TimeoutCalldataPosted when the block at timeout.blockHeight has been posted on-chain as calldata"`

**Signal:** These are explicit known gaps. The harness helpers needed (`truncateStateProofToHeight` with full re-hashing, and on-chain calldata posting before a tampered timeout dispute) are prerequisites. Worth unblocking once the harness matures.

**Target file:** `E2E-DisputeValidationPipeline.test.ts` — un-skip and implement.

---

_End of gap analysis._
