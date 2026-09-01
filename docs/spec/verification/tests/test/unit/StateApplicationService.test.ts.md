# test/unit/StateApplicationService.test.ts — Test Report

> **Test file:** [test/unit/StateApplicationService.test.ts](../../../../../../test/unit/StateApplicationService.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [StateApplicationService.ts](../../../../implementation/source/src/stateManager/snapshotUpdate/StateApplicationService.ts.md)

## Overview

The suite verifies that authenticated snapshots are validated and applied through the canonical state
application owner before spectator sync reports success. Invalid source or conflicting state follows the
existing failure path and cannot satisfy targeted connect.

This evidence supports [`REQ-TJOIN-3-DCZKS6`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: StateApplicationService > applying a snapshot that lists me → PARTICIPATING recomputed from a wrong SYNCED`](../../../../../../test/unit/StateApplicationService.test.ts#L11) (line 11)         | [`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P2`](../../../../implementation/source/src/stateManager/snapshotUpdate/StateApplicationService.ts.md#unit-test-state-application-service-1-b8v3dr.p2)                                                                                                                               |
| [`Unit: StateApplicationService > applying a snapshot that does not list me → SYNCED recomputed from a wrong PARTICIPATING`](../../../../../../test/unit/StateApplicationService.test.ts#L25) (line 25) | [`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P3`](../../../../implementation/source/src/stateManager/snapshotUpdate/StateApplicationService.ts.md#unit-test-state-application-service-1-b8v3dr.p3), [`REQ-TJOIN-3-DCZKS6.T1.P1`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6.t1.p1) |
| [`Unit: StateApplicationService > unsafeSetGenesisState stores a height-0 snapshot for the fork and swaps the active fork`](../../../../../../test/unit/StateApplicationService.test.ts#L90) (line 90)  | [`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P1`](../../../../implementation/source/src/stateManager/snapshotUpdate/StateApplicationService.ts.md#unit-test-state-application-service-1-b8v3dr.p1)                                                                                                                               |
