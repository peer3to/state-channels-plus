# EventHandlerChannelOpened.test.ts

Test file: [test/unit/EventHandlerChannelOpened.test.ts](../../../../../../test/unit/EventHandlerChannelOpened.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md), [EventSyncService.ts](../../../../implementation/source/src/stateManager/eventSync/EventSyncService.ts.md)

## Overview

Each test runs real harness runtimes against a chain open. The install case opens a
channel for two participants while a third runtime has the channel selected as an observer, then reads
the observer's fork id, live state hash and stored genesis snapshot: the fork and state hash equal the
chain snapshot's. The recovery case opens with two participants, creates a fresh runtime, selects the
channel on it only after the open, checks it holds no genesis join block, and re-delivers the
`ChannelOpened` log through the real event pipeline: the block is then stored and the genesis installed
with the chain's fork and state hash. The in-flight case holds a participant's genesis join log handling pending (the real handler runs on
release), opens, and releases once the log reached the runtime: the participant installs the genesis
with the chain's fork and state hash, and its provider saw no `getLogs` query. The unavailable case
swallows the genesis join log handling of a runtime outside the opened set, so neither the live log nor
a recovery query stores the block: that runtime reports the expected detached error "genesis join block
unavailable", fires no `onAbort`, `onSetState` or completed `onChannelOpened` and stays open, while the
participants install. The participant read-failure case makes only a participant's `openChannelGenesis`
provider call fail with a call exception without revert data, as a node's error answer: that runtime
fires `onAbort` once and closes, fires no `onSetState` or completed `onChannelOpened`, and reports the
error as the expected detached error, while the other participants install. The pending-join case
swallows one participant's genesis join log handling while both participants negotiate through
`joinLobby`: the peer's join resolves with a channel that is open on chain, the failing participant's join rejects with the
runtime-disposed error, it fires `onAbort` once and no `onSetState` or completed `onChannelOpened`, and
reports "genesis join block unavailable" inside the abort error. The transport case makes a non-participant's
`openChannelGenesis` call fail with a plain transport error: that runtime reports the error as the
expected detached error, fires no `onAbort`, `onSetState` or completed `onChannelOpened` and stays
open. The hook-revert case makes a participant's call revert with empty revert data: that runtime fires `onAbort` once
and closes, fires no `onSetState` or completed `onChannelOpened`, and reports "Opened genesis rejected:
hook reverted" as the expected detached error, while the other participants install. The mismatch case opens for two of three runtimes with unanimous terms carrying a hash no
genesis derives from and waits only for the receipt: the chain keeps the channel open with that hash;
on each participant `onAbort` fires once, the runtime closes, no `onSetState` or completed
`onChannelOpened` reaches the client, and the handler's failure surfaces as the expected detached
error; the third runtime fires `onChannelOpened` once, no `onAbort` or `onSetState`, stays open and
holds no fork.

## Tests

- `installs the genesis it rebuilds from the genesis join block and the opening data`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P1, REQ-LIF-12-TSXRBG.T1.P1, UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4.P2
- `recovers a genesis join block it never received and installs`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P2, REQ-LIF-12-TSXRBG.T1.P2
- `waits for the open's genesis join log in flight instead of recovering it from the chain`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P26, REQ-LIF-12-TSXRBG.T1.P7
- `fails the event without aborting a runtime outside the opened set whose genesis join block stays unavailable`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P10, REQ-LIF-12-TSXRBG.T1.P5
- `aborts a listed participant whose genesis hook read fails without revert data while the others install`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P11, REQ-LIF-12-TSXRBG.T1.P11
- `aborts a listed participant that cannot rebuild its genesis and rejects its pending lobby join with the runtime-disposed error`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P13, REQ-LIF-12-TSXRBG.T1.P10
- `fails the event without aborting a runtime outside the opened set whose genesis hook read fails in transport`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P12, REQ-LIF-12-TSXRBG.T1.P9
- `aborts a listed participant whose genesis hook reverts while the others install`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P4, REQ-LIF-12-TSXRBG.T1.P4
- `aborts the listed participants and spares any other runtime when the opened hash matches no genesis`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P3, UNIT-TEST-EVENT-HANDLER-2-Q270TR.P5, REQ-LIF-12-TSXRBG.T1.P3, REQ-LIF-12-TSXRBG.T1.P6
