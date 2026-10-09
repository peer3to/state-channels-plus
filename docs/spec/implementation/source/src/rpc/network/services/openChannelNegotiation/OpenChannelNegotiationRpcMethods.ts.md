# OpenChannelNegotiationRpcMethods.ts

> **Source:** [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../../../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/open-channel-negotiation.md](../../../../../../views/architecture/sdk/rpc/open-channel-negotiation.md)

## Requirements

- [`REQ-NEG-4-ZQ0985` (Committed-attempt admission and recovery)](../../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985)
- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)

## UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69

Frame routing

- Setup: Frames from counterparty/third-party/wrong channel per endpoint
- Oracle: Only current-counterparty, right-channel frames act; busy replies on contention

- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P1` — negotiateRequest counterparty filter
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P2` — wrong channel ignore
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P3` — busy reply
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P4` — proposal slot claim
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P5` — negotiateAccept counterparty filter
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-METHODS-1-XSWE69.P6` — openProposal counterparty filter
