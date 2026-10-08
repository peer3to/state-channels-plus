# test/unit/TimeoutStorage.test.ts — Test Report

> **Test file:** [test/unit/TimeoutStorage.test.ts](../../../../../../test/unit/TimeoutStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [TimeoutStorage.ts](../../../../implementation/source/src/storage/TimeoutStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Pure data-structure suite — no harness session. Constructs `TimeoutStorage` directly and drives it
with real `TimeoutStruct` values taken from the `dispute()` factory and real wallet addresses from
`randomAddress()`, so every candidate could have been submitted as-is. The suite covers the newest
candidate store: a later store at a higher height replaces a stale lower one, an equal-height store
refreshes the candidate, and forks are independent. It also covers the identity-matched drop a
posted-calldata refusal performs: the refused candidate is removed, while a forced candidate stored
over the same slot, a candidate at another height, and a candidate for another participant at the
same height all survive. The end-to-end case — a stale candidate for a passed height does not block
the next-height timeout dispute — is in
[ParticipantTimeoutService](ParticipantTimeoutService.test.ts.md).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded.

| Test declaration                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: TimeoutStorage > a store at a higher height → replaces the stale lower timeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L15) (line 15)                          | [`REQ-TOSTORE-3-H0MH84.T1.P1`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84.t1.p1), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P1`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > a store at the same height → refreshes the stored timeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L25) (line 25)                              | [`REQ-TOSTORE-3-H0MH84.T1.P2`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84.t1.p2), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P2`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > a store on another fork → leaves this fork's timeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L35) (line 35)                                   | [`REQ-TOSTORE-3-H0MH84.T1.P3`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84.t1.p3), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P3`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > deleteTimeout with the stored plain timeout → removed`](../../../../../../test/unit/TimeoutStorage.test.ts#L47) (line 47)                                  | [`REQ-TOSTORE-2-WX7VMH.T1.P1`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p1), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P4`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > a forced timeout stored over the plain one at the same height → survives deleteTimeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L56) (line 56) | [`REQ-TOSTORE-2-WX7VMH.T1.P2`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p2), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P5`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > deleteTimeout at another height → the stored plain timeout stays`](../../../../../../test/unit/TimeoutStorage.test.ts#L67) (line 67)                       | [`REQ-TOSTORE-2-WX7VMH.T1.P3`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p3), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P6`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
| [`Unit: TimeoutStorage > a plain timeout for another participant at the same height → survives deleteTimeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L77) (line 77)    | [`REQ-TOSTORE-2-WX7VMH.T1.P4`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p4), [`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P7`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-2-pv6fvd) |
