---
tier: 2
status: follow-up
topic: e2e findings — reduced-fork / dispute-reduction / snapshot / signing
---

# Reduced-fork / dispute-reduction findings (GitHub issues #350–#357)

This register collects everything surfaced while greening the e2e suite for the parallel test
runner (branch `test/add-hardhat-parallel-script`). **None of these were caused by the test
changes on this branch** — each reproduces identically on the clean committed HEAD, run
serially and in isolation. Each has a tracked GitHub issue (linked below).

## How findings were verified

For every skipped/failing test: run focused (`--grep`), as a whole file serially, and with the
branch WIP both applied and stashed. Deterministic items fail identically on clean HEAD; flaky
items were run 5–7×. Two failures (#354, #356) were traced end-to-end with `LOG_LEVEL=debug`.
**Every finding then went through an adversarial code-review pass** (independent reviewer per
finding, tasked to refute it). That pass confirmed six, corrected #356 (wrong symbols), and
re-scoped #354 (wrong root cause). The fix suggestions below incorporate the reviewers' notes.

---

## Issue register (summary)

| Issue                                                             | Title                                                                                    | Type                      | Severity |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- | -------- |
| [#357](https://github.com/peer3to/state-channels-plus/issues/357) | Recover missing disputes from logs during reduction validation                           | bug / missing feature     | High     |
| [#350](https://github.com/peer3to/state-channels-plus/issues/350) | Implement reduced-fork transition in `setForkIfLatestAndCurrent`                         | bug / missing feature     | High     |
| [#351](https://github.com/peer3to/state-channels-plus/issues/351) | `shouldSignBlock` drops a still-needed signature on reduced-fork blocks already on-chain | consensus bug             | High     |
| [#352](https://github.com/peer3to/state-channels-plus/issues/352) | `postStateSnapshot` multicall computes the same-fork update against stale on-chain state | correctness bug           | Med-High |
| [#353](https://github.com/peer3to/state-channels-plus/issues/353) | Self-removed participant fatals on the reduced-fork snapshot                             | robustness                | Med      |
| [#354](https://github.com/peer3to/state-channels-plus/issues/354) | Pending joiner across dispute reduction (blocked behind #350/#353)                       | protocol gap (unverified) | Med      |
| [#355](https://github.com/peer3to/state-channels-plus/issues/355) | Restore or remove the `forceInboundJoin`-on-disputed-fork guard                          | protocol decision         | Med      |
| [#356](https://github.com/peer3to/state-channels-plus/issues/356) | Off-chain and on-chain disagree on fraud-proof apply for `signedBlocks` linkage breaks   | protocol bug              | Med      |

---

## A. Reduced-fork cluster (dispute reduction → reduced fork)

A shared theme (behavior after a dispute is reduced onto a new fork) but **distinct root
causes** — there is no single fix. #350 + #353 are the keystones: until peers can adopt a
reduced fork, several other tests can't even reach their real assertions (see #354).

### #357 — `E2E-SpectatorStateProofPersistence` → "join/leave sequence and fork resolution"

- **Symptom:** deterministic. `Dispute not available for commitment: 0x…` thrown in afterEach.
- **Root cause:** `EventHandler.validateDisputeReductionAndChallenge` (`src/eventHandlers/EventHandler.ts` ~665–688)
  requires every dispute commitment in the on-chain window to be in local `storage.disputes`;
  on a miss it throws. The log-recovery fallback is an unimplemented TODO at `EventHandler.ts:681`.
  For `PARTICIPATING` peers it's rethrown and genuinely fatal (the event listener marks the log
  seen before dispatch, so there's no re-delivery — `StateChannelEventListener.ts:51`).
- **Fix:** hydrate the missing dispute from chain logs before validating. Note `P2pEventHooksUtils.ts:77`
  is the real duplicate of this lookup and already handles a miss non-fatally — extract a shared
  helper using that skip-on-miss baseline.

### #350 — `setForkIfLatestAndCurrent` reduction path is unimplemented

- **Root cause:** `setForkIfLatestAndCurrent` (`EventHandler.ts` ~801–837), reached from
  `onDisputeReducedResultCommitted` (call sites `:511`, `:577`), `throw`s `"Not implemented yet -
set fork for reduceCommitment"` (`:828`) and has a silent `// TODO reduce localy` no-op return
  (`:815`); the real `setGenesisState` is commented out (`:831-835`). Reachable for **non-reducer**
  peers (the `forkId == forkId` guard at `:807` is ~always true there). The reducer transitions via
  a _different_ path — `StateManager.setGenesisState` at `:682` — so only the reducer follows the
  reduced fork today.
- **Fix:** implement both branches (compute/persist reduced genesis + set fork). The silent return
  at `:815` is the more common non-reducer branch and is itself a correctness bug (peer silently
  fails to follow the fork). Consensus/fork-follow gap, not dead code.

### #351 — `E2E-Spectate` → "spectate must traverse forks (dispute -> reduced fork)"

- **Symptom:** deterministic finalization deadlock at `sigs = N-1 / N` (unchanged at 40s — not a flake).
- **Root cause:** the reduced fork's height-0 block lands on-chain before all peers counter-sign.
  `StateManager.shouldSignBlock` (`:3063–3074`) short-circuits when `onChainTimestamp` is set **and**
  the local peer is `nextToWrite`, returning `false`. That's the **only** site that mints the local
  signature (`block.sign` ~`:2955`); no ingest/merge path back-fills it, and the on-chain calldata
  ingest re-hits the same guard. `AgreementManager.didEveryoneSignBlock` (`:58-67`) needs the full
  off-chain union regardless of on-chain status → permanent N-1/N.
- **Precondition:** only bites when the `nextToWrite` peer's _first_ sight of the block already has
  `onChainTimestamp` (true post-reduction).
- **Fix:** key the skip on `block.findSignature(this.signerAddress)` already present (or block fully
  signed), **not** on `onChainTimestamp` — always contribute a still-missing signature; no
  double-sign risk.

### #352 — `E2E-StateSnapshots` → "…reduced fork - multicall"

- **Symptom:** flaky (~3/7 focused). `Fork mismatch` from `prepareUpdateSnapshotSameFork` (`~:1862`)
  via `postStateSnapshot`.
- **Root cause:** `postStateSnapshot` (`:1667`) combines a fork-update leg + a same-fork-update leg,
  but the same-fork leg is computed against the **current** on-chain snapshot (old fork) instead of
  the state the fork-update leg will produce; when local is ahead it throws. Returning `undefined`
  is NOT a fix — it silently drops the same-fork leg's withdrawals → corrupt snapshot (observed delta
  500 vs 1000), so the throw is intentionally kept.
- **Fix:** rebase the same-fork leg onto the post-fork-update genesis — and per review this means
  **three** computations, not one: the fork-equality guard (`:1862`), the `isSnapshotNewer` milestone
  filter (`:1837-1845`), and the outbound-block range lower bound (`:1868-1877`), with fallback to
  `currentOnChainSnapshot` when there's no fork leg.

### #353 — Self-removed participant fatals on the reduced-fork snapshot

- **Status:** the test that exposed it (`E2E-Spectate` "survives dispute on reduced fork") is **fixed
  on this branch** — `onChainSnapshotChangedWait` gained an optional `peerIndices` filter so the
  barrier no longer waits on the self-removed leaver, and the benign detached errors are absorbed.
- **Latent SDK gap:** a self-removed peer stays `PARTICIPATING` (`DisputeManager` never calls
  `setStatus`); the reduced snapshot is genuinely unknown locally (self-removal only hashes
  `outputSnapshotData`, never `storeStateSnapshot`); so `onStateSnapshotUpdated` throws fatal at
  `:113`, before the leave-detection at `:134`.
- **Fix:** before throwing, reuse the existing triple-check at `:140-148` (localParticipants +
  getPendingParticipants); scope to `PARTICIPATING` only (a `PENDING_PARTICIPANT` is legitimately
  absent from an old snapshot); gate on snapshot-newer; and short-circuit `return` before
  `setForkIfLatestAndCurrent` (#350). Distinguish "left cleanly" from "slashed".

---

## B. Pre-existing skips carried on this branch

### #354 — Pending joiner across dispute reduction (blocked behind #350/#353)

- **Re-scoped after tracing.** Originally claimed "pending joiner's join not re-applied across
  reduction" — but the test never reaches the joiner assertion. It fails earlier at the snapshot
  barrier (`E2E-JoinChannelRaceConditions.test.ts:269`) because **no peer adopts the reduced fork**
  (#350 unimplemented + #353 fatal-unknown-snapshot). The join-re-application question is genuine but
  **unverifiable until #350/#353 are fixed**.
- **Next step:** fix #350 + #353, re-run; if the joiner is then missing from `getParticipants()` on
  the reduced fork, this becomes a real "pending join not carried" bug; else it resolves.

### #355 — Restore or remove the `forceInboundJoin`-on-disputed-fork guard

- **Root cause:** the `RaceConditionForceInboundJoinForkDisputed` guard was removed from
  `appendInboundMessages` in commit `029c6a82` ("remove race condition check from
  `appendInboundMessages`"). The error is declaration-only (`Errors.sol:89`), thrown nowhere; current
  `appendInboundMessages` (`StateChannelCommon.sol:233-239`) has no guard. The only surviving
  `isForkDisputed` guard is a _different_ entry point (`JoinChannelFacet.joinChannel:30`,
  `RaceConditionJoinChannelForkDisputed`), which doesn't cover the `forceInboundJoin` path.
- **Scope note:** the reachable `forceInboundJoin` caller is in `examples/MathStateMachine`
  (`MathConsumerFacet.sol:51-77`), so production blast radius depends on whether that consumer facet
  ships — but `appendInboundMessages` itself is unguarded.
- **Decision:** restore the guard centrally in `appendInboundMessages` (safer), or if removal was
  intentional, delete the dead error and retire the test.

### #356 — Off-chain vs on-chain disagree on fraud-proof apply for `signedBlocks` linkage breaks

- **Corrected after tracing** (the original symbol references were wrong):
    - Off-chain catches the linkage break in block replay and emits a `BlockInvalidStateTransition`
      proof stored as **`DisputeInvalidBlockInStateProofApplyFraudProof`** (`DisputeValidationService.ts`
      ~155-195) — **not** `DisputeInvalidStateProof`.
    - On-chain, `_handleDisputeInvalidBlockInStateProofApplyFraudProof` (`DisputeFraudProofFacet.sol:561`)
      returns `address(0)`, so `applyFraudProofs` reverts with `ErrorInvalidFraudProof`
      (`DisputeFraudProofFacet.sol:26`); the dispute is never killed → `onDisputeKilled` barrier times out.
    - `_areSignedBlocksLinkedAndVerified` (`StateProofFacet.sol:104`) is **not** exercised in this
      no-auditing-data path (earlier citation was wrong). The test's own expected type is also wrong.
- **Fix:** reconcile the SDK's chosen proof type/payload with what the on-chain handler can apply —
  either have `_handleDisputeInvalidBlockInStateProofApplyFraudProof` return the correct slashed
  participant, or have the off-chain pipeline build the type the contract slashes on.

---

## Test-expectation TODOs to settle (during the fixes above)

- `E2E-SpectatorStateProofPersistence.test.ts:114` — `// TODO - don't forget to rethink this`, next
  to `spectator … should be on pre-dispute fork`. Whether a spectator stays on the pre-dispute fork
  or follows to the reduced fork is the open question (ties to #357 / #350).

## Code TODOs in the affected paths (tech-debt inventory)

`src/eventHandlers/EventHandler.ts`

- `:549` `// TODO - find a universal way to signal "we've left"` → #353
- `:670` `// TODO - extract this function …` → #357
- `:681` `//TODO - querry longs` (dispute recovery from logs) → #357
- `:814/:824/:827` TODOs + `:828` `throw "Not implemented yet"` → #350

`src/stateManager/StateManager.ts`

- `:2962`, `:2987` `// TODO - quick hack - cleaner code later` (sign/persist path) → #351
- `:786`, `:1590`, `:367/:452/:480` — adjacent (abort, extra-time race, genesis-timestamp).

## Load flake noted (not skipped)

`E2E-DisputeManager` "should reduce invalid state transition disputes and create new fork"
intermittently fails the initial parallel pass and passes on the runner's single rerun. Likely the
same reduced-fork-timing family — worth a fresh trace before relying on rerun indefinitely.
