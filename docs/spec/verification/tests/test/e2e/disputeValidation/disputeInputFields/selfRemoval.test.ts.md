# selfRemoval.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts)

## Overview

The voluntary self-removal case keeps dispute initiation suppressed for the leaver’s full test lifetime. It does not send a restore RPC after the leaver’s root has been disposed; remaining participants still prove the committed exit and withdrawal accounting.

Two tests cover `dispute.input.selfRemoval` from both sides. The valid case arms `forceExit` on
peer 1 so its dispute pipeline produces a genuine self-removal dispute, posted untampered: the
oracles assert exactly one commitment, no `onDisputeKilled` from anyone during a 4-second quiet
window, fork resolution among the remaining peers, a participant count of 2, and that every
remaining peer's participant list no longer contains the leaver's address. The invalid case posts
a dispute through `DisputeTampering.flipSelfRemovalWithoutOutputRecompute`, which flips the flag
and zeroes timeout/onChainSlashes without recomputing `outputSnapshotDataHash`; the on-chain
validator sees the output hash disagree with the flipped flag, so all peers fire
`onDisputeKilled`, honest peers store a `DisputeInvalidOutputState` proof, and the fork still
resolves. After the permutation atomization, the valid-case permutation of the dispute-input
requirement is a single scenario the accept-side test covers in full; the flipped variant is a
second instance of the output-correctness proof type, whose IDs live on `outputState.test.ts`.

The contribution case stages a synced joiner whose on-chain join the three founders omit, so the leaver's first exit post after its exit block is refused with `RaceConditionPendingInboundNotConsumed`. The leave watchdog is configured to outlast that staging, and the leaver's dispute submissions are recorded and forwarded to the chain. The leaver is then blinded to block gossip. The remaining founders include the join again and seat the joiner, then keep authoring until the watchdog submits the leaver's self-removal dispute, so their latest state is newer than the leaver's. After the fork resolves among the remaining founders and the seated joiner, the committed leaver dispute has `selfRemoval = true`. At least one other dispute was committed into that window. Each such contribution has `requireExistingDisputeWindow = true`, `selfRemoval = false` and a latest state different from the leaver's. Neither the contributors nor the leaver is slashed on chain, and no honest peer stores a `DisputeNotLatestState` proof. Every honest peer's reduced participant list keeps each contributor and drops the leaver.

The kill-period case uses the production fifteen-second writer window, since nothing authors while the exit post is held and the disputes commit. It parks the leaver's exit post at its send (installed before the exit block, whose finality posts at once), commits honest disputes against an invalid block so the fork's kill period is open, then releases the post: the on-chain snapshot hash is unchanged, the leaver's committed dispute is a no-calldata self-removal, no honest peer stores any dispute fraud proof against it, the dispute resolves with only the invalid-block author slashed on chain, and no host error remains. The released post's decoded revert must be `RaceConditionSnapshotUpdateDisputedFork`, and every honest peer's participant list must drop the leaver after resolution. The leaver's committed dispute is the one it raises at once on the dispute it observes while exiting, carrying the self-removal its exit block set; the refused post starts no dispute.

## Tests

- `dispute.input.selfRemoval = true; honest disputer voluntarily exits → dispute commits and disputer removed from participant set`: REQ-DIS-1-XAJ1VA.T1.P9, REQ-SM-8-8CHSQ8.T1.P17
- `an honest leaver's exit post refused for an unconsumed inbound join → its watchdog self-removal dispute; the others contribute newer state into the existing window and remain participants`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P21
- `an honest leaver's exit post inside a kill period is refused → self-removal dispute, no proof, no slash`: REQ-ENFSNAP-4-ESP98F.T1.P5
- `dispute.input.selfRemoval flipped without recomputing outputSnapshotDataHash → DisputeInvalidOutputState`: none
