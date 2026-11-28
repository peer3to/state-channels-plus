# LightClientChannelFollow.test.ts

Test file: [test/lightClient/LightClientChannelFollow.test.ts](../../../../../../test/lightClient/LightClientChannelFollow.test.ts)
Exercises: [StateChannelEventListener.ts](../../../../implementation/source/src/StateChannelEventListener.ts.md), [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [LightClientSubscriptions.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClientSubscriptions.ts.md)

## Overview

The suite runs two participants with the light client on over a peer3 slot node started with
`--light-client`, with a proxy in front of the node for one participant. The participant starts
reading the chain, then selects, clears, switches and disposes its channel listener through the
validation probe. The oracle is the subscribes and unsubscribes the proxy forwarded, in order, with
the contract address and channel key the participant reports: the participant holds one subscription
of its state channel manager and subscribes it again whenever the followed topics change. It runs only
with `--lc-tests --parachain` and `PEER3_NODE_LIGHT_CLIENT=1` (forwarded on a distributed run), and
fails at once otherwise.

## Tests

- `subscribes its state channel manager with no topic when it starts reading the chain`: REQ-LC-8-BBYC51.T1.P5
- `subscribes the channel contract with the channel's id as topic when it selects the channel`: REQ-LC-8-BBYC51.T1.P1
- `ends the channel's subscription when the selection is cleared`: REQ-LC-8-BBYC51.T1.P2
- `ends the channel's subscription when the channel listener is disposed`: REQ-LC-8-BBYC51.T1.P3
- `ends the channel's subscription before it subscribes another channel it selects`: REQ-LC-8-BBYC51.T1.P4
