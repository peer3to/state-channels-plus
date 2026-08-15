# Channel-Term Negotiation

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft. The realizing implementation exists but is not wired into the default service
> root; whether it becomes default or integrator-wired is an open decision
> ([`OQ-34-FY08V2`](../open-questions.md#oq-34-fy08v2) family — see Assumptions).
> **Scope:** Negotiating the terms of a two-party channel opening and producing the doubly signed
> opening the chain requires. Shared communication rules: [rpc.md](./rpc.md). Opening semantics:
> [lifecycle.md](../settlement/lifecycle.md).

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Algorithm](#algorithm)
- [System interactions](#system-interactions)
- [Failure outcomes](#failure-outcomes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable contract

Two authenticated peers agree on opening terms — each side's deposit — and produce the unanimously
signed opening struct that enforcement's open operation verifies. The guarantee is
negotiated-terms-only signing: a node never co-signs terms it did not itself negotiate, and its own
deposit amount in any signed struct is always its locally held intention, never a wire value. Not
guaranteed: delivery (signaling is fire-and-forget; loss stalls until timeout), progress under
contention (one negotiation slot at a time), or that the counterparty funds the opening — success
is confirmed only by observing the channel open on-chain.

## Algorithm

1. **Initiate.** Either peer proposes: claim the local negotiation slot (one counterparty at a
   time; a busy node answers "busy", which resets the requester), start the negotiation timeout,
   and send the local deposit amount for the target channel.
2. **Exchange amounts.** The counterparty, if free, claims its slot and replies with its own
   amount. Amount messages from the current counterparty update the recorded value (last write
   wins); messages from anyone else or for another channel are ignored.
3. **Deterministic proposer.** When both amounts are known, exactly one side builds the canonical
   opening struct — selected by a deterministic identity-order tie-break — with canonically ordered
   participants, both amounts aligned to that order, a bounded deadline, and atomic-deposit
   semantics. The proposer signs the encoding and sends the proposal.
4. **Re-derive, never adopt.** The receiving side rebuilds the expected struct from its _own_
   negotiation state and local amount, requires field-exact equality with the proposal, requires
   the proposal signature to recover to the proposer, and requires the deadline to fall within its
   own bounds. Any deviation is misbehavior: terminate and exclude. A proposal arriving with no
   negotiated amounts (a cold proposal that would be checked against defaults) is refused the same
   way.
5. **Co-sign and submit.** The verifier co-signs and submits the doubly signed opening on-chain. A
   lost race (channel already open) defers to the chain event; other submission failures signal
   abort to the peer and reset.
6. **Confirm by observation.** Both sides treat the channel as open only on the chain's evidence,
   checked at the deadline; a deadline passing without an open channel aborts and resets.

## System interactions

| System                                            | Interaction                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Settlement](../settlement/lifecycle.md)          | Owns opening semantics: unanimity, composable atomic deposits, genesis creation.                                       |
| [Enforcement](../enforcement/contracts.md)        | Verifies the doubly signed struct at open; the chain event is the only success signal.                                 |
| [Protocol model](../protocol-model/data-types.md) | Canonical opening encoding and participant ordering.                                                                   |
| [Handshake](./handshake.md)                       | Counterparty identity for slot binding and signature checks comes from the authenticated session, never from payloads. |

## Failure outcomes

| Failure                                                                                                          | Outcome                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Busy slot                                                                                                        | Explicit busy signal; requester resets, no penalty. |
| Message from non-counterparty or wrong channel                                                                   | Silent ignore.                                      |
| Proposal deviating from negotiated terms, unsolicited proposal, wrong proposer signature, out-of-bounds deadline | Terminate and exclude the proposer.                 |
| Lost open race                                                                                                   | Defer to chain event; success.                      |
| Submission failure / deadline without open channel                                                               | Abort signal, reset; no identity penalty.           |
| Lost signaling message                                                                                           | Stall until negotiation timeout, then reset.        |

## Requirements and invariants

**<a id="inv-neg-1-6fw90p"></a>`INV-NEG-1-6FW90P` — Negotiated-terms-only signing.** A node signs an opening struct only when it equals,
field-exactly, the struct rebuilt from its own negotiation state, with its own deposit amount taken
from local state and the counterparty bound to the authenticated session.

**<a id="req-neg-1-rtkpt1"></a>`REQ-NEG-1-RTKPT1` — Deterministic single proposer.** Exactly one side builds and first-signs the
canonical struct, selected by a deterministic identity-order rule; a proposal from the wrong side
is misbehavior.

**<a id="req-neg-2-ed48tz"></a>`REQ-NEG-2-ED48TZ` — Chain-observed completion.** Negotiation success is established only by observing
the channel open on-chain; no peer message confirms an opening, and lost races defer to the chain.

**<a id="req-neg-3-q5wfaa"></a>`REQ-NEG-3-Q5WFAA` — Single-slot serialization.** A node negotiates with one counterparty at a time;
competing initiations receive an explicit busy signal and only the recorded counterparty's
messages affect the negotiation.

## Assumptions and constraints

- Two-party openings only; multi-party negotiation is future work.
- All signaling is fire-and-forget; the timeout is the only liveness backstop.
- **Wiring status (implementation-layer fact):** the current realization is not reachable on the
  default service root; making it default versus integrator-wired is an open decision. The
  normative contract above applies wherever it is wired.

## Security considerations

The attack surface is term substitution: a counterparty or relay altering amounts, participants,
deadline, or atomicity between negotiation and signature. Re-derivation with field-exact comparison
([`INV-NEG-1-6FW90P`](channel-negotiation.md#inv-neg-1-6fw90p)) is the defense — the proposal is a _claim to check_, never a _value to adopt_. The
deterministic proposer rule removes proposal glare and makes an out-of-role proposal itself
evidence. Cold proposals against defaults are refused. Residual: griefing by stall (claim a slot,
go silent) costs the victim one timeout window; busy-signal probing reveals only slot occupancy.

## Verification and test plan

### Requirement test matrix

| Plan item                                             | Requirements / invariants                                     | Setup and stimulus                                                                                                    | Expected result                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-neg-1-6fw90p.t1"></a>`INV-NEG-1-6FW90P.T1` | [`INV-NEG-1-6FW90P`](channel-negotiation.md#inv-neg-1-6fw90p) | Deliver proposals with each field altered, amounts replayed from the wire, unsolicited proposals, and an exact match. | Only the exact self-rebuilt struct is co-signed; every deviation excludes the proposer; local amount always wins. | <a id="inv-neg-1-6fw90p.t1.p1"></a>`INV-NEG-1-6FW90P.T1.P1` — exact match co-signed; <a id="inv-neg-1-6fw90p.t1.p2"></a>`INV-NEG-1-6FW90P.T1.P2` — altered amount; <a id="inv-neg-1-6fw90p.t1.p3"></a>`INV-NEG-1-6FW90P.T1.P3` — cold/unsolicited proposal; <a id="inv-neg-1-6fw90p.t1.p4"></a>`INV-NEG-1-6FW90P.T1.P4` — deadline outside bounds; <a id="inv-neg-1-6fw90p.t1.p5"></a>`INV-NEG-1-6FW90P.T1.P5` — altered participants; <a id="inv-neg-1-6fw90p.t1.p6"></a>`INV-NEG-1-6FW90P.T1.P6` — altered deadline; <a id="inv-neg-1-6fw90p.t1.p7"></a>`INV-NEG-1-6FW90P.T1.P7` — altered atomicity. |
| <a id="req-neg-1-rtkpt1.t1"></a>`REQ-NEG-1-RTKPT1.T1` | [`REQ-NEG-1-RTKPT1`](channel-negotiation.md#req-neg-1-rtkpt1) | Run negotiations from both initiation directions; send proposals from the wrong side.                                 | The deterministic side proposes regardless of initiator; wrong-side proposals are misbehavior.                    | <a id="req-neg-1-rtkpt1.t1.p1"></a>`REQ-NEG-1-RTKPT1.T1.P1` — initiation by the proposer side; <a id="req-neg-1-rtkpt1.t1.p2"></a>`REQ-NEG-1-RTKPT1.T1.P2` — wrong-side proposal excluded; <a id="req-neg-1-rtkpt1.t1.p3"></a>`REQ-NEG-1-RTKPT1.T1.P3` — proposer signature recovery enforced; <a id="req-neg-1-rtkpt1.t1.p4"></a>`REQ-NEG-1-RTKPT1.T1.P4` — initiation by the non-proposer side.                                                                                                                                                                                                       |
| <a id="req-neg-2-ed48tz.t1"></a>`REQ-NEG-2-ED48TZ.T1` | [`REQ-NEG-2-ED48TZ`](channel-negotiation.md#req-neg-2-ed48tz) | Complete openings normally, race two submissions, fail submission, and let deadlines lapse.                           | Success only via the chain event; races defer; failures abort and reset without false success.                    | <a id="req-neg-2-ed48tz.t1.p1"></a>`REQ-NEG-2-ED48TZ.T1.P1` — normal completion; <a id="req-neg-2-ed48tz.t1.p2"></a>`REQ-NEG-2-ED48TZ.T1.P2` — race lost, chain event wins; <a id="req-neg-2-ed48tz.t1.p3"></a>`REQ-NEG-2-ED48TZ.T1.P3` — submission failure aborts; <a id="req-neg-2-ed48tz.t1.p4"></a>`REQ-NEG-2-ED48TZ.T1.P4` — deadline without open channel resets.                                                                                                                                                                                                                                |
| <a id="req-neg-3-q5wfaa.t1"></a>`REQ-NEG-3-Q5WFAA.T1` | [`REQ-NEG-3-Q5WFAA`](channel-negotiation.md#req-neg-3-q5wfaa) | Initiate concurrent negotiations from multiple peers; interleave messages from third parties.                         | One slot honored; busy signals reset competitors; third-party and wrong-channel messages ignored.                 | <a id="req-neg-3-q5wfaa.t1.p1"></a>`REQ-NEG-3-Q5WFAA.T1.P1` — busy under contention; <a id="req-neg-3-q5wfaa.t1.p2"></a>`REQ-NEG-3-Q5WFAA.T1.P2` — third-party interference ignored; <a id="req-neg-3-q5wfaa.t1.p3"></a>`REQ-NEG-3-Q5WFAA.T1.P3` — timeout frees the slot; <a id="req-neg-3-q5wfaa.t1.p4"></a>`REQ-NEG-3-Q5WFAA.T1.P4` — stalling counterparty costs one window only.                                                                                                                                                                                                                   |

## Future Work

_Non-normative._ Multi-party negotiation; request/response delivery for the proposal leg to remove
the silent-stall mode; resolve the default-root wiring decision.
