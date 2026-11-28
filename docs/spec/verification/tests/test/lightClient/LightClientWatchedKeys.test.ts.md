# LightClientWatchedKeys.test.ts

Test file: [test/lightClient/LightClientWatchedKeys.test.ts](../../../../../../test/lightClient/LightClientWatchedKeys.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [LightClientSubscriptions.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClientSubscriptions.ts.md), [FrontierProvenStateReader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader.ts.md)

## Overview

The suite has the SDK's chain access follow a contract for itself on a peer3 node of its own with
`--light-client`, behind a proxy that records what the endpoint was asked and can leave the watch out
of the method list, answer or fail a watch in the node's place, or drop the node's messages. Transactions write slots no followed channel holds, so
every read of them needs a proof. The oracles are the node's own answers, the requests the proxy saw
and their order, the counters and the log. It runs only with `--lc-tests`.

## Tests

- `proves a read of a key no push holds through a watch on the followed contract's subscription and reads it from the pushes after`: REQ-LC-12-VPAAP0.T1.P1
- `proves a read with a plain read proof at every block where the endpoint does not list the watch`: REQ-LC-12-VPAAP0.T1.P2
- `watches the held keys again on the contract's new subscription once its first message arrived, and reads them from its pushes`: REQ-LC-12-VPAAP0.T1.P3
- `warns when a new subscription cannot be asked to watch the kept keys, and the next read watches them again`: REQ-LC-12-VPAAP0.T1.P13
- `proves a read with a plain read proof while the followed contract's subscription has had no message`: REQ-LC-12-VPAAP0.T1.P8
- `refuses a watch answered at another block than the read's, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P5
- `refuses a watch that names a key the read did not ask, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P6
- `refuses a watch whose proof does not decide the asked key, counts the failed read and answers through the endpoint`: REQ-LC-12-VPAAP0.T1.P7
- `keeps the followed contract's subscription without topics before a channel is followed and after the last one is unfollowed`: REQ-LC-5-MM0BM9.T1.P19, REQ-LC-12-VPAAP0.T1.P10
- `answers watched reads as the endpoint does at their blocks, with the reads compared`: REQ-LC-12-VPAAP0.T1.P9
- `watches the kept keys again on a new subscription however many blocks passed since their watch`: REQ-LC-12-VPAAP0.T1.P17
- `proves a read of more keys than one watch takes with a read proof`: REQ-LC-12-VPAAP0.T1.P11
- `watches more kept keys than one watch takes on a new subscription in several requests`: REQ-LC-12-VPAAP0.T1.P12
