# StateTransitionService.ts

> **Source:** [src/rpc/network/services/stateTransition/StateTransitionService.ts](../../../../../../../../../src/rpc/network/services/stateTransition/StateTransitionService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/state-transition.md](../../../../../../views/architecture/sdk/rpc/state-transition.md)

## Requirements

- [`REQ-GOSSIP-1-HTK3NX` (Thin attributed ingress)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)

## UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS

Gating

- Setup: Dispatch pre/post handshake
- Oracle: Only authenticated senders reach the endpoint

- [ ] `UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS.P1` — gated pre-auth
- [ ] `UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS.P2` — authenticated pass
