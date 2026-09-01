# src/stateManager/ingest — Subsystem

> **Status:** Authored — engineer verification pending.

## Contents

- [BlockQueueManager.ts](./BlockQueueManager.ts.md)
- [ValidationService.ts](./ValidationService.ts.md)

This subsystem owns queued block ingress and exact-peer block/fork recovery. Recovery remains separate from
initial channel-load synchronization.
