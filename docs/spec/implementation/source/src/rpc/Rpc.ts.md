# Rpc.ts

> **Source:** [src/rpc/Rpc.ts](../../../../../../src/rpc/Rpc.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-8-44XECF` (Compatibility before protected calls)](../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf)
  Missing: No protocol-version field in the envelope; the versioning gap is owned at the session level. See [`OQ-34-FY08V2` (RPC boundary decisions)](../../../../specification/open-questions.md#oq-34-fy08v2).

## UNIT-TEST-RPC-WIRE-1-4SDCQE

Shape validation and bigint rejection

- Setup: Round-trip valid envelopes/responses; decode malformed variants; serialize a raw BigInt
- Oracle: Valid round trips exact; every malformed variant decodes to `undefined`; raw BigInt throws at serialize

- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P1` — valid envelope round trip
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P2` — malformed shape: missing field
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P3` — raw BigInt throws
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P4` — boundary-size frame
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P5` — valid response round trip
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P6` — malformed shape: wrong-typed field
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P7` — malformed shape: non-array params
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P8` — omitted and empty-string request IDs use presence semantics
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P9` — present non-string request ID rejects
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P10` — invalid JSON rejects
- [x] `UNIT-TEST-RPC-WIRE-1-4SDCQE.P11` — non-empty request ID is preserved

## UNIT-TEST-RPC-32-DSTK5A

Frame classification

- Setup: Pass serialized frames to the shared decoder and inspect its request/response projection; response shape takes priority and malformed shapes return undefined.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-RPC-32-DSTK5A.P1` — classifies request with response-first precedence
- [x] `UNIT-TEST-RPC-32-DSTK5A.P2` — classifies response with response-first precedence
- [x] `UNIT-TEST-RPC-32-DSTK5A.P3` — classifies dual shape with response-first precedence
- [x] `UNIT-TEST-RPC-32-DSTK5A.P4` — classifies invalid response with valid request with response-first precedence
- [x] `UNIT-TEST-RPC-32-DSTK5A.P5` — rejects invalid JSON during frame classification
- [x] `UNIT-TEST-RPC-32-DSTK5A.P6` — rejects null during frame classification
- [x] `UNIT-TEST-RPC-32-DSTK5A.P7` — rejects primitive during frame classification
- [x] `UNIT-TEST-RPC-32-DSTK5A.P8` — rejects array during frame classification
- [x] `UNIT-TEST-RPC-32-DSTK5A.P9` — rejects missing fields during frame classification
