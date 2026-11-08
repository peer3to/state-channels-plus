# DisputeWindowClearedEvent.test.ts

Test file: [test/stateManager/DisputeWindowClearedEvent.test.ts](../../../../../../test/stateManager/DisputeWindowClearedEvent.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md), [LeaveChannelService.ts](../../../../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md)

## Overview

A regression for a peer that was paused through a whole dispute cycle, as a background browser tab.
It exercises `EventHandler.handleDisputeCommitted` (a dispute whose window the chain already cleared
is ignored) and `LeaveChannelService.dropIfRemovedWhileAway` (a peer removed by a snapshot it never
installed leaves). In a three-peer channel the next writer never authors, and the harness holds
every contract log of that peer, recovery reads included, and cuts its peer connections, as a paused
tab loses them (otherwise it syncs the reduced fork from the others' blocks). The other two time it
out and reduce the fork without it. A forced inbound message moves the chain's inbound head, and
their same-fork snapshot update, posted after a finalized block, clears the disputed fork's window
and prunes the inbound blocks the timeout disputes name. The held logs are then started in chain
order, the dispute events first and the rest after, each group running concurrently, as the resumed
runtime meets them after the chain moved on. The dispute events reach the peer while it still
participates on the disputed fork, before its local mirror holds the pruning snapshot, so on the
code before the fix it audited them, passed, and reported the settled disputes to the application as
live ones (`onDisputeStarted`, `onDisputeUpdate`). In the incident the later snapshot events ran at
the same time and the mirror was already pruned, so it audited them against the pruned chain
(inbound hash not in chain), tried to kill them, and failed to build a state proof of the settled
fork, which failed the event pipeline. Oracles: no held log's handling fails, the removed peer
reports that it left the channel (without `dropIfRemovedWhileAway` it never does), and it fires
neither `onDisputeStarted` nor `onDisputeUpdate` (without `getRelevantWindow` it fires both).
A record-only probe on the peer's `disputeValidationService.validateDispute` counts no audit, and
the chain holds no `DisputeKilled` log and no dispute from the paused peer. The
second test stages the same cycle (`stageRemovedWhileAway`), then lands a join of the paused peer
before its logs are released, so the chain lists it as a pending joiner while the removing snapshot
stays the latest. A record-only probe on the peer's `MembershipService` waits until the removal
check's chain read answers that the chain lists the signer. Oracles: the on-chain snapshot is still
the removing one, `dropMembership` is never called, the peer stays `PARTICIPATING` and gets no
`onLeftChannel` (without the `isSignerOnChain` check in `dropIfRemovedWhileAway` it drops and
leaves).

The third test stages the cycle with a threshold-final dispute: in a four-peer channel the double
signer's logs are held, its timeout check and own disputes are suppressed, and its connections are
cut after the final dispute is posted; the others install the dispute's output fork, finalize a
block on it at once (before its height-0 timeout) and post its snapshot, which clears the disputed
fork's window (a final dispute has no adoption post, so no inbound message is forced). A record-only probe counts the paused peer's
`reductionManager.completeWithGenesis` calls (each forwarded). Oracles: no held log's handling
fails, the removed peer leaves the channel, and `completeWithGenesis` is never called (without the
window gate the final branch installs the settled output or fails preparing it). The fourth test
holds the logs of a synced spectator and cuts its connections, so it stays on the disputed fork,
while the three participants dispute an invalid block, reduce without its author and clear the
window. A record-only probe on the spectator's timeout manager records scheduled tasks. Oracles:
no held log's handling fails, the spectator stores no dispute, schedules no `reduction-<fork>` task
for the old fork (an uncommitted observer persists and schedules without the gate), its event
pipeline has no failed block and is not disposed, and its local mirror holds the chain's snapshot.
A seated peer that misses such a cycle is out of scope
(`FIND-RUNTIME-4-5ZZD5T`).

The last test covers the other side of the gate. Peer 0 of four is the only auditor that kills;
its provider is pinned at the current block while another node keeps streaming logs, and peer 1
uploads a dispute that states no reason, which opens the fork's window in its own block. The window
read of peer 0 is answered below that block, so it must wait: the test waits until the handler
entered `waitForChainHead`, checks that no `onDisputeStarted` fired and nothing was uploaded yet,
then releases the view and mines a block. Oracles: peer 0's kill-and-dispute multicall lands,
`onDisputeStarted` fires once (only on the acknowledgment's first request), and the chain holds one
`DisputeKilled` log, for the spammer. Before the fix the lagging read answered "no window" and the
dispute was ignored: no acknowledgment, no audit and no kill.

## Tests

- `a timed-out peer whose chain events were held through the disputes, the reduction and a same-fork snapshot update ignores the disputes and leaves`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P27, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P57, REQ-LIF-10-QR8NQ9.T1.P39, REQ-DISPUTE-PIPE-14-5C2SXH.T1.P1
- `a timed-out peer removed by a same-fork snapshot update it never installed stays a participant while the chain lists it as a pending joiner`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P58, REQ-LIF-10-QR8NQ9.T1.P40
- `a double signer whose chain events were held through a threshold-final dispute, its reduction and a same-fork snapshot update ignores the final dispute without installing its output, and leaves`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P28, REQ-DISPUTE-PIPE-14-5C2SXH.T1.P3
- `a synced spectator whose chain events were held through a dispute cycle and a same-fork snapshot update ignores the disputes: nothing persisted, no reduction scheduled, and its mirror holds the chain's snapshot`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P29, REQ-DISPUTE-PIPE-14-5C2SXH.T1.P2
- `an auditor whose read node is behind the block of a fork's first dispute waits for it, then acknowledges, audits and kills the invalid dispute`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P30, REQ-DISPUTE-PIPE-14-5C2SXH.T1.P4
