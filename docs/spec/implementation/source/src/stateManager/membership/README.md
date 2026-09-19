# src/stateManager/membership — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility

Owns local membership lifecycle and authoritative participant-set reads.

## Contents

- [LeaveChannelService.ts](./LeaveChannelService.ts.md)

- [index.ts](./index.ts.md)

- [MembershipService.ts](./MembershipService.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [MembershipService.ts](MembershipService.ts.md) | Source eligibility is the inclusive OR of the chain current/pending cache and the current verified off-chain union, with known slashes first. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
