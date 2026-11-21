# LocalReadParser.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser.ts)

## Requirements

- [`REQ-LC-1-JT5PKT` (Reads at the latest block are answered from proven state of one block)](../../../../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt)
- [`REQ-LC-2-PMY1VG` (What cannot be answered from proven state goes to the endpoint)](../../../../../../../specification/runtime/light-client.md#req-lc-2-pmy1vg)

## UNIT-TEST-LC-1-CNNW3S

Deciding which JSON-RPC reads the light client answers itself

- Setup: JSON-RPC payloads as a provider sends them, for the five reads the light client may answer and for other methods, with each tag, call field and parameter shape the parser decides on.
- Oracle: `parseLocalRead` gives a read to run for a latest-block read whose every part the local run honours, and `undefined`, so that the node answers, for everything else; `parseCall` decodes the call the local run makes, and `callAnswer` turns its outcome into the node's answer.

- [x] `UNIT-TEST-LC-1-CNNW3S.P1` — a call at the latest block, tag absent or `latest`, with and without `from`, `value`, `type` and `chainId`, and with no data: `from`, `to`, the data and the value reach the local call, the value as a number
- [x] `UNIT-TEST-LC-1-CNNW3S.P2` — a call that carries its data as `input`: the local call runs with that data
- [x] `UNIT-TEST-LC-1-CNNW3S.P3` — storage (shortest and longest slot), balance, code and transaction count at the latest block
- [x] `UNIT-TEST-LC-1-CNNW3S.P4` — a call, storage, balance, code and transaction count tagged `pending`
- [x] `UNIT-TEST-LC-1-CNNW3S.P5` — a call, storage and balance at `earliest`, `safe`, `finalized`, a block number, and an EIP-1898 block number or hash
- [x] `UNIT-TEST-LC-1-CNNW3S.P6` — a call with `gas`
- [x] `UNIT-TEST-LC-1-CNNW3S.P7` — a call with `gasPrice` (also zero), `maxFeePerGas` or `maxPriorityFeePerGas`
- [x] `UNIT-TEST-LC-1-CNNW3S.P8` — a call with `nonce`, `accessList`, `blobVersionedHashes` or `authorizationList`
- [x] `UNIT-TEST-LC-1-CNNW3S.P9` — a call with a third parameter, state overrides
- [x] `UNIT-TEST-LC-1-CNNW3S.P10` — a call without `to`
- [x] `UNIT-TEST-LC-1-CNNW3S.P11` — a call whose target or sender is no 20-byte hex, whose data is no whole-byte hex, whose value is no hex quantity, or that is no object
- [x] `UNIT-TEST-LC-1-CNNW3S.P12` — a storage read with a slot of no or 65 hex digits or a number, and account reads with an address that is no 20-byte hex
- [x] `UNIT-TEST-LC-1-CNNW3S.P13` — storage, balance, code and transaction count reads with one parameter too many
- [x] `UNIT-TEST-LC-1-CNNW3S.P14` — `eth_blockNumber`, `eth_getLogs`, `eth_estimateGas`, `eth_getProof` and `chain_getHeader`
- [x] `UNIT-TEST-LC-1-CNNW3S.P15` — a returned call answers its data; a reverted call answers the node's revert error, code 3 with the revert data
- [x] `UNIT-TEST-LC-1-CNNW3S.P16` — a call that failed locally without reverting throws `NotLocalError`, so that the node runs it
