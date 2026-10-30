# Rpc.test.ts

Test file: [test/rpc/Rpc.test.ts](../../../../../../test/rpc/Rpc.test.ts)
Exercises: [Rpc.ts](../../../../implementation/source/src/rpc/Rpc.ts.md)

The request and response helpers project the single production frame parser. A dual-shape frame is a response only; no independent legacy parser is exercised.

## Overview

Pass serialized frames to the shared decoder and compare its route with each independent standalone decoder; malformed shapes return undefined.

This direct wire-codec suite covers request and response round trips, request-ID presence and type
semantics, invalid JSON and shape rejection, raw-BigInt rejection on both serialization paths, and
the exact 16 MiB frame constant. Dispatcher consequences remain in the P2PManager suite.

## Tests

- `accepts a well-formed RPC with array params`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P1
- `preserves requestId for request-style RPCs`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P11, REQ-RPC-1-FF89Z0.T1.P10
- `accepts omitted, non-empty, and empty request ids by presence`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P8
- `rejects every present non-string request id`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P9, REQ-RPC-1-FF89Z0.T1.P9
- `rejects every non-array params value`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P7
- `rejects when params is missing entirely`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P2
- `returns undefined on invalid JSON`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P10
- `round-trips a valid RPC response`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P5
- `rejects wrong-typed request and response fields`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P6
- `throws when a request param or response result contains a raw BigInt`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P3
- `defines the exact 16 MiB frame limit`: UNIT-TEST-RPC-WIRE-1-4SDCQE.P4
- `classifies request with response-first precedence`: UNIT-TEST-RPC-32-DSTK5A.P1
- `classifies response with response-first precedence`: UNIT-TEST-RPC-32-DSTK5A.P2
- `classifies dual shape with response-first precedence`: UNIT-TEST-RPC-32-DSTK5A.P3
- `classifies invalid response with valid request with response-first precedence`: UNIT-TEST-RPC-32-DSTK5A.P4
- `rejects invalid JSON during frame classification`: UNIT-TEST-RPC-32-DSTK5A.P5
- `rejects null during frame classification`: UNIT-TEST-RPC-32-DSTK5A.P6
- `rejects primitive during frame classification`: UNIT-TEST-RPC-32-DSTK5A.P7
- `rejects array during frame classification`: UNIT-TEST-RPC-32-DSTK5A.P8
- `rejects missing fields during frame classification`: UNIT-TEST-RPC-32-DSTK5A.P9
