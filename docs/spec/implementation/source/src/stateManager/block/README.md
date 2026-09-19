# src/stateManager/block — Subsystem

> **Status:** Authored — engineer verification pending.

## Contents

- [BlockCommitService.ts](./BlockCommitService.ts.md)

This subsystem owns committed-block effects, including later cooperative promotion from
`PENDING_PARTICIPANT` to `PARTICIPATING`.

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [BlockCommitService.ts](BlockCommitService.ts.md) | After canonical block storage, a live or spectate commit publishes the normalized previous/resulting union. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
