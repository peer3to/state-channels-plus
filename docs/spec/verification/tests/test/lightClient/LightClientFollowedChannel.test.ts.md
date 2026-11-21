# LightClientFollowedChannel.test.ts

Test file: [test/lightClient/LightClientFollowedChannel.test.ts](../../../../../../test/lightClient/LightClientFollowedChannel.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md)

## Overview

The suite has the SDK's chain access follow a channel of a contract on a peer3 node of its own with
`--light-client`, behind one proxy per endpoint that records what the endpoint was asked and can
change what it pushes, end a subscription in the node's place or cut the connection. The oracles are the node's own answers and the requests
the proxy saw: a read the pushed partition answers asks the endpoint nothing. It runs only with
`--lc-tests`.

## Tests

- `takes a sync pushed before the subscription's id reached it and answers reads from it`: REQ-LC-5-MM0BM9.T1.P18
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
- `reads at the block the endpoint serving its requests pushed, not at a higher one another endpoint pushes`: REQ-LC-9-KWXV43.T1.P5
- `uses nothing a connection pushed once it ended: a read before the new sync is proven at the endpoint's best block`: REQ-LC-5-MM0BM9.T1.P16
- `opens a subscription the endpoint ended again, counts it and answers from its new sync`: REQ-LC-7-W8WDN3.T1.P4
- `reads a write right after its receipt from the push of the receipt's block`: REQ-LC-1-JT5PKT.T1.P17
- `reads at the endpoint's best block once the pushes stop, not at the last pushed block, and waits for them only once`: REQ-LC-1-JT5PKT.T1.P18
- `waits again for pushes once they arrive after a read stopped waiting, and reads from them`: REQ-LC-1-JT5PKT.T1.P20
- `waits for no push of a block only an endpoint that does not serve the requests names in its new heads`: REQ-LC-1-JT5PKT.T1.P19
- `opens a subscription whose pushes keep being refused again at most once per block time`: REQ-LC-7-W8WDN3.T1.P5
- `leaves an endpoint without the light client endpoints unsubscribed, and its reads to it once it serves the requests`: REQ-LC-4-E29Y46.T1.P7
- `answers a partition read while another read waits for its proof, and the waiting read keeps its block`: REQ-LC-9-KWXV43.T1.P6
- `starts following once the endpoint answers the methods question that failed when the channel was followed`: REQ-LC-5-MM0BM9.T1.P17
- `replays a transaction mined with no revert data at its receipt's block, past the pushed block, and sends nothing again`: REQ-LC-2-PMY1VG.T1.P6
- `counts a read of state the endpoint proved for an earlier read at the same block as a fallback read, and asks for no proof again`: REQ-LC-9-KWXV43.T1.P7
- `reads at the block of a log the serving endpoint delivered, waiting for its push`: REQ-LC-1-JT5PKT.T1.P21
- `leaves a read to the endpoint as a failed one when the endpoint's best block is below the block it has shown`: REQ-LC-1-JT5PKT.T1.P22
- `waits only once for a serving endpoint whose pushes stopped while another endpoint keeps pushing`: REQ-LC-1-JT5PKT.T1.P23
- `asks an endpoint whose connection reopened again whether it serves the light client, and answers from proven state once it does`: REQ-LC-4-E29Y46.T1.P8
- `opens a refused subscription again when the endpoint fails its unsubscribe, with a warning and no error`: REQ-LC-7-W8WDN3.T1.P7
- `hands on no push of a refused subscription that arrives before the endpoint ends it, and counts the refusal once`: REQ-LC-7-W8WDN3.T1.P6
