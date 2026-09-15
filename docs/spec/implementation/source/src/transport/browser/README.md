# src/transport/browser — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The browser adapter converts MessagePort events and transfer lists to RuntimePort. It preserves listener-before-start ordering and best-effort close behavior.

## Source inventory

| Source | Report |
| --- | --- |
| [RuntimeChannel.ts](../../../../../../../src/transport/browser/RuntimeChannel.ts) | [RuntimeChannel.ts.md](./RuntimeChannel.ts.md) |

## Contents

- [RuntimeChannel.ts](./RuntimeChannel.ts.md)


## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
