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
neither `onDisputeStarted` nor `onDisputeUpdate` (without `getRelevantWindow` it fires both). A
seated peer that misses such a cycle is out of scope
([`FIND-RUNTIME-4-5ZZD5T`](../../../../audit/open-findings.md#find-runtime-4-5zzd5t)).

## Tests

- `a timed-out peer whose chain events were held through the disputes, the reduction and a same-fork snapshot update ignores the disputes and leaves`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P26, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P53
