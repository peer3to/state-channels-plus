# EventHandlerChannelOpened.test.ts

Test file: [test/unit/EventHandlerChannelOpened.test.ts](../../../../../../test/unit/EventHandlerChannelOpened.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md), [EventSyncService.ts](../../../../implementation/source/src/stateManager/eventSync/EventSyncService.ts.md)

## Overview

Each test runs real harness runtimes against a chain open. The install case opens a
channel for two participants while a third runtime has the channel selected as an observer, then reads
the observer's fork id, live state hash and stored genesis snapshot: the fork and state hash equal the
chain snapshot's. The opening-data case runs a standalone harness on a Math consumer whose
genesis folds in the opening data, opens for two of three runtimes with the harness's opening data
`0x00`, checks the premise that the recorded hash is the genesis of `0x00` and not of empty data, and
reads the observer's fork id and live state hash: both equal the chain snapshot's, so the observer handed
the opened event's data to the derivation. The recovery case opens with two participants, creates a fresh runtime, selects the
channel on it only after the open, checks it holds no genesis join block, and re-delivers the
`ChannelOpened` log through the real event pipeline: the block is then stored and the genesis installed
with the chain's fork and state hash. The in-flight case holds a participant's genesis join log handling pending (the real handler runs on
release), opens, and releases once the log reached the runtime: the participant installs the genesis
with the chain's fork and state hash, and its provider saw no `getLogs` query. The unavailable case
swallows the genesis join log handling of a runtime outside the opened set, so neither the live log nor
a recovery query stores the block: that runtime reports the expected detached error "genesis join block
unavailable", fires no `onAbort`, `onSetState` or completed `onChannelOpened` and stays open, while the
participants install. The executor-failure case makes only a participant's local `openChannelGenesis` execution fail
outside the EVM (the stub throws from the local executor's call for that selector): that runtime fires `onAbort`
once and closes, fires no `onSetState` or completed `onChannelOpened`, and reports the error as the expected
detached error, while the other participants install. The two stale-mirror cases swallow the lower or the higher participant's genesis join log handling while both participants negotiate through `joinLobby`: both joins resolve with
the opened channel, the genesis join block is still not stored on that participant, and it installed the
genesis it signed, with the chain's fork and state hash and no `onAbort`. The no-signed-genesis case does the
same to a participant of a harness open, which negotiated nothing: it fires `onAbort` once and no
`onSetState` or completed `onChannelOpened` and reports "genesis join block unavailable", while the others
install. The outsider executor-failure case fails a non-participant's local hook execution outside the
EVM: that runtime reports the error as the expected detached error, fires no `onAbort`, `onSetState` or
completed `onChannelOpened` and stays open. The hook-revert case runs a participant's local hook call with its arguments cut, so the consumer code really reverts: that runtime fires `onAbort` once and closes, fires no `onSetState` or completed
`onChannelOpened`, and reports "Opened genesis rejected: hook reverted" as the expected detached error,
while the other participants install. The mismatch case opens for two of three runtimes with unanimous terms carrying a hash no
genesis derives from and waits only for the receipt: the chain keeps the channel open with that hash;
on each participant `onAbort` fires once, the runtime closes, no `onSetState` or completed
`onChannelOpened` reaches the client, and the handler's failure surfaces as the expected detached
error; the third runtime fires `onChannelOpened` once, no `onAbort` or `onSetState`, stays open and
holds no fork.

## Tests

- `installs the genesis it rebuilds from the genesis join block and the opening data`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P1, REQ-LIF-12-TSXRBG.T1.P1, UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4.P2
- `installs a genesis that depends on the opening data the open signed`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P14, REQ-LIF-12-TSXRBG.T1.P12
- `recovers a genesis join block it never received and installs`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P2, REQ-LIF-12-TSXRBG.T1.P2
- `waits for the open's genesis join log in flight instead of recovering it from the chain`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P26, REQ-LIF-12-TSXRBG.T1.P7
- `fails the event without aborting a runtime outside the opened set whose genesis join block stays unavailable`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P10, REQ-LIF-12-TSXRBG.T1.P5
- `aborts a listed participant whose local genesis hook execution fails outside the EVM while the others install`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P16, REQ-LIF-12-TSXRBG.T1.P14
- `installs the genesis the lower address signed although its mirror never stored the open's genesis join block`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P18, REQ-LIF-12-TSXRBG.T1.P16
- `installs the genesis the higher address signed although its mirror never stored the open's genesis join block`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P20, REQ-LIF-12-TSXRBG.T1.P18
- `aborts a listed participant that holds no signed genesis and cannot rebuild it while the others install`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P19, REQ-LIF-12-TSXRBG.T1.P17
- `fails the event without aborting a runtime outside the opened set whose local genesis hook execution fails outside the EVM`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P17, REQ-LIF-12-TSXRBG.T1.P15
- `aborts a listed participant whose genesis hook reverts while the others install`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P4, REQ-LIF-12-TSXRBG.T1.P4
- `aborts the listed participants and spares any other runtime when the opened hash matches no genesis`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P3, UNIT-TEST-EVENT-HANDLER-2-Q270TR.P5, REQ-LIF-12-TSXRBG.T1.P3, REQ-LIF-12-TSXRBG.T1.P6
