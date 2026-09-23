# src/rpc/network/services/stateTransition — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [StateTransitionRpcMethods.ts](./StateTransitionRpcMethods.ts.md)
- [StateTransitionService.ts](./StateTransitionService.ts.md)

## Source inventory

| Source | Report |
| --- | --- |
| [StateTransitionRpcMethods.ts](../../../../../../../../../src/rpc/network/services/stateTransition/StateTransitionRpcMethods.ts) | [StateTransitionRpcMethods.ts.md](./StateTransitionRpcMethods.ts.md) |
| [StateTransitionService.ts](../../../../../../../../../src/rpc/network/services/stateTransition/StateTransitionService.ts) | [StateTransitionService.ts.md](./StateTransitionService.ts.md) |

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [StateTransitionRpcMethods.ts](StateTransitionRpcMethods.ts.md) | The endpoint supplies an explicit network origin and the authenticated transport address. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
