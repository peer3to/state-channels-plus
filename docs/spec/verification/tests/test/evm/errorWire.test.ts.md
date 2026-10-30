# errorWire.test.ts

Test file: [test/evm/errorWire.test.ts](../../../../../../test/evm/errorWire.test.ts)
Exercises: [errorWire.ts](../../../../implementation/source/src/rpc/internal/errorWire.ts.md)

## Overview

Two unit cases for the shared error codec's fail-safe boundary. Each builds a real `Error` carrying ethers-style metadata or watchdog delay data whose `toJSON` throws, serializes it, and asserts the message, name, and code survive while the failing field becomes `undefined`; the first also rebuilds the error with `deserializeError`. The codec runs inside the workers' uncaught-error funnel, so it must never throw itself.

## Tests

- `keeps the original error when its metadata toJSON throws`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P1, REQ-RUNTIME-3-VQXW59.T1.P16
- `keeps the original error when its delay data cannot be cloned`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P2, REQ-RUNTIME-3-VQXW59.T1.P17
- `round-trips a thrown string`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P3
- `restores nested info.error.data as a decodable revert`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P4
- `restores VM return bytes as a decodable revert`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P5
- `preserves the custom error name and originating peer`: UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P6
