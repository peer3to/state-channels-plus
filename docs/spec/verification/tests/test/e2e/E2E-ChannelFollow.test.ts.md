# E2E-ChannelFollow.test.ts

Test file: [test/e2e/E2E-ChannelFollow.test.ts](../../../../../../test/e2e/E2E-ChannelFollow.test.ts)
Exercises: [StateChannelEventListener.ts](../../../../implementation/source/src/StateChannelEventListener.ts.md)

## Overview

The suite runs two participants on the test chain and records, on one participant's host, each
follow and stop call its chain access gets, letting each call run. The participant selects, clears,
switches and disposes its channel listener through the validation probe; one case races two selects.
The oracle is the recorded calls in order, with the contract address and channel key the participant
reports. The test chain's chain access ignores the calls, so the suite does not show a subscription
being made; that is the planned test on a peer3 node.

## Tests

- `tells the chain access to follow the channel it selects, with the channel's contract`: REQ-LC-8-BBYC51.T2.P1
- `tells the chain access to stop following when the selection is cleared`: REQ-LC-8-BBYC51.T2.P2
- `stops following the selected channel before it follows another one it selects`: REQ-LC-8-BBYC51.T2.P3
- `tells the chain access to stop following when the channel listener is disposed`: REQ-LC-8-BBYC51.T2.P4
- `follows nothing for a select a newer select overtook while it removed the old subscriptions`: REQ-LC-8-BBYC51.T2.P5
- `tells the chain access nothing when the selected channel is selected again`: REQ-LC-8-BBYC51.T2.P6
