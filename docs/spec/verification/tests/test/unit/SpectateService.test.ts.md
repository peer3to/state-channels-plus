# test/unit/SpectateService.test.ts — Test Report

> **Test file:** [test/unit/SpectateService.test.ts](../../../../../../test/unit/SpectateService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SpectateService.ts](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Seven tests drive `SpectateService` through its single request shape and real multi-peer channels.
The focused policy cases prove that omitted exact fields request current state, supplied fields pin
recovery, and exact-recovery failure preserves a synced observer because the caller owns the failure
consequence. The remaining tests cover snapshot races and responder recovery/refusal.

The other three cover responder recovery and refusal while dispute events are held: an on-chain
commitment missing from local storage is recovered before proof generation; an unreadable dispute
window returns `null` without throwing or producing a fraud proof; and a fork that only the chain
knows is disputed is declined instead of being proved as the tip. These responder recovery cases
remain unassigned because the current component tables cover target selection and payload
validation, not event-recovery of dispute-window inputs.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Unit: SpectateService > sync request policy > one sync request supports initial load and exact recovery`](../../../../../../test/unit/SpectateService.test.ts#L21) (line 21)                                | [`INV-SYNC-2-AT3RXE.T1.P1`](../../../../specification/peer-communication/synchronization.md#inv-sync-2-at3rxe.t1.p1)                                                                                                                                                                                                                                                                                                                                               |
| [`Unit: SpectateService > sync request policy > exact recovery failure preserves a synced observer runtime`](../../../../../../test/unit/SpectateService.test.ts#L28) (line 28)                               | [`INV-SYNC-3-A7A2ED.T1.P4`](../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p4)                                                                                                                                                                                                                                                                                                                                               |
| [`Unit: SpectateService > applySyncResponse > the same-fork target snapshot lands before validation → accepts the proof`](../../../../../../test/unit/SpectateService.test.ts#L107) (line 107)                | [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P13`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p13), [`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P8`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd.p8), [`REQ-SPC-1-H10R5K.T1.P6`](../../../../implementation/views/architecture/sdk/rpc/spectate.md#req-spc-1-h10r5k.t1.p6) |
| [`Unit: SpectateService > tryMulticallSnapshotUpdate > the exact target snapshot lands first → accepts the benign height race`](../../../../../../test/unit/SpectateService.test.ts#L200) (line 200)          | [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P14`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p14)                                                                                                                                                                                                                                                                                             |
| [`Unit: SpectateService > generateSyncPayload > committed dispute missing locally → recovers before generating the payload`](../../../../../../test/unit/SpectateService.test.ts#L256) (line 256)             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Unit: SpectateService > generateSyncPayload > dispute window unavailable → payload refused, no throw`](../../../../../../test/unit/SpectateService.test.ts#L402) (line 402)                                 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Unit: SpectateService > generateSyncPayload > all dispute events suppressed → still declines the disputed fork instead of proving it`](../../../../../../test/unit/SpectateService.test.ts#L455) (line 455) | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
