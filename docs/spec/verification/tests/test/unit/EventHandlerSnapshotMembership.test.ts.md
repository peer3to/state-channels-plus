# EventHandlerSnapshotMembership.test.ts

Test file: [test/unit/EventHandlerSnapshotMembership.test.ts](../../../../../../test/unit/EventHandlerSnapshotMembership.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Overview

Each case opens a three-peer channel, advances state and posts a same-fork snapshot, so the chain holds a
first snapshot (the block of `ChannelOpened`) and a later one. It then calls peer 1's
`onStateSnapshotUpdated` on the host with a snapshot read from the chain at one block and an event
coordinate of another, while the harness records what the peer publishes to membership. The peer's own
live handling of the posted snapshot is settled first, so only the handler under test publishes.

The first case announces the later snapshot at its own block: membership receives the snapshot the
chain holds. The second announces the first snapshot at the later update's block: the chain holds a newer
snapshot at its head, and nothing is published. The third handles the first snapshot's own, older event
after the later one landed: nothing is published. The fourth hands the handler a closing snapshot (no
participants) while the chain holds a different one: it is published without a comparison. The fifth lags the read node one block behind the later
update: the handler waits for the node to reach the event's block (nothing is published meanwhile),
then publishes the snapshot the chain holds.

## Tests

- `a snapshot event whose snapshot the chain still holds is published to membership`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P33, REQ-GOSSIP-4-J5Z4DF.T1.P52
- `a snapshot event announced after a newer snapshot landed is not published to membership`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P34, REQ-GOSSIP-4-J5Z4DF.T1.P53
- `an older snapshot event handled after a newer one is not published to membership`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P35, REQ-GOSSIP-4-J5Z4DF.T1.P54
- `a closing snapshot, which has no participants, is published to membership although the chain holds a different snapshot`: REQ-GOSSIP-4-J5Z4DF.T1.P55
- `a snapshot event of a block the read node has not reached waits for the node, then publishes the snapshot the chain holds`: REQ-GOSSIP-4-J5Z4DF.T1.P56
