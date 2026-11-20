# LightClientFollowedChannel.test.ts

Test file: [test/lightClient/LightClientFollowedChannel.test.ts](../../../../../../test/lightClient/LightClientFollowedChannel.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md)

## Overview

The suite has the SDK's chain access follow a channel of a contract on a peer3 node of its own with
`--light-client`, behind one proxy per endpoint that records what the endpoint was asked and can
change what it pushes or cut the connection. The oracles are the node's own answers and the requests
the proxy saw: a read the pushed partition answers asks the endpoint nothing. It runs only with
`--lc-tests`.

## Tests

- `answers reads of a followed channel's partition from the pushed state without a request to the node`: REQ-LC-9-KWXV43.T1.P1
- `runs a call from the channel's sender over the pushed partition without a request to the node`: REQ-LC-9-KWXV43.T1.P2
- `proves a read outside the partition at the pushed block, without asking for the best block`: REQ-LC-9-KWXV43.T1.P3
- `answers with the value another channel's transaction wrote to a held key`: REQ-LC-9-KWXV43.T1.P4
- `refuses a push the proof decides otherwise, subscribes again and keeps answering proven reads`: REQ-LC-7-W8WDN3.T1.P3
- `subscribes again on a socket that reopened and answers from its new sync`: REQ-LC-5-MM0BM9.T1.P10
- `reads at the node's best block again once the channel is unfollowed`: REQ-LC-5-MM0BM9.T1.P11
- `follows nothing on a node without the light client endpoints`: REQ-LC-5-MM0BM9.T1.P12
- `follows over two endpoints and keeps answering from pushed state when one of them goes`: REQ-LC-5-MM0BM9.T1.P13
- `keeps the other channel's subscription when one of two channels is unfollowed`: REQ-LC-5-MM0BM9.T1.P14
- `tries a subscription that failed on an open connection again`: REQ-LC-5-MM0BM9.T1.P15
- `keeps the stages of each accepted pushed block, in block order`: REQ-LC-10-YCP80W.T1.P1
