# Selected Watchtowers

> **Agent status:** Maintained specification draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

A participant may delegate availability evidence, one narrowly restricted removal block, and
dispute-finality approval to one bonded watchtower it selects through an on-chain binding. The
selected tower can acknowledge what it received, author exactly one restricted AFK removal block
for its represented participant's missed slot, and approve one audited timeout dispute in its
offline participant's place. Everything else a watchtower classically does — observing disputes and
killing invalid ones — remains permissionless and needs no selection. This document owns the tower
model; the dispute-side rules the artifacts plug into are owned by
[disputes.md](../disputes/disputes.md)
([`REQ-DIS-11-JJ9FG3`](../disputes/disputes.md#req-dis-11-jj9fg3) through
[`REQ-DIS-15-GH01J0`](../disputes/disputes.md#req-dis-15-gh01j0)).

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Registration, selection, and lifecycle](#registration-selection-and-lifecycle)
- [Evidence, delivery, and misconduct](#evidence-delivery-and-misconduct)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

Today a scheduled author that misses the off-chain confirmation threshold proves it acted by posting
its block as calldata, and a timeout against an absent author matures only after the full
peer-to-peer, agreement, and chain-fallback windows
([disputes.md §6.3](../disputes/disputes.md#63-timeout-validity-conditions)). The selected-tower
model adds delegated services without changing that ordinary path:

- a **receipt** (`BlockConfirmationReceipt`) proves a receiving side already acknowledged the exact
  block. It contributes **availability credits** to the existing availability threshold over the
  block's availability set
  ([`REQ-DIS-12-1ZN453`](../disputes/disputes.md#req-dis-12-1zn453)) — letting
  the author skip calldata — and defeats an **ordinary** timeout from any peer it credits. Its
  tower-derived credit supplies no assigned peer's ordinary block or milestone **finality
  vote** — finality is counted in actual participant votes, and a recovered signer that is
  itself a participant keeps its own vote (central key policy,
  [identity.md](../protocol-model/identity.md#identity);
  [`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz));
- a **restricted AFK block**: when the represented participant is the scheduled author of a slot
  and its tower has received no normal block for that slot by the end of the agreement window, the
  frozen selected tower may author one canonical block at that slot whose only effect is the
  non-punitive removal of that participant. The block is authored under the tower's own key, flows
  through the ordinary validation, confirmation, storage, and finality pipeline, and doubles as
  the timeout evidence that replaces the old signed non-receipt statement;
- a **dispute approval** (`WatchtowerDisputeApproval`) from the offline target's tower substitutes
  for the target's signature on one audited timeout dispute, reaching the existing immediate
  threshold-finality shortcut; and
- the selected tower is additionally its participant's **authorized dispute representative**: while
  the participant is unavailable it may submit the participant's dispute or counter-dispute as that
  participant's own submission, first-ordered transaction wins the participant's slot.

Selection is optional. A participant without a tower stays on the ordinary protocol path in every
role. The protocol-team-operated default tower is a deployment choice, never protocol authority.

## Registration, selection, and lifecycle

This section is explanatory; the binding rules are
[`REQ-WT-1-TXW328`](watchtowers.md#req-wt-1-txw328),
[`REQ-WT-5-T5ZFTZ`](watchtowers.md#req-wt-5-t5zftz),
[`REQ-WT-2-HNZA3Y`](watchtowers.md#req-wt-2-hnza3y),
[`REQ-WT-10-GNG79P`](watchtowers.md#req-wt-10-gng79p), and
[`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r) below.

A tower identity exists by paying a fixed, minimal, one-time registration bond that is permanently
non-withdrawable. The bond is a real cost of operating under that identity — a Sybil cost, not a
proof or guarantee of honesty. A participant names its selected tower in its inbound `JoinChannel`
message: for an absent participant, the first accepted join establishes that participant **and**
its selected tower for the new membership interval, and the binding is frozen for that interval's
entire lifetime, even if the tower is later slashed or becomes ineligible for future selection. A
later accepted join while the participant is present is a top-up and cannot change the binding;
after the participant leaves, a later accepted join begins a new membership interval and may
establish the then-selected tower. Only a registered, unbarred tower is selectable at join
acceptance. The accepted join exposes the tower's authorized
key, never a dialable endpoint: the tower discovers its assigned channels from chain events and
dials in itself. While a channel is live the tower spectates it through its own connections and
keeps a bounded rolling evidence set — the latest state and evidence needed to audit that channel —
then prunes that data and leaves at settlement. Proven objective equivocation destroys the bond and
permanently bars the identity from future selection through a punishment entry point that is
entirely separate from the channel protocol; existing channels are unaffected. A participant that
detects disconnection from its own selected tower keeps operating normally and additionally takes
on the publication duty of [`REQ-WT-10-GNG79P`](watchtowers.md#req-wt-10-gng79p): once its own
affected block, or a descendant preserving it, is finalized, it promptly attempts an ordinary
snapshot publication so its history's checkpoint can settle first.

## Evidence, delivery, and misconduct

This section is explanatory; the binding rules are
[`REQ-WT-3-DT0GDX`](watchtowers.md#req-wt-3-dt0gdx),
[`REQ-WT-4-PNMYMP`](watchtowers.md#req-wt-4-pnmymp),
[`REQ-WT-6-B6TJXS`](watchtowers.md#req-wt-6-b6tjxs),
[`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx), and
[`REQ-WT-7-EF48M3`](watchtowers.md#req-wt-7-ef48m3) below.

An author with a selected tower delivers each produced block to its tower and expects a signed
receipt back; a block that never reached peers or the selected tower is treated as not produced for
delegated purposes. Receipts are availability-credit-bearing: a participant's signature credits
only itself, while one tower signature over the exact block credits every eligible participant that
delegated to that tower — so in a channel where several peers share one tower, a single tower
receipt can carry several availability credits, and if every eligible participant delegated to it,
one signature can satisfy the whole availability threshold and let the author skip calldata. No
receipt supplies a participant finality vote: ordinary block and milestone finality count actual
participant votes, with the single exception of the AFK target's own credit on the exact restricted
AFK block ([`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz)). The agreement
deadline is the honest tower's subjective signing cutoff — a signature cannot prove when the block
first arrived, so consumers never re-check it — and there is no deadline comparator on the
resulting signature: what matters for it is the race against the author's own calldata submission —
credits that arrive first let the author skip calldata; after calldata is posted, the fallback
stands and a late signature forfeits the extra chain-fallback time of every participant it credits
(its own, for a participant signature; every credited assigned participant, for a tower signature)
while uncredited participants keep theirs. If the tower instead received no normal block for its
participant's scheduled slot by the end of the agreement window, it may author the restricted AFK
block for that slot inside the window of
[time.md §5.2](../protocol-model/time.md#52-objective-timestamp-validity-fraud-provable); the
participant's normal block and the tower's AFK block from the same slot are then two **legal
competing candidates**, not fraud — an uncommitted peer may accept and sign either valid candidate,
a committed peer keeps its branch
([`INV-FIN-2-MK27J6`](../protocol-model/finality.md#inv-fin-2-mk27j6)), and either branch's
evidence remains submittable. Misconduct is punished only for the three exact contradiction classes
defined by [`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx) below: (1) the same tower both
acknowledges its participant's normal block and authors the conflicting AFK block for that slot;
(2) the same tower signs confirmations of two distinct blocks at the same channel, fork, and
height; and (3) the same tower credits a timeout's named disputer and endorses that exact
**ordinary** timeout its own credit defeats. Everything else — silence, refusal, late delivery —
is subjective non-cooperation with future-interaction consequences only, though any _accepted_
delegated artifact keeps exactly the channel effect the dispute rules give it.

## Requirements and invariants

**<a id="req-wt-1-txw328"></a>`REQ-WT-1-TXW328` — Optional, frozen, participant-controlled selection carried by the accepted
join.** A participant MAY select exactly one watchtower per channel membership interval, named in
its inbound `JoinChannel` message. Only a registered,
bonded, unbarred tower ([`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r)) is selectable at the
time the join is accepted. For an absent participant, the first accepted join establishes that
participant and its selected tower for the new membership interval; the binding MUST be frozen for
that interval's entire lifetime — later slashing or loss of future eligibility does not change the
tower's authority or duties for it. A later accepted join while the participant is present is a
top-up and MUST NOT change the binding: the interval-establishing join remains the sole binding
authority. After the participant leaves, a later accepted join begins a new membership interval
and may establish the then-selected tower (or none). Every delegated
artifact MUST verify against the tower established by the accepted join of the membership interval
containing the artifact's slot or dispute — validators derive the authorized tower from that
historical join message, never from a separately signed assignment or epoch — and
the historical join evidence needed to validate a retained restricted AFK block or receipt stays
retained while any channel, dispute, timeout, or fraud obligation can still reference it; after
every such obligation ends, no permanent binding history is required.

**<a id="req-wt-2-hnza3y"></a>`REQ-WT-2-HNZA3Y` — Bounded independent observation, permissionless enforcement, restricted
authoring.** A selected tower MUST spectate each assigned live channel and retain a bounded rolling
evidence set for it: the latest state and the evidence needed to audit that channel. It obtains the
selected participant's available history while that participant is online and maintains its own
dial-out spectator connections into the channel mesh, so its observation does not depend on its
participant's availability. It prunes that channel's data and leaves after settlement; long-lived
channels therefore require bounded, not growing, tower state. Other peers may refuse off-chain
delivery to the tower; the dispute game then supplies the existing on-chain availability and
auditability path, and the tower retains the same ability as an auditing participant to detect and
kill an invalid dispute from its retained evidence and the dispute inputs. The tower's classical
duty stays separate and permissionless: any observer, selected or not, may submit the existing
fraud proofs. A tower is never an ordinary channel participant **as a role**: it is outside
channel membership and the authoring schedule, holds no threshold role, and its **only**
authoring authority is the
restricted AFK block of [`REQ-WT-3-DT0GDX`](watchtowers.md#req-wt-3-dt0gdx) — one canonical
removal of the participant it represents, at a slot where that participant is the scheduled author
in the block's proved pre-state. Every other tower-authored body, target, or coordinate is rejected
by every validation context. The issuance scope needs no separate quota — ordinary per-slot
validity defines it completely: for each proved pre-state in which the represented participant is
present and scheduled as the slot's author, the selected tower MAY author one canonical restricted
AFK block after the peer-to-peer and agreement windows expire without it receiving the
participant's normal block. Duplicate delivery of the same block is idempotent. Once an applied
AFK block removes the participant on a branch, the participant cannot be scheduled again there, so
no further AFK block for that participant is valid on that branch until a later accepted inbound
join establishes a new membership interval
([`REQ-WT-1-TXW328`](watchtowers.md#req-wt-1-txw328)) — the same recurrence as an ordinary
peer-initiated timeout against a failing scheduled author, with the tower acting after the
peer-to-peer and agreement windows instead of waiting through the chain-fallback window. Horizontal
deployment, capacity allocation, replication, admission policy, and exact pruning mechanics are
implementation concerns; a self-hosted tower and a provider-operated fleet carry identical protocol
authority.

**<a id="req-wt-9-gkfqxz"></a>`REQ-WT-9-GKFQXZ` — The selected tower is its participant's authorized dispute representative.**
While its participant is unavailable, a selected tower MAY act for that participant on-chain: audit
disputes, submit the participant's dispute, and submit a counter-dispute. A valid delegated
submission is the represented participant's submission, not the tower's independent dispute: the
participant remains the named disputer and logical submission actor — the tower is only the
transport sender — and eligibility, throttling, `hasPosted`, the per-fork slot, dispute stake,
slashing exposure, and outcome effects are keyed by the named participant exactly as if it had
submitted itself, so a shared tower may submit once for each represented participant but never
twice for the same one. The tower signs the exact encoded dispute with its registered tower key, and the
chain accepts the submission only when the sender is the participant's frozen selected tower for
the relevant membership interval; the dispute's channel, fork, and content bindings provide replay
protection, and the participant's funds-controlling key is never required or held by the tower. A
delegated submission MUST NOT carry a participant-owned voluntary effect — in particular no
`selfRemoval` input; the delegation is protective. Exactly one dispute may be submitted for a
participant in a given disputed fork: whichever valid transaction from the participant or its
selected tower is ordered first on-chain succeeds and consumes that participant's submission slot,
and the later duplicate MUST revert with a clear already-submitted error — chain transaction order
is authoritative, and no separate coordination protocol exists. A tower should abstain when it
observes that its participant already initiated the relevant dispute — a dispute for the same
channel and disputed fork naming that participant as disputer — but that abstention is off-chain
efficiency policy, not a correctness rule. A negligent or malicious delegated submission is a
service failure inside the selection trust boundary: its dispute-game consequences fall on the
represented participant, whose remedies are its prior tower choice, any objective equivocation
evidence, and a different selection in later joins; the protocol pays no compensation. This
delegated path neither replaces nor restricts permissionless fraud proofs, and the
kill-versus-counter-dispute ordering question of
[`OQ-1-NTJBA1`](../open-questions.md#oq-1-ntjba1) applies to delegated submissions unchanged. The
chain-side acceptance and slot rules are
[`REQ-DIS-15-GH01J0`](../disputes/disputes.md#req-dis-15-gh01j0). All delegated actions remain
subject to the existing dispute and chain-time windows.

**<a id="req-wt-3-dt0gdx"></a>`REQ-WT-3-DT0GDX` — Exactly-bound tower artifacts: availability receipt, restricted AFK block,
and dispute approval.** The delegated model defines three signed wire concepts, each bound so it
can never be replayed for another slot or actor (field catalog:
[data-types.md §7.5](../protocol-model/data-types.md#75-watchtower-evidence)):

- `BlockConfirmationReceipt` — one signer's acknowledgement of the exact author block, binding the
  signer, the author, channel, fork, height, and exact block. The signer is a receiving
  participant or a registered tower, and the artifact is validated exactly like an ordinary
  block-confirmation signature and stored in the same confirmation carrier — there is no separate
  per-tower receipt path. The signature has the effect of **every authority its recovered
  address holds** (the overlap rule of the central key policy,
  [identity.md](../protocol-model/identity.md#identity)): participant authority credits only
  that participant; tower authority credits every eligible assigned participant in that block's
  availability set whose frozen selected tower is the signer. The verifier MUST derive those
  **availability credits** deterministically from the membership intervals' accepted-join
  bindings and deduplicate them
  against direct acknowledgements, so one shared-tower signature may count for several
  participants and may satisfy the full availability threshold alone. An availability credit is
  never a participant finality vote
  ([`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz)).
- the **restricted AFK block** — not a second attestation with its own validity rules, but a
  variant of the ordinary signed block: the header's author is the **tower key**, and the canonical
  body identifies the restricted removal operation and the represented
  participant; channel, fork, height, timestamp, predecessor hash, resulting snapshot hash,
  and message commitments remain the ordinary block fields. The signed bytes bind the exact
  target, and the authoring tower's authority derives from the accepted join of the target's
  membership interval containing the slot
  ([`REQ-WT-1-TXW328`](watchtowers.md#req-wt-1-txw328)); a verifier MUST reject alternate encodings, trailing calls, arbitrary selectors, extra
  targets or messages, and mismatched tags. Its timestamp MUST lie in the restricted window of
  [time.md §5.2](../protocol-model/time.md#52-objective-timestamp-validity-fraud-provable), its
  proved pre-state MUST schedule the represented participant as the slot's author, and its
  transition MUST be exactly the non-punitive removal of that participant through the common exit
  path ([state-machines.md §6.2](../protocol-model/state-machines.md#62-_removeparticipantaddress--soft-removal)).
  The same signed block bytes and transition predicate serve block intake and timeout validation;
  the timeout-evidence context of
  [data-types.md §7.1](../protocol-model/data-types.md#71-disputes) supplies the slot-validation
  witnesses, and a hash without available preimages is insufficient.
- `WatchtowerDisputeApproval` — binds the selected tower, its offline participant, and the exact
  signed-dispute hash; the tower's authority for the dispute derives from the accepted join of the
  participant's relevant membership interval. It asserts that the tower independently audited that
  specific dispute — including its complete mode-defining evidence, latest proof, and output — and
  approves threshold finality in place of its participant's signature.

A verifier MUST reject an artifact whose channel, fork, height, participant,
signer, or block binding does not match the exact slot and actor it is presented for, and an
artifact whose signer is not the tower established for the relevant membership interval. This artifact
contract is also the runtime → disputes boundary contract for delegated evidence: the artifacts are
produced under this document's duties and consumed by the dispute rules
([`REQ-DIS-11-JJ9FG3`](../disputes/disputes.md#req-dis-11-jj9fg3),
[`REQ-DIS-12-1ZN453`](../disputes/disputes.md#req-dis-12-1zn453),
[`REQ-DIS-13-1WWHS0`](../disputes/disputes.md#req-dis-13-1wwhs0),
[`REQ-DIS-14-032T4M`](../disputes/disputes.md#req-dis-14-032t4m)); the boundary-level interaction
plan is [`REQ-WT-3-DT0GDX.T2`](../interactions.md#req-wt-3-dt0gdx.t2).

**<a id="req-wt-4-pnmymp"></a>`REQ-WT-4-PNMYMP` — Author-to-tower delivery is part of delegated availability.** An author with
a selected tower must gossip its exact block to its own tower by the agreement deadline, and an
honest available tower receives it and gossips it through the channel. A block the author did not
deliver to its tower — whether the author failed to send it, or the tower or its connection is
faulty — is treated as unavailable for delegated purposes even if the author produced it locally: a
local block not gossiped to peers or the selected tower is equivalent to no produced block. The
author also expects a signed receipt for its exact block from its own tower, but that receipt does
not gate the calldata fallback: the author posts calldata exactly as today — only when the
availability threshold is not reached by the deadline, counting every availability credit (direct
participant acknowledgements and any tower signatures; its own tower's signature may help but is
not required when others sign). Availability completion lets the block skip calldata while it
remains unfinalized; it never creates a final snapshot, a milestone, a settlement right, or an
ordinary dispute-confirmation vote. A missing receipt from its own tower is only a subjective
signal that the tower is not cooperating and a reason to consider selecting a different tower
later. Absence of the receipt alone is never objectively punishable, and a tower that has already
authored the slot's restricted AFK block issues no normal-block acknowledgement for that slot at
all ([`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx)). Receipt validity is not cut off by a
deadline comparator: the author MAY count any credit that arrives before it submits calldata; once
the author has submitted calldata, the ordinary fallback stands and a later-arriving signature
forfeits the additional chain-fallback time of every participant it credits — its own for a
participant signature, every credited eligible assigned participant for a tower signature — while
uncredited participants keep theirs
([`REQ-DIS-12-1ZN453`](../disputes/disputes.md#req-dis-12-1zn453)). Whether to sign is the tower's subjective timing judgment
([time.md §5.1](../protocol-model/time.md#51-subjective-checks-local-gates-never-slashable)): an
honest selected tower signs an acknowledgement only for an exact block that first reached it
off-chain by the applicable agreement deadline and stays silent on a later first arrival, but a
signature neither records nor proves when the block first arrived, so this cutoff is an
honest-tower duty, never a consumer-verifiable receipt condition. The one exception mirrors the
peer-side rule: a block that already carries full participant finality passes the tower's
subjective timing judgment regardless of when it first arrived — every required participant
accepted it, so the tower accepts it too and stays in sync; its own acknowledgement stays
unnecessary there and adds no credit. The only objective time check
is the block's own recorded timestamp, which must fall within the established validity range of
[time.md §5.2](../protocol-model/time.md#52-objective-timestamp-validity-fraud-provable); an
out-of-range timestamp is an objective validity failure of the block itself. If the selected
tower signs a valid in-range block, the signature keeps every normal availability, forfeiture, and
ordinary-timeout-defense effect, and the assigned peer MUST accept the exact block on that
valid confirmation — even when the peer's own local clock would have placed the block outside its
subjective agreement window; the peer skips only its own local arrival-window gate
([time.md §5.1](../protocol-model/time.md#51-subjective-checks-local-gates-never-slashable)) and
may not redo the tower's timing judgment — except that this arrival exception never makes a peer
switch a signed history: a peer already committed to a conflicting candidate keeps its commitment
and treats the confirmation as evidence only. The tower's valid confirmation is sufficient by
itself for the peer's availability credit and every normal receipt effect — the peer's own
acknowledgement is never a prerequisite, and an offline peer's missing signature changes nothing;
an available peer that receives the tower-confirmed block accepts it and adds its own ordinary
confirmation, so every available acknowledgement is collected as an additive signature, never as a
condition that weakens the tower's receipt. The additive duty has three branches on calldata
order. Before the block is posted as calldata, an available tower-confirmed peer adds its direct
confirmation under normal eligibility. After calldata, a tower-credited peer that is the next
author emits no redundant direct signature — the posted-calldata next-author refusal of
[`REQ-BLOCK-PIPE-10-PHAKE2`](../block-progression/block-processing.md#req-block-pipe-10-phake2)
stands, and the accepted tower confirmation has already supplied the credit and forfeited that
peer's extra chain-fallback time. After calldata, a tower-credited peer that is not the next
author adds its direct confirmation: the additive signature does not affect the next author's
extra time and helps ordinary finality by reducing reliance on virtual voting. Both artifacts are
stored and deduplicate to one participant availability credit. Signing a block first received late
is subjective service failure only — never rejected, never punished, and never bond-burning unless
the signature also forms one of the contradiction pairs of
[`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx) below. Signature delivery is likewise separate
from block arrival: a confirmation produced from a timely arrival stays valid when it reaches the
author or the credited participant after the deadline, with exactly the before-calldata or
after-calldata effect defined by
[`REQ-DIS-12-1ZN453`](../disputes/disputes.md#req-dis-12-1zn453). The tower also stays silent
once the exact block has been posted as calldata; a late tower signature over a timely arrival is
a service defect with the forfeiture effect above, never objectively contradictory fraud, and the
affected participants' remedy is selecting a different tower for future channels. That calldata
fallback protects the **ordinary** timeout path only: it does not defeat a timeout carried by a
valid restricted AFK block from the same selected tower
([`REQ-DIS-13-1WWHS0`](../disputes/disputes.md#req-dis-13-1wwhs0)) — choosing a tower deliberately
delegates the power to remove the author when author-to-tower delivery failed. The agreement-time
window is the practical reliability boundary: it should give honest towers a high probability of
timely receipt without making timely delivery a slashable guarantee. The confirmation's path
through block ingress, merge, availability credit, and finality is owned by
[`REQ-BLOCK-PIPE-11-DCHAJ2`](../block-progression/block-processing.md#req-block-pipe-11-dchaj2)
and [`REQ-FIN-7-RTZWQZ`](../protocol-model/finality.md#req-fin-7-rtzwqz); the boundary-level
interaction plan is the row [`REQ-WT-4-PNMYMP.T2`](../interactions.md#req-wt-4-pnmymp.t2) there.

**<a id="req-wt-5-t5zftz"></a>`REQ-WT-5-T5ZFTZ` — Authorized key, never a service endpoint.** The on-chain selection record —
the accepted join — exposes
the tower's authorized signing key and MUST NOT expose a dialable service endpoint. A tower watches
channel-creation and join events, initiates a channel-specific DHT connection to its assigned participant
through hole punching, and may remain behind a firewall. The participant must admit that connection
and supply the relevant data; a participant that declines has declined the availability service and
receives no corresponding tower guarantee. Third parties cannot derive a direct dial path from the
selection record alone. Providers may operate independent tower instances without changing the
one-selected-tower authority per participant.

**<a id="req-wt-6-b6tjxs"></a>`REQ-WT-6-B6TJXS` — A receipting tower must relay.** When a selected tower receipts an author's
exact block for its participant, it must gossip that exact block and the receipt to that
participant, and the participant must accept the delivered block and receipt — unless the
participant is already committed to a conflicting candidate at that coordinate, in which case the
no-switch rule of [`INV-FIN-2-MK27J6`](../protocol-model/finality.md#inv-fin-2-mk27j6) applies
first: receiving and storing the available data establishes availability and its ordinary-timeout
consequences without forcing a conflicting participant vote. An available uncommitted
participant also adds its own ordinary confirmation of the accepted block — an additive signature
that is never a prerequisite for the tower receipt's effects and follows the three calldata
branches of [`REQ-WT-4-PNMYMP`](watchtowers.md#req-wt-4-pnmymp): always before calldata, and
after calldata only when the participant is not the next author. A participant whose
tower fails that relay may still encounter a rare timeout race and bear the existing
disputer-penalty outcome if its tower's receipt is later produced — any holder may submit the
receipt while the dispute runs ([`REQ-DIS-11-JJ9FG3`](../disputes/disputes.md#req-dis-11-jj9fg3)).
That penalty is kept deliberately and is never waived: the selected tower is inside the
participant's chosen authority path, and a waiver would let a participant and its tower submit
defeated timeouts without bearing the failed-dispute cost — any remedy for poor tower service is
outside this dispute outcome. The relay failure itself is subjective, gives the participant a
clear reason to select a different tower in later joins, and creates no protocol penalty for the
tower. When a peer and its selected tower both
fail to acknowledge an otherwise available block, the author posts calldata and the current channel
proceeds under the ordinary fallback; other towers may treat that non-cooperation as a subjective
reason to advise their participants against future channels with that tower or its delegates, with
no penalty and no current-channel effect.

**<a id="req-wt-10-gng79p"></a>`REQ-WT-10-GNG79P` — Disconnection-triggered publication of the affected history.** On
detecting disconnection or partition from their selected tower, a participant identifies their own
authored block at the affected slot — the slot where their normal history and the tower's possible
AFK history can diverge — and retains its exact channel, fork, slot, and block commitment. Once they
observe participant finality for that block, or for a later descendant snapshot that preserves it,
they promptly attempt an ordinary normal snapshot publication with the valid proof and transaction
data. A finalized predecessor, an unrelated or conflicting block, an equal-height or
equal-membership alternative, or availability-only credits do not satisfy the duty; the qualifying
descendant may be authored by any peer, not only by them. The duty uses existing disconnect and
observation signals — no new protocol timer, two-phase settlement, or delayed activation — and
authoring, gossip, and finality collection keep running while publication is pending. The candidate
must carry its actual finality certificate, checkpoint-compatible continuation, inbound
consumption, and outbound/state data
([`REQ-LIF-2-Z3Z9Y3`](../settlement/lifecycle.md#req-lif-2-z3z9y3)); equal membership or a later
height does not establish inclusion of the affected block. If other participants withhold their
votes, no qualifying finalized candidate may ever arrive: the duty is to attempt, not to guarantee
finality or settlement. An unidentified or missing affected block, missing ancestry data, pending
inbound consumption, a failed transaction, a replacement candidate, reconnect, duplicate triggers,
and a newer compatible checkpoint are handled through existing recovery and safe deduplication; a
retry or replacement candidate must still preserve the affected block. Protection requires that
history's checkpoint to settle before any incompatible checkpoint; neither off-chain finality nor
the participant's pending transaction overrides a conflicting checkpoint that already settled.
Towerless participants have no disconnection trigger and no such duty.

**<a id="inv-wt-1-st9shx"></a>`INV-WT-1-ST9SHX` — Only genuinely incompatible signed statements are equivocation, in either
order.** Three contradiction classes are objectively punishable under
[`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r), regardless of signing order, and both sides
of every class MUST be signed by the same actual tower key — different participant and tower keys
never become one signer through credit derivation. **Normal acknowledgement versus conflicting AFK
authorship:** a tower that has acknowledged its represented participant's exact normal block for a
slot — directly, or indirectly through its own signed descendant of that block under the common
ancestry meaning — MUST NOT author or confirm the conflicting restricted AFK block for that slot,
and a tower that has authored its AFK block for a slot MUST NOT later acknowledge the competing
normal block: if the normal block arrives after the AFK block was authored, the tower issues
nothing. The tower authoring **and** confirming the same exact AFK block is compatible — one
history, no contradiction. **Confirmation double-sign:** a tower MUST NOT sign confirmations of
two distinct blocks at the same `(channelId, forkId, blockHeight)`; the two signatures are
objective tower fraud beside any participant's own qualifying same-key signature pair, which the
`BlockDoubleSign` proof slashes separately
([`REQ-FP-2-CH4DA1`](../disputes/fraud-proofs.md#req-fp-2-ch4da1)). Duplicate delivery of the
same block's confirmation, or confirmations at different heights or forks, contradict nothing.
**Credit versus defeated ordinary dispute:** a tower whose acknowledgement credits the named
disputer of an **ordinary** timeout — the mode where that credit kills the timeout under
[`REQ-DIS-11-JJ9FG3`](../disputes/disputes.md#req-dis-11-jj9fg3) — MUST NOT approve or submit
that exact timeout, in either order; the same credit beside its endorsement of a valid
AFK-evidence timeout is **compatible**, because no acknowledgement defeats that mode — including
shared-tower and descendant-carried credit — and invalid AFK evidence gains no such compatibility
by assertion. This dispute-endorsement compatibility never exempts the first class: normal-block
acknowledgement versus conflicting AFK authorship burns the bond in either order. A double-sign or
AFK-authorship proof qualifies as tower contradiction only when the signatures carried real frozen
selected-tower authority at that coordinate (a barred tower stays frozen, and liable, for its
existing channels); a registered but unassigned tower's pair supplies no credit and burns nothing.
Only the tower's own contradictory signed operations qualify: a represented participant's later
direct signature may defeat an endorsed ordinary timeout — with the participant bearing the normal
failed-dispute consequence — but another identity's signature or conduct is never fraud evidence
against a tower (an identity holding both participant and tower authority answers each predicate
with its own signatures, evaluated independently — the overlap rule of the central key policy),
and — when participant and tower hold different keys, the recommended setup
of the central key policy
([identity.md](../protocol-model/identity.md#identity)) — the participant's normal block beside
their tower's AFK block carries no qualifying same-key pair and is never a participant double-sign
pair ([`REQ-FP-2-CH4DA1`](../disputes/fraud-proofs.md#req-fp-2-ch4da1)); a manually reused
participant key falls under that policy's ordinary attribution instead. A receipt and an approval
about the same slot are otherwise **compatible**: the target's own tower may truthfully receipt
the target's authored block and still audit and approve a valid timeout from a disputer whose side
never acknowledged it. Contradiction does not change either artifact's channel role: an accepted
AFK block remains usable as timeout evidence whether a contradictory receipt was signed before or
after it, and an accepted acknowledgement keeps its defined availability and ordinary-kill
effects. A valid contradictory pair burns the tower's bond exactly once, in either arrival or
signing order; duplicate submissions and multiple proofs of the same conflict are no-ops, and
compatible signatures MUST never be combined into a false contradiction. The punishment path is
external to the channel protocol: equivocation evidence never slashes the represented participant,
invalidates the AFK artifact, suppresses a channel timeout, restores a removed participant, kills
a dispute, reopens settlement, or alters an already-final delegated output; its only consequences
are the tower's bond and future eligibility. Divergent same-fork histories are resolved by
no-switching, checkpoint-preserving settlement, and the dispute game
([`INV-FIN-2-MK27J6`](../protocol-model/finality.md#inv-fin-2-mk27j6),
[`REQ-LIF-2-Z3Z9Y3`](../settlement/lifecycle.md#req-lif-2-z3z9y3)), never by this punishment.

**<a id="req-wt-7-ef48m3"></a>`REQ-WT-7-EF48M3` — No tower means the existing protocol, unchanged.** A participant may join
without a selected tower. It receives no delegated receipt, restricted AFK block, or signature
substitution and remains on the ordinary protocol path: its authored block needs the existing
acknowledgements or the calldata fallback; a timeout against it waits through the full ordinary
window; no other actor may remove its threshold role or author a removal on its behalf; and it has
no tower-disconnection trigger or publication duty beyond ordinary operation. Counterparties may
independently decline future channels with participants that provide no tower-backed liveness
guarantee; that is subjective policy with no objective protocol effect.

**<a id="req-wt-8-w3yp4r"></a>`REQ-WT-8-W3YP4R` — Permanent registration bond, external punishment, and the misconduct
boundary.** A tower identity registers by escrowing a fixed, minimal, one-time bond. The bond is
permanently non-withdrawable: no release or unbonding path exists at any point, and stopping the
acceptance of new channels neither releases the bond nor ends liability for contradictory
signatures the identity already issued. The bond is a cost of operating under the identity — a
Sybil cost, not a proof or guarantee of honesty; a fresh identity requires a fresh bond. The only
protocol-punishable tower misconduct is objectively contradictory signed evidence
([`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx)), enforced through a punishment entry point
separate from the channel protocol: any observer MAY submit the contradictory signed artifacts
whenever it discovers them — the protocol prescribes no off-chain proof storage — and a valid,
self-contained proof immediately destroys the unslashed identity's bond and sets a permanent
barred flag that future selection MUST check. Submitting a contradiction proof is an unrewarded
public-good action by design: honest standard software submits it because barring an equivocating
tower protects the network, the transaction is expected to be cheap, and the absence of a direct
reward is an accepted low-priority incentive risk — subsidy options are Future Work, not current
protocol requirements. Rejection of a single malformed or invalid tower
block or artifact creates no bond offense beyond those contradiction classes. The punishment does
not kill, reopen, or otherwise affect any channel dispute or settlement, and the slashed tower
keeps its authority and duties for previously assigned live channels for their full lifetime
([`REQ-WT-1-TXW328`](watchtowers.md#req-wt-1-txw328)). Every failure that produces **no accepted
delegated artifact** — silence, refusal to receipt, author, or approve, late delivery — is
subjective non-cooperation: it is never slashable, and it has no protocol penalty, no bond effect,
no threshold effect, and no current-channel outcome effect. An _accepted_ valid receipt, restricted
AFK block, or approval, by contrast, has exactly the channel effect the dispute rules define,
even when issuing or withholding it was itself a service failure. Observers may apply their own
future-interaction policy either way and are never required to agree. The exact on-chain contract
and function placement of registration and punishment is implementation design.

## Assumptions and constraints

- One selected tower per participant; multiple towers per participant and receipt aggregation are
  out of scope for this version.
- Role separation is by recovered key attribution, never by address admission. Separate signing
  identities for a participant and its selected tower are the recommended setup; manual key
  reuse stays fully attributable to the one recovered participant identity with its double-sign
  liability, and is never an admission-rejection ground — the central key policy of
  [identity.md](../protocol-model/identity.md#identity) governs.
- The registration chain and the accepted join messages are the source of tower authority; the
  tower's operational
  shape (self-hosted or provider fleet) is invisible to the protocol.
- Author-to-tower and tower-to-participant connectivity are best-effort private connections; the
  windows of [time.md](../protocol-model/time.md) must dominate their expected latency for the
  delegated services to be useful.
- A frozen tower receipt establishes availability toward the represented side even when relay
  fails; that peer bears the existing ordinary-timeout defense and penalty exposure, and the
  protocol neither bounds that penalty nor turns a subjective selection or partition failure into
  objective tower fraud.
- Fee and reward design for tower service, and compensation for a removed participant, are out of
  scope.
- Tower fleet topology, horizontal scaling, capacity management, admission policy, replication, and
  pruning mechanics are implementation concerns; the observable guarantee is the bounded rolling
  evidence set of [`REQ-WT-2-HNZA3Y`](watchtowers.md#req-wt-2-hnza3y).

## Security considerations

The delegated powers are deliberate trust boundaries, each with a stated failure mode:

- **Dispute approval** finalizes the complete output of one audited timeout dispute with no later
  kill-period challenge; an offline participant whose tower colludes with the remaining peers has
  delegated exactly that and relies on its prior tower choice
  ([`REQ-DIS-14-032T4M`](../disputes/disputes.md#req-dis-14-032t4m)).
- **The restricted AFK block** removes its represented participant without their signature. The
  exposure requires a tower that can author: a malicious tower, or one partitioned from its author
  but connected to the other peers, can produce a valid AFK block for an otherwise compliant
  participant, and the AFK-evidence timeout it backs waives that participant's acknowledgement and
  calldata defenses ([`REQ-DIS-13-1WWHS0`](../disputes/disputes.md#req-dis-13-1wwhs0)). The
  removal is non-punitive; a fully unavailable tower cannot author anything and only degrades the
  service to the ordinary fallback path. The participant's remedy is its prior tower choice, the
  publication duty of [`REQ-WT-10-GNG79P`](watchtowers.md#req-wt-10-gng79p), later objective
  contradiction evidence, and a different selection in later joins.
- **Receipts** are evidence against the sides they credit; a tower that receipts and fails to relay
  exposes only its own delegated participants to the existing ordinary disputer penalty — kept
  deliberately, never waived: own-tower relay failure is inside the participant's selected trust
  boundary ([`REQ-WT-6-B6TJXS`](watchtowers.md#req-wt-6-b6tjxs)). Because one tower signature can credit
  several participants, the availability-credit derivation must be deterministic and deduplicated
  ([`REQ-WT-3-DT0GDX`](watchtowers.md#req-wt-3-dt0gdx)) so no implementation can attribute a
  signature to the wrong authority — and tower-derived credit never supplies an assigned peer's
  participant finality vote (a recovered signer that is itself a participant keeps its own vote —
  central key policy), so tower authority alone can never finalize a block.
- **The accepted pre-publication race:** ordinary block finality requires actual participant
  votes, with the single AFK target-only exception. An honest non-target participant required on
  both certificates refuses the conflicting vote and blocks the competing certificate. Where the
  AFK target is the only honest participant and their tower misses their block, colluding other peers
  plus the target-only exception can permit competing certificates before settlement; protection
  is that their history's exact checkpoint settles first
  ([`REQ-WT-10-GNG79P`](watchtowers.md#req-wt-10-gng79p),
  [`REQ-LIF-2-Z3Z9Y3`](../settlement/lifecycle.md#req-lif-2-z3z9y3)). No probability or one-round
  bound is proved, and a later conflicting branch cannot displace the winning settled checkpoint.
- The public binding reveals that a participant has a tower and which key it uses, but not an
  attack surface: the tower is dial-in-only ([`REQ-WT-5-T5ZFTZ`](watchtowers.md#req-wt-5-t5zftz)),
  and the anonymous-sampled-tower idea remains a compatible non-normative complement for classical
  monitoring, not the authorization path for receipts or approvals.
- Objective punishment is confined to signed contradictions and runs outside the channel protocol,
  so subjective service disputes can never be weaponized into slashes, threshold effects, or
  channel outcomes — while an accepted delegated artifact keeps its defined channel effect
  regardless of the tower's other statements or their order
  ([`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r)). The permanent bond imposes a Sybil cost
  on identity churn but deliberately proves nothing about operator honesty or uniqueness.
  Contradiction-proof submission carries no reward — an accepted low-priority incentive risk
  ([`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r)); a contradiction proof burns and bars the
  tower only, and never restores a removed participant or reverses a settled channel outcome.
- **Shared-tower concentration** is a deliberate deployment choice, not a protocol defect:
  participants whose accepted joins select one shared tower jointly place that channel partition
  inside the same operator's trust boundary for the tower's delegated dispute and removal powers.
  The scope and alternatives are stated in the trust model
  ([trust-model.md §7](../security/trust-model.md)).
- **Delegated dispute submission** makes the tower the participant's authorized representative: an
  accepted submission carries the participant's full dispute-game exposure, so a negligent or
  malicious tower can spend the participant's slot or draw the disputer penalty onto it — a
  service failure inside the selection trust boundary with no protocol compensation
  ([`REQ-WT-9-GKFQXZ`](watchtowers.md#req-wt-9-gkfqxz)). The one-slot first-ordered rule keeps the
  worst case bounded to what the participant could have done itself.

## Verification and test plan

### Watchtower test matrix

| Plan item                                             | Requirements / invariants                             | Setup and stimulus                                                                                                                                                                                                                                                                               | Expected result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-wt-1-txw328.t1"></a>`REQ-WT-1-TXW328.T1`   | [`REQ-WT-1-TXW328`](watchtowers.md#req-wt-1-txw328)   | Establish a binding through an accepted join, attempt to change it through a top-up join while present, rejoin after removal with a different tower, and slash the tower mid-interval.                                                                                                           | The interval-establishing accepted join freezes the binding for the membership interval; a top-up join changes nothing; every artifact verifies against the interval's established tower; a rejoin's accepted join establishes the new interval's tower; a mid-interval slash changes nothing for that interval; historical join evidence outlives the participant while obligations remain.                                                                                                                                                                                                                                                                                                                                                                                  | <a id="req-wt-1-txw328.t1.p1"></a>`REQ-WT-1-TXW328.T1.P1` — a top-up join while the participant is present cannot change the established binding; <a id="req-wt-1-txw328.t1.p2"></a>`REQ-WT-1-TXW328.T1.P2` — after removal, a later accepted join establishes the new membership interval's tower, applying only to that interval; <a id="req-wt-1-txw328.t1.p3"></a>`REQ-WT-1-TXW328.T1.P3` — artifacts verify only against the tower established by the accepted join of the membership interval containing their slot or dispute; <a id="req-wt-1-txw328.t1.p4"></a>`REQ-WT-1-TXW328.T1.P4` — a join naming an unregistered, unbonded, or barred tower is not selectable; <a id="req-wt-1-txw328.t1.p5"></a>`REQ-WT-1-TXW328.T1.P5` — tower slashed during an active membership interval keeps that interval's binding, authority, and duties for its full lifetime; <a id="req-wt-1-txw328.t1.p6"></a>`REQ-WT-1-TXW328.T1.P6` — historical join evidence needed by a retained AFK block or receipt stays available after the participant's removal, until every dependent obligation ends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| <a id="req-wt-2-hnza3y.t1"></a>`REQ-WT-2-HNZA3Y.T1`   | [`REQ-WT-2-HNZA3Y`](watchtowers.md#req-wt-2-hnza3y)   | The selected participant supplies history, goes offline, and every other peer withholds off-chain data until one of them opens a dispute; separately drive a long-lived channel to settlement and attempt tower-authored bodies.                                                                 | The tower retains the bounded live-channel evidence, observes the dispute's available inputs, and can kill an invalid dispute; its only accepted authored block is the exact restricted AFK removal of its represented scheduled participant, issued at most once per proved pre-state that schedules the still-present participant and never again on a branch where the removal applied, until a rejoin establishes a new membership interval; its state stays bounded and is pruned at settlement.                                                                                                                                                                                                                                                                         | <a id="req-wt-2-hnza3y.t1.p1"></a>`REQ-WT-2-HNZA3Y.T1.P1` — offline participant, Byzantine peers: invalid dispute killed from retained evidence; <a id="req-wt-2-hnza3y.t1.p3"></a>`REQ-WT-2-HNZA3Y.T1.P3` — self-hosted tower and provider fleet carry identical authority; <a id="req-wt-2-hnza3y.t1.p5"></a>`REQ-WT-2-HNZA3Y.T1.P5` — long-lived channel: evidence set stays a bounded rolling window and is pruned at settlement; <a id="req-wt-2-hnza3y.t1.p6"></a>`REQ-WT-2-HNZA3Y.T1.P6` — any tower-authored body other than the exact restricted AFK removal of its represented scheduled participant is rejected by every validation context; <a id="req-wt-2-hnza3y.t1.p7"></a>`REQ-WT-2-HNZA3Y.T1.P7` — the tower never enters channel membership, the authoring schedule, or a threshold role through its restricted authority; <a id="req-wt-2-hnza3y.t1.p8"></a>`REQ-WT-2-HNZA3Y.T1.P8` — a tower AFK block for a slot whose proved pre-state schedules a different participant is rejected; <a id="req-wt-2-hnza3y.t1.p9"></a>`REQ-WT-2-HNZA3Y.T1.P9` — after an applied AFK removal, no further AFK block for that participant is valid on that branch during the same membership interval; <a id="req-wt-2-hnza3y.t1.p10"></a>`REQ-WT-2-HNZA3Y.T1.P10` — after removal and a later accepted rejoin, the new membership interval's selected tower validly authors a fresh restricted AFK block for a missed slot of the new interval; <a id="req-wt-2-hnza3y.t1.p11"></a>`REQ-WT-2-HNZA3Y.T1.P11` — repeated miss on a branch where the earlier AFK block was not applied: each proved pre-state that schedules the still-present participant admits one canonical AFK block for its slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-wt-9-gkfqxz.t1"></a>`REQ-WT-9-GKFQXZ.T1`   | [`REQ-WT-9-GKFQXZ`](watchtowers.md#req-wt-9-gkfqxz)   | Have the selected tower submit its unavailable participant's dispute and counter-dispute, race it against the participant's own submission, and vary the signer, bindings, and inputs.                                                                                                           | The accepted delegated submission is the participant's submission with all participant effects; the first-ordered valid transaction wins the one slot and the duplicate reverts with a clear already-submitted error; non-assigned signers and participant-owned voluntary effects are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | <a id="req-wt-9-gkfqxz.t1.p1"></a>`REQ-WT-9-GKFQXZ.T1.P1` — tower submits the participant's dispute: participant is disputer, eligibility/throttle/`hasPosted`/stake/outcome apply to the participant; <a id="req-wt-9-gkfqxz.t1.p2"></a>`REQ-WT-9-GKFQXZ.T1.P2` — tower submits the participant's counter-dispute the same way; <a id="req-wt-9-gkfqxz.t1.p3"></a>`REQ-WT-9-GKFQXZ.T1.P3` — participant-first then tower duplicate: revert with the already-submitted error; tower-first then participant duplicate: same; <a id="req-wt-9-gkfqxz.t1.p4"></a>`REQ-WT-9-GKFQXZ.T1.P4` — a signer that is not the participant's frozen selected tower is rejected; <a id="req-wt-9-gkfqxz.t1.p5"></a>`REQ-WT-9-GKFQXZ.T1.P5` — a delegated submission carrying `selfRemoval` or another participant-owned voluntary effect is rejected; <a id="req-wt-9-gkfqxz.t1.p6"></a>`REQ-WT-9-GKFQXZ.T1.P6` — an invalid delegated dispute is killed with the participant bearing the existing disputer consequence; <a id="req-wt-9-gkfqxz.t1.p7"></a>`REQ-WT-9-GKFQXZ.T1.P7` — delegated submissions obey the existing dispute and chain-time windows; <a id="req-wt-9-gkfqxz.t1.p8"></a>`REQ-WT-9-GKFQXZ.T1.P8` — one shared tower submits for two represented participants inside one `evidenceTime`: both succeed on separate named-disputer accounting, and a second submission for either same participant reverts without touching the other.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="req-wt-3-dt0gdx.t1"></a>`REQ-WT-3-DT0GDX.T1`   | [`REQ-WT-3-DT0GDX`](watchtowers.md#req-wt-3-dt0gdx)   | Present each artifact — receipt, restricted AFK block, and approval — with correct and with mismatched channel, fork, height, participant, membership-interval, signer, body, and block bindings, including malformed encodings, duplicates, and shared-tower credit derivations.                | Exactly-bound artifacts verify; availability credits derive deterministically from the membership intervals' accepted-join bindings and deduplicate; only the exact canonical AFK removal executes; every mismatched, malformed, replayed, or duplicate presentation proves nothing and changes nothing for the presented slot.                                                                                                                                                                                                                                                                                                                                                                                                                                               | <a id="req-wt-3-dt0gdx.t1.p1"></a>`REQ-WT-3-DT0GDX.T1.P1` — valid receipt, restricted AFK block, and approval encodings verify; <a id="req-wt-3-dt0gdx.t1.p2"></a>`REQ-WT-3-DT0GDX.T1.P2` — wrong channel/fork/height binding rejected; <a id="req-wt-3-dt0gdx.t1.p3"></a>`REQ-WT-3-DT0GDX.T1.P3` — wrong participant or tower rejected, including a tower established only for a different membership interval; <a id="req-wt-3-dt0gdx.t1.p4"></a>`REQ-WT-3-DT0GDX.T1.P4` — wrong exact-block or dispute-hash binding rejected; <a id="req-wt-3-dt0gdx.t1.p5"></a>`REQ-WT-3-DT0GDX.T1.P5` — replay for another slot or dispute rejected; <a id="req-wt-3-dt0gdx.t1.p6"></a>`REQ-WT-3-DT0GDX.T1.P6` — duplicate delivery is idempotent; <a id="req-wt-3-dt0gdx.t1.p7"></a>`REQ-WT-3-DT0GDX.T1.P7` — participant signature credits only that participant's availability; <a id="req-wt-3-dt0gdx.t1.p8"></a>`REQ-WT-3-DT0GDX.T1.P8` — one shared-tower signature credits every delegated eligible participant's availability; <a id="req-wt-3-dt0gdx.t1.p9"></a>`REQ-WT-3-DT0GDX.T1.P9` — with a recovered tower signer that is not itself a channel participant, one tower signature satisfies the full availability threshold when every eligible participant delegated to it, while supplying zero finality votes; <a id="req-wt-3-dt0gdx.t1.p10"></a>`REQ-WT-3-DT0GDX.T1.P10` — tower credit and the same participant's direct acknowledgement deduplicate to one availability credit; <a id="req-wt-3-dt0gdx.t1.p11"></a>`REQ-WT-3-DT0GDX.T1.P11` — malformed, truncated, or trailing-byte AFK block bytes are rejected everywhere with no effect; <a id="req-wt-3-dt0gdx.t1.p12"></a>`REQ-WT-3-DT0GDX.T1.P12` — wrong tag, arbitrary selector, extra call, extra target, or extra message in the AFK body is rejected; <a id="req-wt-3-dt0gdx.t1.p13"></a>`REQ-WT-3-DT0GDX.T1.P13` — an AFK block whose resulting state is anything other than the exact non-punitive removal of the bound target is rejected; <a id="req-wt-3-dt0gdx.t1.p14"></a>`REQ-WT-3-DT0GDX.T1.P14` — tower gossip, peer validation, and timeout calldata decode the same AFK block bytes and reach the same verdict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| <a id="req-wt-4-pnmymp.t1"></a>`REQ-WT-4-PNMYMP.T1`   | [`REQ-WT-4-PNMYMP`](watchtowers.md#req-wt-4-pnmymp)   | Withhold, delay, and complete the author-to-tower delivery and its returned receipt against both the agreement deadline and the author's own calldata submission.                                                                                                                                | A missing own-tower receipt is a subjective signal only — calldata is gated by the unreached availability threshold counting all availability credits, not by the own-tower receipt; the agreement-deadline cutoff is the honest tower's subjective signing duty, never a consumer-verifiable receipt condition — any validly bound confirmation over an in-range block keeps its normal availability effects and binds the credited participant's acceptance regardless of delivery time or the participant's own local clock — the participant's own confirmation is additive when available and never a prerequisite; credits race the author's calldata submission rather than a deadline comparator; availability completion skips calldata without finalizing anything. | <a id="req-wt-4-pnmymp.t1.p1"></a>`REQ-WT-4-PNMYMP.T1.P1` — missing own-tower receipt: a subjective signal only — the author posts calldata because the availability threshold is unreached (other credits could have completed it), no objective penalty; <a id="req-wt-4-pnmymp.t1.p2"></a>`REQ-WT-4-PNMYMP.T1.P2` — credit arriving before the author submits calldata counts toward skipping it; <a id="req-wt-4-pnmymp.t1.p3"></a>`REQ-WT-4-PNMYMP.T1.P3` — signature arriving after calldata submission: fallback and anchor stand, every credited participant forfeits only its extra chain-fallback time, uncredited participants keep theirs, and the late signature alone slashes nothing; <a id="req-wt-4-pnmymp.t1.p6"></a>`REQ-WT-4-PNMYMP.T1.P6` — deadline-boundary arrival, immediately before: the exact block first reaches the tower immediately before the agreement deadline and the honest tower acknowledges it; <a id="req-wt-4-pnmymp.t1.p7"></a>`REQ-WT-4-PNMYMP.T1.P7` — timely arrival, confirmation delivered after the deadline but before calldata: the credit counts toward skipping calldata, and the credited participant accepts the exact block on the tower's valid confirmation alone — the participant's own signature is not a separate acceptance condition and the case must not require it; <a id="req-wt-4-pnmymp.t1.p8"></a>`REQ-WT-4-PNMYMP.T1.P8` — timely arrival, confirmation delivered after calldata: the fallback and anchor stand with the per-credit forfeiture of [`REQ-WT-4-PNMYMP.T1.P3`](watchtowers.md#req-wt-4-pnmymp.t1.p3), the credited participant's acceptance still binds, and nothing slashes; <a id="req-wt-4-pnmymp.t1.p9"></a>`REQ-WT-4-PNMYMP.T1.P9` — deadline-boundary arrival, immediately after (honest tower): the block first reaches the tower immediately after the agreement deadline and the honest tower subjectively declines — no acknowledgement even though calldata has not yet been submitted; <a id="req-wt-4-pnmymp.t1.p10"></a>`REQ-WT-4-PNMYMP.T1.P10` — deadline-boundary arrival, exactly at: the block first reaches the tower exactly at the inclusive agreement deadline under the existing deadline inclusivity rule and the honest tower acknowledges it; <a id="req-wt-4-pnmymp.t1.p11"></a>`REQ-WT-4-PNMYMP.T1.P11` — tower signs despite late first arrival: the author's exact block carries a timestamp inside the objective validity range and the tower signs it although the block first reached it after the subjective agreement window; the case first proves the tower receipt alone supplies the peer's availability credit and every ordinary-timeout-defense effect with no peer signature present, then proves an available assigned peer accepts the exact block on that valid confirmation and adds its own ordinary confirmation even though the peer's own local clock would place the block outside its own subjective agreement window — the peer skips only its local arrival-window gate and does not redo the tower's timing judgment, an offline peer's missing signature changes nothing, the violation is subjective service failure, and no bond punishment exists absent an objective contradiction pair; <a id="req-wt-4-pnmymp.t1.p12"></a>`REQ-WT-4-PNMYMP.T1.P12` — finality-accepted late arrival: a block carrying full participant finality first reaches the tower after the agreement deadline; the tower skips its subjective timing judgment, accepts the block, and stays in sync, issuing no acknowledgement; <a id="req-wt-4-pnmymp.t1.p13"></a>`REQ-WT-4-PNMYMP.T1.P13` — availability completion without finality: with a recovered tower signer that is not itself a channel participant, all availability credits arrive, the author skips calldata, and the block remains unfinalized with no snapshot, milestone, or settlement effect until actual participant votes finalize it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="req-wt-5-t5zftz.t1"></a>`REQ-WT-5-T5ZFTZ.T1`   | [`REQ-WT-5-T5ZFTZ`](watchtowers.md#req-wt-5-t5zftz)   | Observe a channel creation, then attempt unauthenticated direct contact and the tower-initiated DHT connection.                                                                                                                                                                                  | The on-chain binding permits evidence verification but not direct dialing; only the tower-initiated, participant-admitted connection supplies the availability service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | <a id="req-wt-5-t5zftz.t1.p1"></a>`REQ-WT-5-T5ZFTZ.T1.P1` — the on-chain selection record exposes no dialable endpoint; <a id="req-wt-5-t5zftz.t1.p2"></a>`REQ-WT-5-T5ZFTZ.T1.P2` — tower-initiated connection admitted by the participant supplies the service; <a id="req-wt-5-t5zftz.t1.p3"></a>`REQ-WT-5-T5ZFTZ.T1.P3` — participant that declines the connection receives no tower guarantee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-wt-6-b6tjxs.t1"></a>`REQ-WT-6-B6TJXS.T1`   | [`REQ-WT-6-B6TJXS`](watchtowers.md#req-wt-6-b6tjxs)   | Have a tower receipt the author's exact block while its participant has not yet received it; separately fail the relay and submit the receipt during the participant's ordinary timeout dispute; separately deliver the receipt to a participant already committed to the conflicting candidate. | The tower gossips block and receipt to its participant, who accepts them when uncommitted; a committed participant stores the evidence without switching; a failed relay is subjective service failure, and the receipt submitted by any holder during the ordinary dispute still kills that participant's timeout.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | <a id="req-wt-6-b6tjxs.t1.p1"></a>`REQ-WT-6-B6TJXS.T1.P1` — receipt relayed and accepted, and an available uncommitted participant adds its ordinary additive confirmation; <a id="req-wt-6-b6tjxs.t1.p2"></a>`REQ-WT-6-B6TJXS.T1.P2` — relay failure: any holder submits the receipt during the ordinary dispute and the participant bears the existing outcome, no protocol penalty for the tower; <a id="req-wt-6-b6tjxs.t1.p3"></a>`REQ-WT-6-B6TJXS.T1.P3` — unconfirmed peer and tower: author posts calldata and the channel proceeds ordinarily; <a id="req-wt-6-b6tjxs.t1.p4"></a>`REQ-WT-6-B6TJXS.T1.P4` — relay to a committed participant: the data is received and stored as availability evidence, no conflicting vote is produced, and the participant's signed branch stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-wt-10-gng79p.t1"></a>`REQ-WT-10-GNG79P.T1` | [`REQ-WT-10-GNG79P`](watchtowers.md#req-wt-10-gng79p) | Disconnect a participant from their selected tower while the channel continues, identify their affected authored block, and vary which candidate reaches finality, the data available, the transaction outcome, and the settlement order.                                                        | Only finality of the exact affected block or of a proved descendant preserving it triggers the prompt publication attempt; unrelated candidates do not; retries preserve the affected block; the duty guarantees an attempt, never settlement; a conflicting checkpoint that settled first is never overridden.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | <a id="req-wt-10-gng79p.t1.p1"></a>`REQ-WT-10-GNG79P.T1.P1` — on disconnection the participant identifies and retains their exact affected authored block's channel, fork, slot, and commitment; <a id="req-wt-10-gng79p.t1.p2"></a>`REQ-WT-10-GNG79P.T1.P2` — participant finality of the affected block triggers a prompt normal snapshot publication attempt; <a id="req-wt-10-gng79p.t1.p3"></a>`REQ-WT-10-GNG79P.T1.P3` — a finalized descendant authored by another peer whose proved ancestry preserves the affected block also qualifies; <a id="req-wt-10-gng79p.t1.p4"></a>`REQ-WT-10-GNG79P.T1.P4` — finalized predecessors, conflicting or unrelated blocks, equal-height or equal-membership alternatives, and availability-only credits do not satisfy the duty; <a id="req-wt-10-gng79p.t1.p5"></a>`REQ-WT-10-GNG79P.T1.P5` — duplicate disconnect triggers, reconnect, and another publisher's compatible success deduplicate safely; <a id="req-wt-10-gng79p.t1.p6"></a>`REQ-WT-10-GNG79P.T1.P6` — missing affected-block identity, missing ancestry data, or pending inbound consumption waits for valid data through existing recovery instead of publishing; <a id="req-wt-10-gng79p.t1.p7"></a>`REQ-WT-10-GNG79P.T1.P7` — a failed publication transaction retries with a candidate that still preserves the affected block; <a id="req-wt-10-gng79p.t1.p8"></a>`REQ-WT-10-GNG79P.T1.P8` — an incompatible checkpoint that settled first is not overridden by off-chain finality or the pending transaction; <a id="req-wt-10-gng79p.t1.p9"></a>`REQ-WT-10-GNG79P.T1.P9` — towerless participant: no disconnection trigger and no publication duty; <a id="req-wt-10-gng79p.t1.p10"></a>`REQ-WT-10-GNG79P.T1.P10` — withheld participant votes: no qualifying finalized candidate arrives and the duty ends at the attempt, with normal authoring and gossip continuing throughout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="inv-wt-1-st9shx.t1"></a>`INV-WT-1-ST9SHX.T1`   | [`INV-WT-1-ST9SHX`](watchtowers.md#inv-wt-1-st9shx)   | Sign normal acknowledgements, AFK blocks, conflicting confirmations, and timeout endorsements in both orders, including shared-tower, descendant-credit, forged, duplicate, barred-but-frozen, and unassigned-tower cases.                                                                       | Only the three contradiction classes slash; the same-AFK author-plus-confirmation pair and different-key pairs burn nothing; each accepted artifact keeps its defined channel role; an ordinary timeout dies only to a disputer-crediting acknowledgement while a valid AFK-evidence timeout survives them all; the bond burns exactly once per valid contradiction with channel state unchanged.                                                                                                                                                                                                                                                                                                                                                                             | <a id="inv-wt-1-st9shx.t1.p3"></a>`INV-WT-1-ST9SHX.T1.P3` — the external proof alters no channel dispute, settlement, or final delegated output; <a id="inv-wt-1-st9shx.t1.p4"></a>`INV-WT-1-ST9SHX.T1.P4` — compatible statements (receipt for the exact block, approval of an unrelated slot) are not equivocation; <a id="inv-wt-1-st9shx.t1.p5"></a>`INV-WT-1-ST9SHX.T1.P5` — the target's own-side receipt kills no disputer's ordinary timeout, whoever presents it; <a id="inv-wt-1-st9shx.t1.p6"></a>`INV-WT-1-ST9SHX.T1.P6` — a tower that receives the normal block after authoring its AFK block issues nothing and is not punishable; <a id="inv-wt-1-st9shx.t1.p7"></a>`INV-WT-1-ST9SHX.T1.P7` — target-side receipt plus a valid approved timeout from an unacknowledged disputer side is compatible: no bond burns, both artifacts keep their roles; <a id="inv-wt-1-st9shx.t1.p8"></a>`INV-WT-1-ST9SHX.T1.P8` — acknowledgement first, ordinary endorsement second: the tower credits the named disputer with the exact block, then submits or approves that disputer's ordinary timeout; the public fraud proof is exactly the tower's two signed artifacts, any observer slashes the bond, the acknowledgement defeats the dispute, and the represented disputer bears the normal failed-timeout consequence; <a id="inv-wt-1-st9shx.t1.p9"></a>`INV-WT-1-ST9SHX.T1.P9` — ordinary endorsement first, honest late arrival second: the tower stays silent and is not punishable; if it signs the crediting acknowledgement anyway, that tower-signed pair is slashable; <a id="inv-wt-1-st9shx.t1.p10"></a>`INV-WT-1-ST9SHX.T1.P10` — the represented disputer's own later direct signature defeats the endorsed ordinary timeout, the disputer bears the failed-dispute consequence, and no tower bond burns; <a id="inv-wt-1-st9shx.t1.p11"></a>`INV-WT-1-ST9SHX.T1.P11` — an approval bound to a different dispute hash than the defeated one is not that contradiction; <a id="inv-wt-1-st9shx.t1.p12"></a>`INV-WT-1-ST9SHX.T1.P12` — tower confirmation double-sign, both delivery orders: one frozen selected tower signs confirmations of two distinct blocks at the same channel, fork, and height — objective contradiction in either order, bond burned and identity barred; <a id="inv-wt-1-st9shx.t1.p13"></a>`INV-WT-1-ST9SHX.T1.P13` — shared-tower double availability: the shared tower completes both conflicting availability thresholds; both signatures slash the bond, any authoring participant's own double-sign is separately slashable, and the settled snapshot follows checkpoint-preserving settlement; <a id="inv-wt-1-st9shx.t1.p14"></a>`INV-WT-1-ST9SHX.T1.P14` — non-contradictions: tower confirmations at different heights or different forks burn nothing; <a id="inv-wt-1-st9shx.t1.p15"></a>`INV-WT-1-ST9SHX.T1.P15` — duplicate delivery of the same block's confirmation: no contradiction, no penalty; <a id="inv-wt-1-st9shx.t1.p16"></a>`INV-WT-1-ST9SHX.T1.P16` — unassigned-tower negative: a registered tower frozen for no eligible participant at that coordinate signs both blocks — no credit is supplied and the bond and barred flag stay unchanged; <a id="inv-wt-1-st9shx.t1.p17"></a>`INV-WT-1-ST9SHX.T1.P17` — normal acknowledgement versus conflicting AFK authorship, both orders: the same tower acknowledges its participant's exact normal block (directly or through its own signed descendant) and authors or confirms the conflicting AFK block for that slot — bond burned and identity barred in either order; <a id="inv-wt-1-st9shx.t1.p18"></a>`INV-WT-1-ST9SHX.T1.P18` — the same tower authoring and confirming the same exact AFK block is compatible: no contradiction, no burn; <a id="inv-wt-1-st9shx.t1.p19"></a>`INV-WT-1-ST9SHX.T1.P19` — two different keys signing one competing block each — the participant their normal block, their tower its AFK block — prove neither participant double-sign nor tower contradiction; <a id="inv-wt-1-st9shx.t1.p20"></a>`INV-WT-1-ST9SHX.T1.P20` — tower credit plus its endorsement of a valid AFK-evidence timeout is compatible, including shared-tower and descendant-carried credit; <a id="inv-wt-1-st9shx.t1.p21"></a>`INV-WT-1-ST9SHX.T1.P21` — forged or invalid AFK evidence gains no endorsement compatibility by assertion and remains invalid evidence; <a id="inv-wt-1-st9shx.t1.p22"></a>`INV-WT-1-ST9SHX.T1.P22` — a duplicate or repeated proof of the same valid contradiction burns nothing the second time. |
| <a id="req-wt-7-ef48m3.t1"></a>`REQ-WT-7-EF48M3.T1`   | [`REQ-WT-7-EF48M3`](watchtowers.md#req-wt-7-ef48m3)   | Exercise a towerless participant as author, timeout disputer, and timeout target.                                                                                                                                                                                                                | The author uses existing acknowledgements or calldata; the disputer waits the full ordinary window; the target has no AFK block or approval path and no actor can substitute its threshold role; counterparty avoidance is subjective only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | <a id="req-wt-7-ef48m3.t1.p1"></a>`REQ-WT-7-EF48M3.T1.P1` — towerless author: acknowledgements or calldata only; <a id="req-wt-7-ef48m3.t1.p2"></a>`REQ-WT-7-EF48M3.T1.P2` — towerless disputer: full ordinary window, no receipt defense against it; <a id="req-wt-7-ef48m3.t1.p3"></a>`REQ-WT-7-EF48M3.T1.P3` — towerless target: no restricted AFK block, approval, or threshold substitution possible; <a id="req-wt-7-ef48m3.t1.p4"></a>`REQ-WT-7-EF48M3.T1.P4` — avoidance of towerless counterparties has no objective protocol effect; <a id="req-wt-7-ef48m3.t1.p5"></a>`REQ-WT-7-EF48M3.T1.P5` — towerless participant has no disconnection trigger or publication duty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-wt-8-w3yp4r.t1"></a>`REQ-WT-8-W3YP4R.T1`   | [`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r)   | Register, bond, equivocate, and prove from an arbitrary observer at an arbitrary later time; separately model a silent tower with and without accepted artifacts.                                                                                                                                | A valid contradiction proof burns the bond and permanently bars the identity without touching any channel; no withdrawal path exists; failures without an accepted artifact have no channel effect, while accepted artifacts keep their defined dispute effects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | <a id="req-wt-8-w3yp4r.t1.p1"></a>`REQ-WT-8-W3YP4R.T1.P1` — valid contradiction proof from any observer at any time burns the bond and sets the permanent bar; <a id="req-wt-8-w3yp4r.t1.p2"></a>`REQ-WT-8-W3YP4R.T1.P2` — no bond withdrawal or unbonding path exists at any point, including after ceasing new channels; <a id="req-wt-8-w3yp4r.t1.p3"></a>`REQ-WT-8-W3YP4R.T1.P3` — silence, refusal, or late delivery with no accepted artifact: no penalty, bond, threshold, or current-channel outcome effect; <a id="req-wt-8-w3yp4r.t1.p4"></a>`REQ-WT-8-W3YP4R.T1.P4` — an accepted valid artifact from an otherwise-failing tower keeps its defined dispute effect; <a id="req-wt-8-w3yp4r.t1.p5"></a>`REQ-WT-8-W3YP4R.T1.P5` — punishment leaves existing membership-interval bindings, duties, disputes, and settlement unchanged; <a id="req-wt-8-w3yp4r.t1.p6"></a>`REQ-WT-8-W3YP4R.T1.P6` — barred identity rejected by future selection; a fresh identity with a fresh bond may register; <a id="req-wt-8-w3yp4r.t1.p7"></a>`REQ-WT-8-W3YP4R.T1.P7` — divergent observer policies coexist with no required agreement; <a id="req-wt-8-w3yp4r.t1.p8"></a>`REQ-WT-8-W3YP4R.T1.P8` — forged or malformed contradiction proofs leave bond, barred flag, and all channel state unchanged; <a id="req-wt-8-w3yp4r.t1.p9"></a>`REQ-WT-8-W3YP4R.T1.P9` — cross-tower, cross-channel, cross-slot, or compatible artifact pairs prove nothing; <a id="req-wt-8-w3yp4r.t1.p10"></a>`REQ-WT-8-W3YP4R.T1.P10` — a duplicate proof after the bond is burned is a no-op; <a id="req-wt-8-w3yp4r.t1.p11"></a>`REQ-WT-8-W3YP4R.T1.P11` — concurrent submissions: exactly one first valid proof burns and bars, every losing submission changes nothing; <a id="req-wt-8-w3yp4r.t1.p12"></a>`REQ-WT-8-W3YP4R.T1.P12` — rejection of a single malformed or invalid tower block or artifact creates no bond offense.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Future Work

_Non-normative._ These are later extensions for context; none of them gates the version-one
requirements above.

- **Disputer-side non-receipt check** — whether a timeout disputer should obtain a signed own-tower
  non-receipt before an ordinary timeout is [`OQ-48-CS3JNE`](../open-questions.md#oq-48-cs3jne).
  It does not restore the removed non-receipt attestation, target-tower non-receipt evidence,
  early-timeout shortcut, calldata waiver, or any current contradiction class.
- **Contradiction-proof submission subsidy** — submitting a tower-contradiction proof is an
  unrewarded public-good action ([`REQ-WT-8-W3YP4R`](watchtowers.md#req-wt-8-w3yp4r)). If deployed
  behavior shows that users modify the software to suppress these submissions, the transaction may
  later be subsidized or covered through the account-abstraction and network-fee design; neither
  is a current protocol requirement.
