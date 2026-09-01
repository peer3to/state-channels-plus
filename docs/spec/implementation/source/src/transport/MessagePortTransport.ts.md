# MessagePortTransport.ts — Source Report

> **Source:** [MessagePortTransport.ts](../../../../../../src/transport/MessagePortTransport.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

A worker port as a transport. It is trusted, because the far end is this process's own thread, and
its frames cross as objects by structured clone rather than as JSON, because bus events carry bigints
and executor results carry byte arrays. The port closing closes the transport.

## Key design decisions

- **Objects, not bytes.** `send` and `sendRpcResponse` post the envelope itself; the base class's
  serialization is bypassed on purpose ([`send`](../../../../../../src/transport/MessagePortTransport.ts#L29)).
- **Trusted by construction.** No guards, no frame bound, full errors: the flag the routers and
  services read is set here and nowhere else.
- **The far end closing its port closes this end.** `onClose` runs `close(false)`, which the router
  turns into rejected requests and an owner callback.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | A port and the router it delivers to; frames arriving on the port.       |
| Outputs      | Frames posted on the port; inbound frames handed to `router.onRpcFrame`. |
| Owned state  | The port.                                                                |
| Side effects | Closing the port on `_close`.                                            |

## Linked requirements

| Source file                                                                        | Specification IDs                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MessagePortTransport.ts](../../../../../../src/transport/MessagePortTransport.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

## Assumptions, dependencies, trust boundaries, and limits

- Only values structured clone can copy may cross; a transferable needs the bootstrap.
- Trust is the whole basis: this transport must never be put on a socket.

## Specification adherence

- The same envelope crosses a port as crosses a socket; only the framing differs ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}, {{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).
- Guards are bypassed only because the transport is trusted, which is what the guard rule allows ({{REQ:[`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                      | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** one transport for the inline pair and the transferred port alike.                                                                                   | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** structured clone is the canonical encoding of a port frame. **Other files:** [../rpc/serializeError.ts.md](../rpc/serializeError.ts.md) for errors. | None.            |
| [`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)    | Covered               | **Here:** `isTrusted` is true. **Other files:** [../rpc/ARpcService.ts.md](../rpc/ARpcService.ts.md) skips guards on it.                                      | None.            |

## Component test obligations

| Unit test ID                                                                                      | Obligation                                                            | Public entry and setup                                                                     | Oracle and forbidden effects                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-message-port-transport-1-h9t8b4"></a>`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4` | The port as a transport: trust, framing, and closure from either end. | Real `MessageChannel` pairs with routers on both ends; a spy port that records raw frames. | The raw frame on the wire; the closed flag and rejected requests; nothing logged as a failure on an expected close. | <a id="unit-test-message-port-transport-1-h9t8b4.p1"></a>`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P1` — it is a trusted transport of its own type; <a id="unit-test-message-port-transport-1-h9t8b4.p2"></a>`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P2` — the envelope crosses as an object, not a string; <a id="unit-test-message-port-transport-1-h9t8b4.p3"></a>`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P3` — the far end closing its port closes this transport and rejects its requests; <a id="unit-test-message-port-transport-1-h9t8b4.p4"></a>`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P4` — an expected close settles pending requests as disposed, not as a failure |

## Related source reports

- [ATransport.ts.md](./ATransport.ts.md) — the base every transport shares.
- [../rpc/PortRpcRouter.ts.md](../rpc/PortRpcRouter.ts.md) — attaches it.
- [RuntimePort.ts.md](./RuntimePort.ts.md) — the port it wraps.
