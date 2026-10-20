# LoggerService.test.ts

Test file: [LoggerService.test.ts](../../../../../../../test/utils/logging/LoggerService.test.ts)

## Overview

Real SDK roots and their actual message ports exercise store attachment, local outcomes, generation suppression, late connections, cycles, errors and disposal. A real HTTP receiver holds or rejects uploads. Root observations only expose real endpoints; no replacement router or logger service is used. Independent SDK roots are connected explicitly when testing shared gossip. The flush cases hold the worker realm's POST at the receiver and check that the flush settles only after it is released, and that it settles within a second, with no error reported, when the connection to that realm closes instead. With the host's flush handler replaced, a rejection is reported through the main root's error channel within half the bound while the flush still resolves, waiting its bound while the main realm's POST is held, and that POST reaches the receiver; and a handler that never answers ends it at its shortened bound. A host answer that arrives after its requester's connection closed reports no error, a slow answer that lands after the requester's logger was disposed logs nothing through it, and a logger with no coordination service refuses to flush. A flush across a real cycle of root connections posts once per realm and leaves no request pending on the client router.

## Tests

- `attaches one shared store and preserves children until final disposal`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P1, REQ-LOG-1-H2VQ8X.T2.P4
- `rejects attaching a logger family to a second service`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P2
- `detaches surviving loggers when the service is disposed`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P3
- `a standalone logger uploads without collecting an unrelated SDK`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P4
- `uploads a connected realm's logger`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P5, INV-LOG-1-P4WT6R.T1.P1
- `reaches a realm two ports away`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P6, INV-LOG-1-P4WT6R.T1.P2
- `a leaf upload reaches its parent roots`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P7, INV-LOG-1-P4WT6R.T1.P3
- `returns the local result while a remote POST is still pending`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P8, REQ-LOG-2-N6BJ3D.T1.P1
- `coalesces nearby local triggers into one gossip generation`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P9, INV-LOG-2-C7KZ9M.T2.P1
- `advances for a fresh local trigger after the window`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P10, INV-LOG-2-C7KZ9M.T2.P2
- `ignores equal and older generations after the window`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P11, INV-LOG-2-C7KZ9M.T2.P3
- `ignores an old frame released after a newer generation and delay`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P12, INV-LOG-2-C7KZ9M.T2.P4
- `adopts a higher generation without incrementing it`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P13, INV-LOG-2-C7KZ9M.T2.P5
- `synchronizes a newly connected root before its first local trigger`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P14, INV-LOG-2-C7KZ9M.T2.P6
- `rejects invalid upload generations through the RPC boundary`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P15, INV-LOG-2-C7KZ9M.T2.P7
- `does not wrap an exhausted upload index`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P16, INV-LOG-2-C7KZ9M.T2.P8
- `terminates gossip across a cycle of real root connections`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P17, INV-LOG-2-C7KZ9M.T2.P9
- `a flush settles only once every connected realm has posted its logs`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P35, REQ-LOG-11-F5TJQC.T1.P1
- `a flush skips a neighbour that closes while its upload is held`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P37, REQ-LOG-11-F5TJQC.T1.P5
- `a flush reports a neighbour's failure at once and still waits for the other uploads`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P38, REQ-LOG-11-F5TJQC.T1.P7, REQ-LOG-11-F5TJQC.T1.P9
- `a flush ends at its bound when a neighbour never answers`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P39, REQ-LOG-11-F5TJQC.T1.P8
- `a flush answer to a requester whose connection closed reports no error`: UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76.P2, REQ-LOG-11-F5TJQC.T1.P13
- `a slow flush answer that lands after its requester's logger was disposed warns nothing`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P5
- `a logger without a coordination service refuses to flush`: UNIT-TEST-LOGGER-1-4MNRMD.P11, REQ-LOG-11-F5TJQC.T1.P12
- `a flush across a cycle of real root connections settles once`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P36, REQ-LOG-11-F5TJQC.T1.P2
- `concurrent roots upload without waiting on one another`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P18, INV-LOG-2-C7KZ9M.T1.P1, REQ-LOG-2-N6BJ3D.T1.P5
- `keeps at most one follow-up when higher generations arrive during a POST`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P19, INV-LOG-2-C7KZ9M.T2.P10
- `cancels a pending service upload on disposal`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P20
- `a disabled store still relays uploads to enabled neighbours`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P21
- `a child logger does not add a second upload`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P22
- `an attached error triggers local and remote uploads`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P23
- `a failed local upload preserves entries for a later attempt`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P24, REQ-LOG-2-N6BJ3D.T1.P2, REQ-LOG-2-N6BJ3D.T1.P4
- `a synchronous post failure does not block the local upload`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P25
- `context set after connecting reaches the leaf before its first upload`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P26, REQ-LOG-4-W5XR7Q.T1.P2
- `does not apply a peer address arriving from a child`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P27
- `a second root in the same realm follows the channel`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P28
- `reaches a VM worker owned by an inline SDK`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P29
- `connected SDK roots share the caller store without registering it twice`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P30
- `a leaf crash retains late channel identity and triggers its client upload`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P31
- `does not pass peer identity between inline roots`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P32
- `rapid channel updates reach both neighbours without echoing to their sender`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P33, REQ-LOG-4-W5XR7Q.T1.P6
- `updates the channel of every local store attached to the service`: UNIT-TEST-LOGGER-GOSSIP-1-MGTRF0.P34
