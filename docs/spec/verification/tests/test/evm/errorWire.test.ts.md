# test/evm/errorWire.test.ts — Test Report

> **Test file:** [test/evm/errorWire.test.ts](../../../../../../test/evm/errorWire.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [errorWire.ts](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two unit cases for the shared error codec's fail-safe boundary. Each builds a real `Error` carrying ethers-style metadata or watchdog delay data whose `toJSON` throws, serializes it, and asserts the message, name, and code survive while the failing field becomes `undefined`; the first also rebuilds the error with `deserializeError`. The codec runs inside the workers' uncaught-error funnel, so it must never throw itself.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                          | Covers                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`errorWire > keeps the original error when its metadata toJSON throws`](../../../../../../test/evm/errorWire.test.ts#L6) (line 6)        | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P1`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p1), [`REQ-RUNTIME-3-VQXW59.T1.P16`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p16) |
| [`errorWire > keeps the original error when its delay data cannot be cloned`](../../../../../../test/evm/errorWire.test.ts#L36) (line 36) | [`UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P2`](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md#unit-test-error-wire-1-zwgj00.p2), [`REQ-RUNTIME-3-VQXW59.T1.P17`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p17) |
