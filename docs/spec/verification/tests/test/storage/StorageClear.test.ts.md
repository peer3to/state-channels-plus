# test/storage/StorageClear.test.ts — Test Report

> **Test file:** [test/storage/StorageClear.test.ts](../../../../../../test/storage/StorageClear.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Storage.ts](../../../../implementation/source/src/storage/Storage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Nineteen direct literal cases drive `Storage.clear()` on a real `Storage` built per test, with no mocks:
each case populates one module through that module's own public writer (factory-built domain objects),
reads the datum back to prove it was there, calls `clear()`, and reads again through the same public reader.
The oracle is always a single structural comparison of the before and after reads, so an assertion cannot
pass on an absent pre-state. All fifteen channel-scoped modules are covered — blocks with their fork height watermark,
snapshots with the fork genesis index, machine states, participant set change points, the queue with its
coordinate index, disputes with the self-dispute marker, fraud proofs with their participant index, dispute
fraud proofs, fork timeouts, the force-exit marker, the force-join submission state, block calldata, the
per-channel chain watermark, and both message-block stores with their latest markers. Two cases cover what
the clear keeps: a recorded blacklist verdict is read back with its reason afterwards, and the rebuilt queue
store keeps the participant bound the facade was constructed with. Three further cases
take the boundaries: clearing twice is inert, a write after the clear is accepted and read back while the
pre-clear datum stays gone, and clearing a never-written instance changes nothing. Out of scope here: the
ordering around the clear (which producer stops first) and the runtime projection after a channel reset —
those belong to `StateManagerChannelReset.test.ts`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                             | Covers                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Storage.clear > drops stored blocks and their fork height watermark`](../../../../../../test/storage/StorageClear.test.ts#L26) (line 26)                   | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P1`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p1)   |
| [`Storage.clear > drops stored state snapshots including the fork genesis`](../../../../../../test/storage/StorageClear.test.ts#L44) (line 44)               | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P2`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p2)   |
| [`Storage.clear > drops stored state machine states`](../../../../../../test/storage/StorageClear.test.ts#L69) (line 69)                                     | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P3`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p3)   |
| [`Storage.clear > drops recorded participant set change points`](../../../../../../test/storage/StorageClear.test.ts#L84) (line 84)                          | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P4`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p4)   |
| [`Storage.clear > drops queued blocks and their coordinate index`](../../../../../../test/storage/StorageClear.test.ts#L97) (line 97)                        | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P5`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p5)   |
| [`Storage.clear > drops stored disputes and the disputed fork marker`](../../../../../../test/storage/StorageClear.test.ts#L117) (line 117)                  | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P6`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p6)   |
| [`Storage.clear > drops stored fraud proofs and their participant index`](../../../../../../test/storage/StorageClear.test.ts#L136) (line 136)               | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P7`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p7)   |
| [`Storage.clear > drops stored dispute fraud proofs`](../../../../../../test/storage/StorageClear.test.ts#L151) (line 151)                                   | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P8`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p8)   |
| [`Storage.clear > drops stored fork timeouts`](../../../../../../test/storage/StorageClear.test.ts#L167) (line 167)                                          | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P9`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p9)   |
| [`Storage.clear > drops the force exit marker`](../../../../../../test/storage/StorageClear.test.ts#L179) (line 179)                                         | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P10`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p10) |
| [`Storage.clear > drops the force join submission state`](../../../../../../test/storage/StorageClear.test.ts#L191) (line 191)                               | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P11`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p11) |
| [`Storage.clear > drops stored block calldata`](../../../../../../test/storage/StorageClear.test.ts#L212) (line 212)                                         | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P12`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p12) |
| [`Storage.clear > drops the latest processed chain block per channel`](../../../../../../test/storage/StorageClear.test.ts#L237) (line 237)                  | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P13`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p13) |
| [`Storage.clear > drops inbound and outbound message blocks with their latest markers`](../../../../../../test/storage/StorageClear.test.ts#L250) (line 250) | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P14`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p14) |
| [`Storage.clear > keeps recorded blacklist verdicts`](../../../../../../test/storage/StorageClear.test.ts#L287) (line 287)                                   | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P18`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p18) |
| [`Storage.clear > rebuilds the queue with the contract's participant bound`](../../../../../../test/storage/StorageClear.test.ts#L299) (line 299)            | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P19`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p19) |
| [`Storage.clear > stays empty when cleared twice`](../../../../../../test/storage/StorageClear.test.ts#L307) (line 307)                                      | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P15`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p15) |
| [`Storage.clear > accepts new entries after clearing`](../../../../../../test/storage/StorageClear.test.ts#L321) (line 321)                                  | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P16`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p16) |
| [`Storage.clear > leaves an untouched storage instance empty`](../../../../../../test/storage/StorageClear.test.ts#L340) (line 340)                          | [`UNIT-TEST-STORAGE-FACADE-3-9N4C6W.P17`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-3-9n4c6w.p17) |
