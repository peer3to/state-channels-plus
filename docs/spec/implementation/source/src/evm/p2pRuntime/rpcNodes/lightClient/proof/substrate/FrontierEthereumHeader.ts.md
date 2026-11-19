# FrontierEthereumHeader.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierEthereumHeader.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierEthereumHeader.ts)

## Requirements

- [`REQ-STPROOF-6-CASBQP` (The block values a call reads are accepted only as the block commits to them)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-6-casbqp)

## UNIT-TEST-STPROOF-7-GW2MTN

Reading the Ethereum block header a Frontier chain's state holds

- Setup: The `CurrentBlock` entry of one block of a peer3 dev node, its read proof, the block's state root and the node's own `eth_getBlockByNumber` answer; the same entry with one part changed.
- Oracle: The header hashes to the node's Ethereum block hash and holds the node's block values; `assertHash` throws `StorageProofError` for another hash, and a cut entry throws it on construction.

- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P1` — the header of a recorded block hashes to the Ethereum block hash its node reports, in either letter case
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P2` — number, gas limit, coinbase and difficulty equal the node's answer
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P3` — the timestamp in milliseconds rounds down to the node's seconds
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P4` — the entry read from its recorded proof under the state root is the recorded entry
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P5` — a header checked against another hash
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P6` — one bit of the gas limit changed: another gas limit, another hash, refused for the recorded hash
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P7` — two bytes of extra data put before the last fields: the randomness after them is read
- [x] `UNIT-TEST-STPROOF-7-GW2MTN.P8` — an entry cut where the extra data would start, and an empty entry
