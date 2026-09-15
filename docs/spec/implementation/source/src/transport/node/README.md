# src/transport/node — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The Node adapter converts worker_threads MessagePort events and transfer lists to the neutral RuntimePort contract. It owns listener subscription and removal, and starts the port after installing listeners.

## Source inventory

| Source | Report |
| --- | --- |
| [RuntimeChannel.ts](../../../../../../../src/transport/node/RuntimeChannel.ts) | [RuntimeChannel.ts.md](./RuntimeChannel.ts.md) |

## Contents

- [RuntimeChannel.ts](./RuntimeChannel.ts.md)


## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
