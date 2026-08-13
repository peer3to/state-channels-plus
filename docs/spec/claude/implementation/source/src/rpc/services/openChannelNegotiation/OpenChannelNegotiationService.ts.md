# OpenChannelNegotiationService.ts — Source Report

> **Source:** [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/open-channel-negotiation.md](../../../../../views/architecture/sdk/rpc/open-channel-negotiation.md)

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

The negotiation engine (currently unwired from the default root): single negotiation slot with
20s timeout, amount exchange, lower-address proposer building the canonical sorted struct with
a 60s deadline, receiver-side field-exact re-derivation before co-signing and submitting
`open(...)`, race tolerance for a lost open, and chain-observed completion at the deadline check.

## Key design decisions

1. **Re-derive, never adopt.** The proposal is compared field-for-field against a locally rebuilt struct with the local amount — term substitution is structurally impossible to sign ([`INV-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1)).
2. **Deterministic proposer by address order** removes glare; an out-of-role proposal is misbehavior ([`REQ-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-1)).
3. **Success only from the chain.** The deadline check polls channel state; no peer message confirms an opening ([`REQ-NEG-2`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-2)).
4. **Cold proposals refused:** no negotiated amount → punish, blocking validation against default balances.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | Local begin-negotiation; amounts/proposals/aborts from the counterparty. |
| Outputs      | Signaling sends; the on-chain `open` submission; state resets.           |
| Owned state  | One slot: counterparty, amounts, proposal/latch flags, timer.            |
| Side effects | Transaction submission; disconnect/blacklist on deviant proposals.       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                             | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenChannelNegotiationService.ts](../../../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts) | [`INV-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1), [`REQ-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-1), [`REQ-NEG-2`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-2), [`REQ-NEG-3`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-3) |

## Assumptions, dependencies, trust boundaries, and limits

- Two-party only; all signaling fire-and-forget with the timeout as the sole liveness backstop.

## Specification adherence

- Slot serialization with explicit busy ([`REQ-NEG-3`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-3)); race-lost open defers to the event.

## Specification contradictions

None demonstrated.

## Missing behavior

**DEF-12:** `amount` is not validated as a finite non-negative integer — NaN/Infinity/negatives pass `typeof` and reach BigInt/ABI encoding as an escaping throw (unreachable while unwired; must be fixed before wiring). Wiring decision itself: [OQ-34](../../../../../../specification/open-questions.md).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                         | Gap / divergence                                  |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [`INV-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1) | Covered               | **Here:** field-exact mismatch detection incl. deadline bounds and local-amount insistence.      | None.                                             |
| [`REQ-NEG-2`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-2) | Covered               | **Here:** deadline-check chain polling; `RaceConditionChannelAlreadyOpen` tolerated.             | None.                                             |
| [`REQ-NEG-3`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-3) | Partial               | **Here:** slot + busy + timeout reset.                                                           | DEF-12 amount validation missing at the boundary. |
| [`REQ-NEG-1`](../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-1) | Covered               | **Here:** the numerically lower address is the sole proposer; a wrong-side proposal is punished. | None.                                             |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation                     | Public entry and setup                                                                                                          | Oracle and forbidden effects                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-open-negotiation-service-1"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1` | Terms integrity and completion | Run negotiations from both directions; deliver altered/cold/wrong-role proposals; race opens; lapse deadlines; contend the slot | Only self-rebuilt terms co-sign; deviations punish; completion only via chain; slot semantics hold; DEF-12 documented | <a id="unit-test-open-negotiation-service-1.p1"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P1` — local-initiated negotiation; <a id="unit-test-open-negotiation-service-1.p2"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P2` — altered channelId; <a id="unit-test-open-negotiation-service-1.p3"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P3` — cold proposal refused; <a id="unit-test-open-negotiation-service-1.p4"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P4` — wrong-role proposer; <a id="unit-test-open-negotiation-service-1.p5"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P5` — race-lost open defers; <a id="unit-test-open-negotiation-service-1.p6"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P6` — deadline lapse resets; <a id="unit-test-open-negotiation-service-1.p7"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P7` — slot busy; <a id="unit-test-open-negotiation-service-1.p8"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P8` — invalid amount (documents DEF-12); <a id="unit-test-open-negotiation-service-1.p9"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P9` — remote-initiated negotiation; <a id="unit-test-open-negotiation-service-1.p10"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P10` — altered participants; <a id="unit-test-open-negotiation-service-1.p11"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P11` — altered balances; <a id="unit-test-open-negotiation-service-1.p12"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P12` — altered isAtomic; <a id="unit-test-open-negotiation-service-1.p13"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P13` — altered data; <a id="unit-test-open-negotiation-service-1.p14"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P14` — altered deadline; <a id="unit-test-open-negotiation-service-1.p15"></a>`UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1.P15` — third-party proposal ignored |

## Related source reports

- [OpenChannelNegotiationRpcMethods](./OpenChannelNegotiationRpcMethods.ts.md), [OpenChannelNegotiationHelpers](./OpenChannelNegotiationHelpers.ts.md).
