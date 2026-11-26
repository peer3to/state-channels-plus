# LightClientWatchedKeys.test.ts

Test file: [test/lightClient/LightClientWatchedKeys.test.ts](../../../../../../test/lightClient/LightClientWatchedKeys.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [LightClientSubscriptions.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClientSubscriptions.ts.md), [FrontierProvenStateReader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader.ts.md)

## Overview

The suite has the SDK's chain access follow a contract for itself on a peer3 node of its own with
`--light-client`, behind a proxy that records what the endpoint was asked and can leave the watch out
of the method list, answer or fail a watch in the node's place, or drop the node's messages; one node
runs with `--light-client-max-watched-keys 1`, and some with a watched-key expiry of two blocks, told to the provider through the watch's answer. The coming-calls cases tell the provider of calls and compare the watches the proxy saw, the proof requests and the counters before and after. Transactions write slots no followed channel holds, so
every read of them needs a proof. The oracles are the node's own answers, the requests the proxy saw
and their order, the counters and the log. It runs only with `--lc-tests`.

## Tests

- `proves a read of a key no push holds through a watch on the followed contract's subscription and reads it from the pushes after`: REQ-LC-12-VPAAP0.T1.P1
- `proves a read with a plain read proof at every block where the endpoint does not list the watch`: REQ-LC-12-VPAAP0.T1.P2
- `watches the held keys again on the contract's new subscription once its first message arrived, and reads them from its pushes`: REQ-LC-12-VPAAP0.T1.P3
- `warns when a new subscription cannot be asked to watch the kept keys, and the next read watches them again`: REQ-LC-12-VPAAP0.T1.P13
- `keeps watching a refused key at every read while the endpoint is at its cap, and answers it right`: REQ-LC-12-VPAAP0.T1.P4
- `proves a read with a plain read proof while the followed contract's subscription has had no message`: REQ-LC-12-VPAAP0.T1.P8
- `refuses a watch answered at another block than the read's, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P5
- `refuses a watch that names a key the read did not ask, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P6
- `refuses a watch whose proof does not decide the asked key, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P7
- `keeps the followed contract's subscription without topics before a channel is followed and after the last one is unfollowed`: REQ-LC-5-MM0BM9.T1.P19, REQ-LC-12-VPAAP0.T1.P10
- `answers watched reads as the endpoint does at their blocks, with the reads compared`: REQ-LC-12-VPAAP0.T1.P9
- `watches what coming calls read in one watch on the followed contract's subscription, and answers those calls from the pushes after`: REQ-LC-13-WAFW39.T1.P1
- `watches again in one watch what coming calls read where the pushes already decide it`: REQ-LC-13-WAFW39.T1.P8
- `takes the code and account of coming calls from the pushes, and watches only the slots they read`: REQ-LC-13-WAFW39.T1.P9
- `leaves a coming call that carries value out of the watch`: REQ-LC-13-WAFW39.T1.P4
- `warns and does not throw when the watch of coming calls fails, and their reads prove the slots`: REQ-LC-13-WAFW39.T1.P5
- `asks the node nothing ahead of coming calls while the followed contract's subscription has had no message`: REQ-LC-13-WAFW39.T1.P7
- `asks the node nothing ahead of coming calls where the endpoint does not list the watch`: REQ-LC-13-WAFW39.T1.P2
- `asks the node nothing ahead of coming calls while no contract is followed for itself`: REQ-LC-13-WAFW39.T1.P3
- `watches a key again at the read after a change once the endpoint's expiry passed since the last watch that named it`: REQ-LC-12-VPAAP0.T1.P14
- `watches again on a new subscription only the keys the endpoint still keeps current`: REQ-LC-12-VPAAP0.T1.P15
- `refuses a watch whose expiry is not a whole number of blocks, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P16
- `watches a key whose watch named no expiry again on a new subscription however many blocks passed`: REQ-LC-12-VPAAP0.T1.P17
