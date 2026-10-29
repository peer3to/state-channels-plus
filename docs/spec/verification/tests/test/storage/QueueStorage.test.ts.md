# QueueStorage.test.ts

Test file: [test/storage/QueueStorage.test.ts](../../../../../../test/storage/QueueStorage.test.ts)
Exercises: [QueueStorage.ts](../../../../implementation/source/src/storage/QueueStorage.ts.md)

## Overview

Real factory-built blocks and wallet signatures exercise source quotas, byte equality, exact supplier attribution, trusted timestamps, ordinary dequeue/restore behavior, and the isolated Storage facade. The store performs no signer recovery. Network admission and sync are covered by the queue-manager suites.

## Tests

- `counts the author first with maximum one`: REQ-QSTORE-2-VYWJAQ.T1.P12, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P4
- `keeps an empty-confirmation source with its author charge`: REQ-QSTORE-2-VYWJAQ.T1.P13, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P5
- `admits exact values below the source signature boundary`: REQ-QSTORE-2-VYWJAQ.T1.P14, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P6
- `admits exact values at the source signature boundary`: REQ-QSTORE-2-VYWJAQ.T1.P15, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P7
- `admits exact values above the source signature boundary`: REQ-QSTORE-2-VYWJAQ.T1.P16, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P8
- `repeated copies do not refill the same source allowance`: REQ-QSTORE-2-VYWJAQ.T1.P17, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P9, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P6, REQ-QSTORE-1-PS769J.T1.P5
- `another admitted source keeps its own allowance`: REQ-QSTORE-2-VYWJAQ.T1.P18, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P10
- `distinct signatures from the same signer consume distinct slots`: REQ-QSTORE-2-VYWJAQ.T1.P19, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P11
- `shared signatures charge each actual supplier independently`: REQ-QSTORE-2-VYWJAQ.T1.P20, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P12, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P5, REQ-QSTORE-1-PS769J.T1.P4
- `an author repeated in confirmations spends only one slot`: REQ-QSTORE-2-VYWJAQ.T1.P21, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P13
- `equivalent signature encodings deduplicate`: REQ-QSTORE-2-VYWJAQ.T1.P45, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P26
- `source capacity rejects a new identity without timestamp mutation`: REQ-QSTORE-2-VYWJAQ.T1.P23, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P15
- `an existing source can fill remaining slots after source capacity`: REQ-QSTORE-2-VYWJAQ.T1.P24, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P16
- `short signature values consume only their source budget`: REQ-QSTORE-2-VYWJAQ.T1.P41, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P23
- `empty signature values consume only their source budget`: REQ-QSTORE-2-VYWJAQ.T1.P42, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P24
- `oversized signature values consume only their source budget`: REQ-QSTORE-2-VYWJAQ.T1.P43, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P25
- `nonhex signature values consume only their source budget`: REQ-QSTORE-2-VYWJAQ.T1.P44, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P26
- `retains fixed-size unrecoverable bytes within the supplier quota`: REQ-QSTORE-2-VYWJAQ.T1.P29, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P18
- `removing invalid confirmations does not refund their charge`: REQ-QSTORE-2-VYWJAQ.T1.P30, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P19
- `restore merges concurrent copies within each source allowance`: REQ-QSTORE-2-VYWJAQ.T1.P40, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P24
- `copies after dequeue form an independent queued entry`: REQ-QSTORE-3-DEKYG6.T1.P14, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P25
- `dequeued entries restore attribution through the Storage proxy`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P26
- `Storage isolates returned block and source maps`: REQ-QSTORE-2-VYWJAQ.T1.P35, UNIT-TEST-QUEUE-STORAGE-33-HR26G3.P22
- `merge preserves the existing rule for missing timestamp`: REQ-QSTORE-1-PS769J.T1.P6, UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P3
- `merge preserves the existing rule for zero timestamp`: UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P4
- `merge preserves the existing rule for defined timestamp`: UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P5
- `restore with zero timestamp replaces a concurrently supplied timestamp`: UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P2
- `restore without timestamp preserves a concurrently supplied timestamp`: UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P1
- `exact dequeue removes the entry and returns its attribution`: REQ-QSTORE-3-DEKYG6.T1.P15, REQ-QSTORE-3-DEKYG6.T1.P4, UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P1, UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P5
- `priority dequeue chooses the lowest eligible height`: REQ-QSTORE-3-DEKYG6.T1.P2, UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P2
- `two hashes at the same coordinates remain separate`: UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P3
- `standalone proof input preserves signatures without inventing a source`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P27
- `calldata updates trusted time without inventing a supplier`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P18
- `clear removes queued entries and their coordinate index`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P28
- `rejects a zero participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P17
- `rejects a negative participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P18
- `rejects a fractional participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P19
- `rejects a NaN participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P20
- `rejects a infinite participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P21
- `rejects a unsafe integer participant maximum`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P22
- `standalone default and explicit maxima are observable`: UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P23
- `keeps the first author envelope and attributes an alternative only to its supplier`: REQ-QSTORE-2-VYWJAQ.T1.P36, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P24
- `retains exactly N squared values when N sources supply disjoint envelopes and confirmations`: REQ-QSTORE-2-VYWJAQ.T1.P37, UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P25
- `reversing below-limit copies preserves the union and exact supplier attribution`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P1, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P2, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P3, REQ-QSTORE-1-PS769J.T1.P1, REQ-QSTORE-1-PS769J.T1.P2, REQ-QSTORE-1-PS769J.T1.P3
- `fork cleanup removes only queued entries on the selected fork`: REQ-QSTORE-3-DEKYG6.T1.P16, UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P4
- `restore preserves the earliest first seen time when concurrent copies arrive`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P4, UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P29
- `lowercase and checksummed sources share one signature allowance`: UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P30
