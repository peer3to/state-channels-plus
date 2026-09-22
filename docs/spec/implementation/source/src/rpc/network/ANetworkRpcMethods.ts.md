# ANetworkRpcMethods.ts

> **Source:** [src/rpc/network/ANetworkRpcMethods.ts](../../../../../../../src/rpc/network/ANetworkRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)

## UNIT-TEST-ARPC-METHODS-1-T4V713

Sender binding

- Setup: Construct per dispatch with distinct transports
- Oracle: Each instance reports exactly its own sender; no cross-dispatch state

- [ ] `UNIT-TEST-ARPC-METHODS-1-T4V713.P1` — distinct senders isolated
- [ ] `UNIT-TEST-ARPC-METHODS-1-T4V713.P2` — remoteRpc passthrough
