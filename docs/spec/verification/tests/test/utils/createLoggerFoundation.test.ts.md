# test/utils/createLoggerFoundation.test.ts — Test Report

> **Test file:** [createLoggerFoundation.test.ts](../../../../../../test/utils/createLoggerFoundation.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [createLoggerFoundation.ts.md](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md)

## Overview

Build real stores under temporary config values; inspect defaults, explicit false, uploader options, disabled storage, fallback size and distinct instances.

## Tests and covered test IDs

| Test declaration                                                                                                                                                   | Covers                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`createLoggerFoundation > uses config defaults and allocates a distinct store per call`](../../../../../../test/utils/createLoggerFoundation.test.ts#L6) (line 6) | [`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P1`](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md#unit-test-create-logger-foundation-32-1nhgfc.p1) |
| [`createLoggerFoundation > preserves explicit false and uploader options`](../../../../../../test/utils/createLoggerFoundation.test.ts#L18) (line 18)              | [`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P2`](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md#unit-test-create-logger-foundation-32-1nhgfc.p2) |
| [`createLoggerFoundation > disables storage when upload is disabled`](../../../../../../test/utils/createLoggerFoundation.test.ts#L30) (line 30)                   | [`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P3`](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md#unit-test-create-logger-foundation-32-1nhgfc.p3) |
| [`createLoggerFoundation > uses the default store size for zero configuration`](../../../../../../test/utils/createLoggerFoundation.test.ts#L49) (line 49)         | [`UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P4`](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md#unit-test-create-logger-foundation-32-1nhgfc.p4) |
