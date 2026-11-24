# EventHandlerChannelOpened.test.ts

Test file: [test/unit/EventHandlerChannelOpened.test.ts](../../../../../../test/unit/EventHandlerChannelOpened.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Overview

Each test runs real harness runtimes against a chain open, with no stub. The install case opens a
channel for two participants while a third runtime has the channel selected as an observer, then reads
the observer's fork id, live state hash and stored genesis snapshot: the fork and state hash equal the
chain snapshot's. The recovery case opens with two participants, creates a fresh runtime, selects the
channel on it only after the open, checks it holds no genesis join block, and re-delivers the
`ChannelOpened` log through the real event pipeline: the block is then stored and the genesis installed
with the chain's fork and state hash. The mismatch case opens with unanimous terms carrying a hash no
genesis derives from and waits only for the receipt: the chain keeps the channel open with that hash,
and on every runtime `onAbort` fires once, the runtime closes, no `onSetState` or completed
`onChannelOpened` reaches the client, and the handler's failure surfaces as the expected detached error.

A reverting genesis hook on an opened channel has no test: the shipped Math hook reverts only on an
overflowing deposit sum, and `open` reverts first on the same sum. It shares the abort with the
mismatch case. An unavailable genesis join block or a failed chain read has no test of its own.

## Tests

- `installs the genesis it rebuilds from the genesis join block and the opening data`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P1, REQ-LIF-12-TSXRBG.T1.P1, UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4.P2
- `recovers a genesis join block it never received and installs`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P2, REQ-LIF-12-TSXRBG.T1.P2
- `aborts every runtime without installing when the opened hash matches no genesis`: UNIT-TEST-EVENT-HANDLER-2-Q270TR.P3, REQ-LIF-12-TSXRBG.T1.P3
