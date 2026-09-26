# test/unit/TimeoutStorage.test.ts — Test Report

> **Test file:** [test/unit/TimeoutStorage.test.ts](../../../../../../test/unit/TimeoutStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [TimeoutStorage.ts](../../../../implementation/source/src/storage/TimeoutStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Pure data-structure suite — no harness session. Constructs `TimeoutStorage` directly and drives it
with real `TimeoutStruct` values taken from the `dispute()` factory and real wallet addresses from
`randomAddress()`, so every candidate could have been submitted as-is. The suite covers the
identity-matched drop a posted-calldata refusal performs: the refused candidate is removed, while a
forced candidate stored over the same slot, a candidate at another height, and a candidate for
another participant at the same height all survive. Lowest-height retention itself is exercised by
the producing timeout suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded.

| Test declaration                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: TimeoutStorage > deleteTimeout with the stored plain timeout → removed`](../../../../../../test/unit/TimeoutStorage.test.ts#L15) (line 15)                                  | [`REQ-TOSTORE-2-WX7VMH.T1.P1`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p1), [`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P6`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-1-tax9c3.p6) |
| [`Unit: TimeoutStorage > a forced timeout stored over the plain one at the same height → survives deleteTimeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L24) (line 24) | [`REQ-TOSTORE-2-WX7VMH.T1.P2`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p2), [`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P7`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-1-tax9c3.p7) |
| [`Unit: TimeoutStorage > deleteTimeout at another height → the stored plain timeout stays`](../../../../../../test/unit/TimeoutStorage.test.ts#L35) (line 35)                       | [`REQ-TOSTORE-2-WX7VMH.T1.P3`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p3), [`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P8`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-1-tax9c3.p8) |
| [`Unit: TimeoutStorage > a plain timeout for another participant at the same height → survives deleteTimeout`](../../../../../../test/unit/TimeoutStorage.test.ts#L45) (line 45)    | [`REQ-TOSTORE-2-WX7VMH.T1.P4`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh.t1.p4), [`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P9`](../../../../implementation/source/src/storage/TimeoutStorage.ts.md#unit-test-timeout-storage-1-tax9c3.p9) |
