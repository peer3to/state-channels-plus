# src/rpc/network/services — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [index.ts](./index.ts.md)
- [WebRTCSetup](./WebRTCSetup/README.md)
- [initHandshake](./initHandshake/README.md)
- [isForkDisputedService](./isForkDisputedService/README.md)
- [joinChannel](./joinChannel/README.md)
- [lobbyMatching](./lobbyMatching/README.md)
- [openChannelNegotiation](./openChannelNegotiation/README.md)
- [spectate](./spectate/README.md)
- [stateTransition](./stateTransition/README.md)

## Source inventory

| Source | Report |
| --- | --- |
| [index.ts](../../../../../../../../src/rpc/network/services/index.ts) | [index.ts.md](./index.ts.md) |

## Removed declaration or barrel

The removed `src/rpc/services/index.ts` was a network-service export barrel. Services now live in this category directory; the accepted WebRTC broker root lives under rpc/internal/roots. No service behavior is owned by the removed barrel.
