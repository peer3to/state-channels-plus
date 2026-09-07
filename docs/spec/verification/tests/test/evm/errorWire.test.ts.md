# test/evm/errorWire.test.ts — Test Report

> **Test file:** [test/evm/errorWire.test.ts](../../../../../../test/evm/errorWire.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [errorWire.ts](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two unit cases for the shared error codec's fail-safe boundary. Each builds a real `Error` carrying ethers-style metadata or watchdog delay data whose `toJSON` throws, serializes it, and asserts the message, name, and code survive while the failing field becomes `undefined`; the first also rebuilds the error with `deserializeError`. The codec runs inside the workers' uncaught-error funnel, so it must never throw itself.

## Tests and covered test IDs

| Test                                                                                                                                      | Covers                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`errorWire > keeps the original error when its metadata toJSON throws`](../../../../../../test/evm/errorWire.test.ts#L12) (line 12)      | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P1`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p1), [`REQ-RUNTIME-3-VQXW59.T1.P16`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p16) |
| [`errorWire > keeps the original error when its delay data cannot be cloned`](../../../../../../test/evm/errorWire.test.ts#L42) (line 42) | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P2`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p2), [`REQ-RUNTIME-3-VQXW59.T1.P17`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p17) |
| [`errorWire > round-trips a thrown string`](../../../../../../test/evm/errorWire.test.ts#L56) (line 56)                                   | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P3`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p3)                                                                                                              |
| [`errorWire > restores nested info.error.data as a decodable revert`](../../../../../../test/evm/errorWire.test.ts#L62) (line 62)         | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P4`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p4)                                                                                                              |
| [`errorWire > restores VM return bytes as a decodable revert`](../../../../../../test/evm/errorWire.test.ts#L74) (line 74)                | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P5`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p5)                                                                                                              |
| [`errorWire > preserves the custom error name and originating peer`](../../../../../../test/evm/errorWire.test.ts#L88) (line 88)          | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P6`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p6)                                                                                                              |
