# HandshakeCompletedGuard.ts — Source Report

> **Source:** [src/rpc/guards/HandshakeCompletedGuard.ts](../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

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

The built-in authenticated-RPC guard permits protected execution only when the exact incoming
transport is open and completed its own handshake. During an active handshake it queues RPCs per
transport for at most two agreement windows. Only that transport's completion may drain its queue;
closure, timeout, or disposal drops it. Unauthenticated traffic outside negotiation is terminated
and excluded. A frame dispatched after its authenticated transport closes is dropped silently.

## Key design decisions

1. **Authentication belongs to the exact transport.** The check reads `transport.peerAddress`,
   written only after final admission. A replaced but open authenticated pipe remains valid until the upgrade
   protocol retires it ([`REQ-UPG-2-WH7BC7`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)).
2. **Deferred delivery for mid-handshake races.** Requests and fire-and-forget RPCs arriving during negotiation replay in arrival order after completion. `ARpcService` suppresses the premature guard-error response while the shared guard owns the request.
3. **Waiters cannot outlive their transport or owner.** Success requires exact-transport
   authentication and a live transport. Timeout punishment additionally requires current ownership,
   so a stale waiter cannot punish a healthy replacement.
4. **Self-close is not peer malice.** A late dispatched frame on a closed transport is consumed
   without execution or punishment, leaving any healthy replacement untouched.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                    |
| ------------ | ----------------------------------------------------------- |
| Inputs       | Rpc + transport.                                            |
| Outputs      | Pass/fail; queue/replay or terminate+exclude.               |
| Owned state  | Per-transport retry queues and waiters.                     |
| Side effects | Disconnect/blacklist; delayed replays via `service.runRPC`. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                  | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HandshakeCompletedGuard.ts](../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts) | [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), [`REQ-AUTH-3-ZV74KB`](../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-UPG-2-WH7BC7`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7) |

## Assumptions, dependencies, trust boundaries, and limits

- Handshake completion on the exact live transport is the authenticated-RPC permission fact
  ([`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)); current transport selection belongs to the upgrade protocol.

## Specification adherence

- Caller-scoped authenticated-RPC permission expressed as a guard, ordering-first
  ([`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).

## Specification contradictions

None demonstrated for deferred request admission. The broader protocol-versioning and ban-persistence parts of [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2) remain open.

## Missing behavior

None demonstrated for this guard. The shared queue remains intentionally unbounded pending [`OQ-SPEC-LOBBY-1-D65YTT`](../../../../../specification/open-questions.md#oq-spec-lobby-1-d65ytt).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                        | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Covered               | **Here:** exact-transport completion check. **Other files:** completion written by [InitHandshakeService](../services/initHandshake/InitHandshakeService.ts.md) and stored by [ProfileManager](../../ProfileManager.ts.md).                                     | None.            |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** named handshake policy over the shared exact-transport queue, queue-or-punish split, and post-wait transport/owner gates. **Other files:** `ARpcService` suppresses early failures and `DeferredAdmissionGuard` replays requests through the service. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation                                              | Public entry and setup                                                                                                                                                                          | Oracle and forbidden effects                                                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-handshake-guard-1-xhfsxx"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX` | Authenticated RPC, deferred queues, and failure routing | Frames before, during, and after handshake across independent transports, both delivery modes, identity states, transport retirement, replacement overlap, owner disposal, and failure handlers | Each open authenticated transport passes; queues release only for their exact transport; stale waiters cannot replay or punish; timeout uses the exact bound; every punishment and override path has no endpoint effect | <a id="unit-test-handshake-guard-1-xhfsxx.p1"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P1` — completed pass; <a id="unit-test-handshake-guard-1-xhfsxx.p2"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P2` — mid-negotiation queue+replay order; <a id="unit-test-handshake-guard-1-xhfsxx.p3"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P3` — real caller settles on the immediate guard error and ignores the later replay response (documents [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2)); <a id="unit-test-handshake-guard-1-xhfsxx.p4"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P4` — non-negotiating addressed peer punished; <a id="unit-test-handshake-guard-1-xhfsxx.p5"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P5` — waiter receives `2 × agreementTime × 1000`, timeout excludes the peer, and stale queued work cannot replay; <a id="unit-test-handshake-guard-1-xhfsxx.p6"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P6` — a post-timeout arrival starts a fresh waiter and replays alone on completion; <a id="unit-test-handshake-guard-1-xhfsxx.p7"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P7` — two transports have independent queues, waiters, completion, and timeout consequences; <a id="unit-test-handshake-guard-1-xhfsxx.p8"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P8` — unauthenticated profile rejects without endpoint invocation; <a id="unit-test-handshake-guard-1-xhfsxx.p9"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P9` — addressless non-negotiating and timeout branches use transport fallback disconnection; <a id="unit-test-handshake-guard-1-xhfsxx.p10"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P10` — custom failure handler runs once and suppresses built-in punishment; <a id="unit-test-handshake-guard-1-xhfsxx.p11"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P11` — closed or retired transport drops queued calls; <a id="unit-test-handshake-guard-1-xhfsxx.p12"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P12` — owner disposal drops late success; <a id="unit-test-handshake-guard-1-xhfsxx.p13"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P13` — owner disposal suppresses late failure punishment; <a id="unit-test-handshake-guard-1-xhfsxx.p14"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P14` — late completion after timeout cannot revive stale work; <a id="unit-test-handshake-guard-1-xhfsxx.p15"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P15` — replaced but open authenticated transport passes during grace overlap without punishment; <a id="unit-test-handshake-guard-1-xhfsxx.p16"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P16` — replacement authentication cannot release the original queue, while original completion drains it once in FIFO order; <a id="unit-test-handshake-guard-1-xhfsxx.p17"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P17` — a late frame dispatched after authenticated transport close is dropped without execution or punishment |

## Related source reports

- [InitHandshakeService](../services/initHandshake/InitHandshakeService.ts.md), [ARpcService](../ARpcService.ts.md), [ProfileManager](../../ProfileManager.ts.md).
