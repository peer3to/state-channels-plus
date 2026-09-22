# LoggerService.ts

> **Source:** [LoggerService.ts](../../../../../../../../../src/rpc/internal/services/logger/LoggerService.ts)

## Requirements

- [`INV-LOG-1-P4WT6R` (A collection reaches connected roots)](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)
- [`INV-LOG-2-C7KZ9M` (Collections never wait on one another)](../../../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m)
- [`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)
- [`REQ-LOG-2-N6BJ3D` (The caller receives its local upload outcome)](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)
- [`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)
- [`REQ-LOG-8-B7VN3J` (Works wherever the runtime works)](../../../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j)
- [`REQ-LOG-10-69CTN1` (A thread that is ending waits only for its own)](../../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)

## UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0

Optional store coordination, generations, cleanup and context

- Setup: Actual SDK roots, real ports and HTTP receiver
- Oracle: Local outcomes and actual receiver entries; no global completion claims

- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P1` — attaches one shared store and preserves children until final disposal
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P2` — rejects attaching a logger family to a second service
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P3` — detaches surviving loggers when the service is disposed
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P4` — a standalone logger uploads without collecting an unrelated SDK
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P5` — uploads a connected realm's logger
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P6` — reaches a realm two ports away
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P7` — a leaf upload reaches its parent roots
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P8` — returns the local result while a remote POST is still pending
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P9` — coalesces nearby local triggers into one gossip generation
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P10` — advances for a fresh local trigger after the window
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P11` — ignores equal and older generations after the window
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P12` — ignores an old frame released after a newer generation and delay
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P13` — adopts a higher generation without incrementing it
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P14` — synchronizes a newly connected root before its first local trigger
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P15` — rejects invalid upload generations through the RPC boundary
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P16` — does not wrap an exhausted upload index
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P17` — terminates gossip across a cycle of real root connections
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P18` — concurrent roots upload without waiting on one another
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P19` — keeps at most one follow-up when higher generations arrive during a POST
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P20` — cancels a pending service upload on disposal
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P21` — a disabled store still relays uploads to enabled neighbours
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P22` — a child logger does not add a second upload
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P23` — an attached error triggers local and remote uploads
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P24` — a failed local upload preserves entries for a later attempt
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P25` — a synchronous post failure does not block the local upload
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P26` — context set after connecting reaches the leaf before its first upload
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P27` — does not apply a peer address arriving from a child
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P28` — a second root in the same realm follows the channel
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P29` — reaches a VM worker owned by an inline SDK
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P30` — connected SDK roots share the caller store without registering it twice
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P31` — a leaf crash retains late channel identity and triggers its client upload
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P32` — does not pass peer identity between inline roots
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P33` — rapid channel changes at a worker root reach parent and child with the final value and produce no context echo to the sender
- [x] `UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P34` — updates the channel of every local store attached to the service
