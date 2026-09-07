# test/utils/errorMessage.test.ts — Test Report

> **Test file:** [errorMessage.test.ts](../../../../../../test/utils/errorMessage.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [errorMessage.ts.md](../../../../implementation/source/src/utils/errorMessage.ts.md)

## Overview

Call the leaf helper with Error and non-Error inputs; compare exact message or String conversion, including empty strings and custom conversion.

## Tests and covered test IDs

| Test declaration                                                                                              | Covers                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`errorMessage > formats Error`](../../../../../../test/utils/errorMessage.test.ts#L5) (line 5)               | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P1`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p1) |
| [`errorMessage > formats empty Error`](../../../../../../test/utils/errorMessage.test.ts#L8) (line 8)         | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P2`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p2) |
| [`errorMessage > formats string`](../../../../../../test/utils/errorMessage.test.ts#L11) (line 11)            | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P3`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p3) |
| [`errorMessage > formats null`](../../../../../../test/utils/errorMessage.test.ts#L14) (line 14)              | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P4`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p4) |
| [`errorMessage > formats undefined`](../../../../../../test/utils/errorMessage.test.ts#L17) (line 17)         | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P5`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p5) |
| [`errorMessage > formats number`](../../../../../../test/utils/errorMessage.test.ts#L20) (line 20)            | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P6`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p6) |
| [`errorMessage > formats symbol`](../../../../../../test/utils/errorMessage.test.ts#L23) (line 23)            | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P7`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p7) |
| [`errorMessage > formats custom conversion`](../../../../../../test/utils/errorMessage.test.ts#L26) (line 26) | [`UNIT-TEST-ERROR-MESSAGE-32-X678KX.P8`](../../../../implementation/source/src/utils/errorMessage.ts.md#unit-test-error-message-32-x678kx.p8) |
