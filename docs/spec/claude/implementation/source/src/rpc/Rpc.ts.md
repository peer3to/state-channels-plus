# Rpc.ts — Source Report

> **Source:** [src/rpc/Rpc.ts](../../../../../../../src/rpc/Rpc.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The wire contract: the `Rpc` envelope (`service`, `method`, `params[]`, optional `requestId`),
the `RpcResponse` shape, the 16 MiB frame cap, and the (de)serialization functions whose shape
checks are the first validation every inbound frame meets.

## Key design decisions

1. **`requestId` presence selects delivery semantics.** Its presence obliges exactly one correlated response; absence means fire-and-forget — one envelope, two modes ([#L1](../../../../../../../src/rpc/Rpc.ts#L1)).
2. **Raw `BigInt` throws at the sender.** Params/results must be JSON-serializable; bigint-bearing structs cross as `Codec`-encoded strings, and `JSON.stringify`'s throw surfaces the offending method instead of silently coercing ([#L31](../../../../../../../src/rpc/Rpc.ts#L31)).
3. **Reject-by-`undefined` decoding.** Malformed frames yield `undefined` (never throw), so the dispatcher's disconnect consequence is a decision, not an exception path ([#L41](../../../../../../../src/rpc/Rpc.ts#L41)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                  |
| ------------ | --------------------------------------------------------- |
| Inputs       | Envelopes/responses to serialize; wire strings to decode. |
| Outputs      | Strings; decoded structs or `undefined`.                  |
| Owned state  | None — pure functions and constants.                      |
| Side effects | None.                                                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                   | Specification IDs                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rpc.ts](../../../../../../../src/rpc/Rpc.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

## Assumptions, dependencies, trust boundaries, and limits

- The frame cap is enforced by the dispatcher _before_ parsing; this file only defines the constant.
- `params` must be an array because dispatch spreads it — the shape check here is load-bearing.

## Specification adherence

- Envelope identifies method, delivery mode, correlation, and payload ([`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)); malformed frames fail deterministically to `undefined`.
- Response-shape marker (`rpcResponse: true`) enables the response-first classification of [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j).

## Specification contradictions

None demonstrated. (The cap counts UTF-16 code units, not bytes — a multi-byte-heavy frame gets up to ~4× the nominal budget; documentation-precision debt noted in the design view.)

## Missing behavior

No protocol-version field in the envelope — the versioning gap is owned at the session level ([`REQ-RPC-8-44XECF`](../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf), [`OQ-34-FY08V2`](../../../../specification/open-questions.md#oq-34-fy08v2)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                                           | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** envelope/response shapes and strict decoders ([#L41](../../../../../../../src/rpc/Rpc.ts#L41)). **Other files:** [ARpcService](./ARpcService.ts.md) and [P2PManager](../P2PManager.ts.md) apply the consequences; [Codec](../utils/Codec.ts.md) carries bigint payloads. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                          | Obligation                            | Public entry and setup                                                                  | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-rpc-wire-1-4sdcqe"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE` | Shape validation and bigint rejection | Round-trip valid envelopes/responses; decode malformed variants; serialize a raw BigInt | Valid round trips exact; every malformed variant decodes to `undefined`; raw BigInt throws at serialize | <a id="unit-test-rpc-wire-1-4sdcqe.p1"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P1` — valid envelope round trip; <a id="unit-test-rpc-wire-1-4sdcqe.p2"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P2` — malformed shape: missing field; <a id="unit-test-rpc-wire-1-4sdcqe.p3"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P3` — raw BigInt throws; <a id="unit-test-rpc-wire-1-4sdcqe.p4"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P4` — boundary-size frame; <a id="unit-test-rpc-wire-1-4sdcqe.p5"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P5` — valid response round trip; <a id="unit-test-rpc-wire-1-4sdcqe.p6"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P6` — malformed shape: wrong-typed field; <a id="unit-test-rpc-wire-1-4sdcqe.p7"></a>`UNIT-TEST-RPC-WIRE-1-4SDCQE.P7` — malformed shape: non-array params |

## Related source reports

- [ARpcService](./ARpcService.ts.md) (dispatch consumer), [RpcHandler](./RpcHandler.ts.md) (sender side), [P2PManager](../P2PManager.ts.md) (frame-size gate + classification).
