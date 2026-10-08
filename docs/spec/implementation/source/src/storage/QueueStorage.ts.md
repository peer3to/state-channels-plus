# QueueStorage.ts

> **Source:** [src/storage/QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-QSTORE-1-PS769J`](../../../../specification/peer-communication/block-gossip.md#req-qstore-1-ps769j)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)
- [`REQ-QSTORE-3-DEKYG6` (Queue scheduling)](../../../../specification/storage/queue.md#req-qstore-3-dekyg6)
- [`REQ-BLOCK-PIPE-5-WJ31RG` (Pre-execution merge layer)](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg)

## UNIT-TEST-QUEUE-STORAGE-1-6W5SYT

Attributed monotone merge

- Setup: Queue copies of one block from several senders, orders permuted
- Oracle: Below the caps, converged signature set and attribution identical for every order; each source retains its first N supplied values and the first N source identities keep their slots; senders credited only with their copies, and only for signatures the entry retained; earliest firstSeenAt kept

- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P1` — disjoint copies
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P2` — order permutations converge
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P3` — attribution copy-scoping
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P4` — restore merges without extending lifetime
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P5` — overlapping copies
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P6` — duplicate copies
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P18` — calldata updates trusted time without inventing a supplier
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P24` — restore merges concurrent source maps without exceeding the source or signature limits
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P25` — a copy after dequeue forms an independent entry
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P26` — dequeued entries restore source attribution through the deep-copy Storage facade
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P27` — standalone proof input preserves its signatures without recording a network source
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P28` — clear removes queued entries and coordinate lookups
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P29` — restore preserves the earliest first-seen time and merges concurrent source attribution
- [x] `UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P30` — lowercase and checksummed sources share one signature allowance

## UNIT-TEST-QUEUE-STORAGE-2-K2F40F

Per-source contribution limits

- Setup: Real factory-built block copies, wallet signatures, explicit origins and N.
- Oracle: Each variation states the exact quota, representation, queue or isolation oracle.

- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P4` — counts the author first with maximum one
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P5` — keeps an empty-confirmation source with its author charge
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P6` — admits exact values below the source signature boundary
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P7` — admits exact values at the source signature boundary
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P8` — admits exact values above the source signature boundary
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P9` — repeated copies do not refill the same source allowance
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P10` — another admitted source keeps its own allowance
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P11` — distinct signatures from the same signer consume distinct slots
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P12` — shared signatures charge each actual supplier independently
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P13` — an author repeated in confirmations spends only one slot
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P15` — source capacity rejects a new identity without timestamp mutation
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P16` — an existing source can fill remaining slots after source capacity
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P17` — rejects a zero participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P18` — rejects a negative participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P19` — rejects a fractional participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P20` — rejects a NaN participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P21` — rejects a infinite participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P22` — rejects a unsafe integer participant maximum
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P23` — standalone default and explicit maxima are observable
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P24` — keeps the first author envelope and attributes an alternative only to its supplier
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P25` — retains exactly N squared values when N sources supply disjoint envelopes and confirmations
- [x] `UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P26` — equivalent signature encodings deduplicate

## UNIT-TEST-QUEUE-STORAGE-3-1S43MC

Dequeue rules

- Setup: Queue entries across forks/heights incl. two bodies at one coordinate
- Oracle: Exact and priority dequeues select correctly; both competing bodies dequeue together; clearFork removes queued entries on the selected fork

- [x] `UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P1` — exact coordinate
- [x] `UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P2` — lowest ≤ bound priority
- [x] `UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P3` — competing bodies coexist and both return
- [x] `UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P4` — fork clear completeness
- [x] `UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P5` — empty coordinate

## UNIT-TEST-QUEUE-STORAGE-32-5EKHV0

Queued block timestamp merge

- Setup: Queue or restore factory-built copies of the same block and inspect the resulting timestamp; undefined preserves and defined zero replaces.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P1` — restoring a copy without time preserves the queued timestamp
- [x] `UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P2` — restoring a copy with zero time replaces the queued timestamp
- [x] `UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P3` — duplicate queue insertion preserves time when the incoming copy has none
- [x] `UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P4` — merge preserves the existing rule for zero timestamp
- [x] `UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P5` — merge preserves the existing rule for defined timestamp

## UNIT-TEST-QUEUE-STORAGE-33-HR26G3

Per-source contribution limits

- Setup: Real factory-built block copies, wallet signatures, explicit origins and N.
- Oracle: Each variation states the exact quota, representation, queue or isolation oracle.

- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P18` — retains fixed-size unrecoverable bytes within the supplier quota
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P19` — removing invalid confirmations does not refund their charge
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P22` — storage copies cannot mutate queued blocks or attribution
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P23` — short signature values consume only their source budget
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P24` — empty signature values consume only their source budget
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P25` — oversized signature values consume only their source budget
- [x] `UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P26` — nonhex signature values consume only their source budget
