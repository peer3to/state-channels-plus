# HandshakeCompletedGuard.ts — Source Report

> **Source:** [src/rpc/guards/HandshakeCompletedGuard.ts](../../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts) > **Status:** Authored — engineer verification pending.
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

The built-in admission guard: passes iff the sender transport maps to a profile whose handshake
completed. On failure it splits: handshake-in-progress → queue the rpc per transport and wait
(bounded 2× agreement window), replaying queued rpcs on completion; no negotiation → treat as
malicious (terminate + exclude).

## Key design decisions

1. **Admission keys on proven identity, not transport age.** The check reads the profile completion flag written only at handshake finalization ([`REQ-AUTH-3-ZV74KB`](../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)).
2. **Deferred delivery for mid-handshake races.** Fire-and-forget rpcs arriving during negotiation replay in arrival order after completion instead of penalizing an honest raced peer.

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

| Source file                                                                                     | Specification IDs                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [HandshakeCompletedGuard.ts](../../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts) | [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), [`REQ-AUTH-3-ZV74KB`](../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb) |

## Assumptions, dependencies, trust boundaries, and limits

- Handshake completion is the single admission fact ([`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)); the authentication service itself is unguarded.

## Specification adherence

- Caller-scoped admission expressed as a guard, ordering-first ([`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).

## Specification contradictions

**Guard-retry vs request/response interaction ([`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2)):** a queued _request_ was already answered with the guard error, so its replayed response is dropped as already-settled — the retry queue only benefits fire-and-forget; and the non-negotiating branch disconnects before the error response can send. Decision pending; behavior documented, not silently normalized.

## Missing behavior

None demonstrated beyond the [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2) decision.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                     | Gap / divergence                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Covered               | **Here:** profile-completion admission ([#L41](../../../../../../../../src/rpc/guards/HandshakeCompletedGuard.ts#L41)). **Other files:** completion written by [InitHandshakeService](../services/initHandshake/InitHandshakeService.ts.md). | None.                                                                                                                                                                                                    |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Partial               | **Here:** pure check + consequence split, queue-or-punish fork.                                                                                                                                                                              | Request-style deferred retry is ineffective ([`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2)) — deterministic settlement happens, but the retry path is dead for requests. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation                             | Public entry and setup                                                                                      | Oracle and forbidden effects                                                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-handshake-guard-1-xhfsxx"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX` | Admission and the two failure branches | Frames before, during, and after handshake; negotiating and non-negotiating transports; both delivery modes | Completed profiles pass; mid-negotiation queues and replays in order (fire-and-forget); non-negotiating terminates+excludes; timeout clears queue with exclusion | <a id="unit-test-handshake-guard-1-xhfsxx.p1"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P1` — completed pass; <a id="unit-test-handshake-guard-1-xhfsxx.p2"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P2` — mid-negotiation queue+replay order; <a id="unit-test-handshake-guard-1-xhfsxx.p3"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P3` — request-during-negotiation (documents [`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2) dead retry); <a id="unit-test-handshake-guard-1-xhfsxx.p4"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P4` — non-negotiating punished; <a id="unit-test-handshake-guard-1-xhfsxx.p5"></a>`UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P5` — waiter timeout |

## Related source reports

- [InitHandshakeService](../services/initHandshake/InitHandshakeService.ts.md), [ARpcService](../ARpcService.ts.md), [ProfileManager](../../ProfileManager.ts.md).
