# JoinChannelRpcMethods.ts

> **Source:** [src/rpc/network/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../../../../../src/rpc/network/services/joinChannel/JoinChannelRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/join-channel.md](../../../../../../views/architecture/sdk/rpc/join-channel.md)

## Requirements

- [`REQ-JOINSIG-3-VAGFVD` (Refusal is penalty-free)](../../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)

## UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0

Endpoint mapping

- Setup: Valid and failing requests
- Oracle: Signature or declared error; session kept

- [ ] `UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0.P1` — valid path
- [ ] `UNIT-TEST-JOIN-CHANNEL-METHODS-1-DCHGM0.P2` — failure→error mapping
