# Specification Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

The migrated protocol documents retain the reconstructed requirements, but their neutral templates and
interoperability cases are not yet complete. The generated specification index is the current queue.

**Staged: selected watchtowers with the restricted AFK block (2026-08-26, superseding the
2026-08-24 staging).** The selected-watchtower model —
[specification/runtime/watchtowers.md](../specification/runtime/watchtowers.md) (the `REQ-WT-*`
family including the new
[`REQ-WT-10-GNG79P`](../specification/runtime/watchtowers.md#req-wt-10-gng79p)
disconnection-publication duty and
[`INV-WT-1-ST9SHX`](../specification/runtime/watchtowers.md#inv-wt-1-st9shx)) and the
delegated-evidence and delegated-submission dispute rules
([specification/disputes/disputes.md §6.4](../specification/disputes/disputes.md),
[`REQ-DIS-11-JJ9FG3`](../specification/disputes/disputes.md#req-dis-11-jj9fg3) through
[`REQ-DIS-15-GH01J0`](../specification/disputes/disputes.md#req-dis-15-gh01j0), including the
delegated representation of
[`REQ-WT-9-GKFQXZ`](../specification/runtime/watchtowers.md#req-wt-9-gkfqxz) and the four
interaction boundary plans) — is **specified but not implemented**. The 2026-08-26 redesign
replaces the former `AfkAttestation` with the restricted tower-authored AFK removal block and its
restricted timestamp window, splits **availability credits** from **participant finality votes**
with the single AFK target-only finality credit, defines the two timeout modes with the
consolidated `TimeoutAcknowledged` defense, defines the participant `BlockDoubleSign` proof as
same-key any-role evidence (two explicit signatures over two distinct same-height blocks
recovering to the same accused participant key) with the full-stake slash, adds the
disconnection-publication duty, and
binds every later proof and state update to the **exact settled checkpoint** (replacing the
former ancestry-free jump-forward settlement rule). The amended existing owners are staged with
it: [`REQ-BLOCK-PIPE-2-PCXNT6`](../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6),
[`REQ-BLOCK-PIPE-10-PHAKE2`](../specification/block-progression/block-processing.md#req-block-pipe-10-phake2),
[`REQ-BLOCK-PIPE-11-DCHAJ2`](../specification/block-progression/block-processing.md#req-block-pipe-11-dchaj2),
[`REQ-SM-5-3GS7A7`](../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7),
[`REQ-SM-6-BJZVQ5`](../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5),
[`REQ-SM-8-8CHSQ8`](../specification/protocol-model/state-machines.md#req-sm-8-8chsq8),
[`INV-MSG-2-PQ0T1K`](../specification/settlement/cross-layer-messages.md#inv-msg-2-pq0t1k),
[`REQ-MSG-5-5XB7DB`](../specification/settlement/cross-layer-messages.md#req-msg-5-5xb7db),
[`REQ-MSG-8-N1ECJ5`](../specification/settlement/cross-layer-messages.md#req-msg-8-n1ecj5),
[`INV-FIN-2-MK27J6`](../specification/protocol-model/finality.md#inv-fin-2-mk27j6),
[`REQ-FIN-3-9P9J4Q`](../specification/protocol-model/finality.md#req-fin-3-9p9j4q),
[`REQ-FIN-7-RTZWQZ`](../specification/protocol-model/finality.md#req-fin-7-rtzwqz),
[`INV-FIN-8-G6V1M1`](../specification/protocol-model/finality.md#inv-fin-8-g6v1m1),
[`REQ-SP-1-9YABY1`](../specification/disputes/state-proofs.md#req-sp-1-9yaby1),
[`REQ-SP-2-ST4JJ4`](../specification/disputes/state-proofs.md#req-sp-2-st4jj4),
[`REQ-SP-3-SP1JG4`](../specification/disputes/state-proofs.md#req-sp-3-sp1jg4),
[`REQ-SP-4-NCSEX4`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4),
[`INV-SP-6-GNW74H`](../specification/disputes/state-proofs.md#inv-sp-6-gnw74h),
[`REQ-SP-7-70EMAT`](../specification/disputes/state-proofs.md#req-sp-7-70emat),
[`REQ-FP-2-CH4DA1`](../specification/disputes/fraud-proofs.md#req-fp-2-ch4da1),
[`REQ-DIS-1-XAJ1VA`](../specification/disputes/disputes.md#req-dis-1-xaj1va),
[`REQ-DIS-10-SAHJBN`](../specification/disputes/disputes.md#req-dis-10-sahjbn),
[`INV-DIS-8-1GY6Q5`](../specification/disputes/disputes.md#inv-dis-8-1gy6q5),
[`REQ-LIF-2-Z3Z9Y3`](../specification/settlement/lifecycle.md#req-lif-2-z3z9y3),
[`INV-ENFSNAP-1-9VZ2HE`](../specification/enforcement/snapshot-adoption.md#inv-enfsnap-1-9vz2he),
[`REQ-STOR-4-MF6FT6`](../specification/storage/durability.md#req-stor-4-mf6ft6),
[`REQ-TIME-4-83V27Z`](../specification/protocol-model/time.md#req-time-4-83v27z), the
authority-path safety premise of
[`REQ-TRUST-3-3YWEZR`](../specification/security/trust-model.md#req-trust-3-3ywezr), and the
identity owners amended by the central key policy —
[`INV-ID-1-B4FXJ4`](../specification/protocol-model/identity.md#inv-id-1-b4fxj4) and
[`REQ-ID-3-KR0BE3`](../specification/protocol-model/identity.md#req-id-3-kr0be3) — whose
amended reuse-attribution semantics (any process's signature from a reused participant key acts
as that one recovered identity) are not implemented
(the existing implementation claims cover only the old identity behavior). No source,
contract, executable test, or existing conformance claim implements the staged watchtower
behavior and amendments — the existing implementation claims linked from the generated audit for
the amended owners cover only their old behavior. Two separately recorded observations: the
current `BlockDoubleSign` handler's equal-recovered-signer predicate matches the decided
same-key any-role rule, but the decided distinction — different recovered keys stay distinct
while one reused key is one protocol identity — plus per-block signature binding and the
full-stake penalty routing remain unverified against the decided semantics at
implementation time; and the indirect unpaired-conflict enforcement residual is
[`OQ-49-2Z3FAS`](../specification/open-questions.md#oq-49-2z3fas) (explicit same-key pairs are
decided). The accepted conditional
pre-publication race and the settled-checkpoint rule replace the former general-tower-finality
and ancestry-free-settlement claims;
the requirement-side gaps they add to
[generated/implementation-coverage.md](../generated/implementation-coverage.md) and
[generated/traceability.md](../generated/traceability.md) are staged gaps permitted by the
specification-first staging rule in the maintenance instructions. The delegated powers are
deliberate trust boundaries with their failure modes stated in
[specification/security/trust-model.md §7](../specification/security/trust-model.md). The bond and
punishment policy, the delegated authorization question, delegated dispute initiation, and the
tower-authored removal design are all decided
([`OQ-47-QMYM54`](../specification/open-questions.md#oq-47-qmym54),
[`OQ-43-HWRTNF`](../specification/open-questions.md#oq-43-hwrtnf),
[`OQ-46-ZXR2V3`](../specification/open-questions.md#oq-46-zxr2v3), and
[`OQ-45-23GGV6`](../specification/open-questions.md#oq-45-23ggv6), all resolved);
[`OQ-48-CS3JNE`](../specification/open-questions.md#oq-48-cs3jne) stays separate future-work
context, and the bounded open details are
[`OQ-49-2Z3FAS`](../specification/open-questions.md#oq-49-2z3fas),
[`OQ-50-YSDG8S`](../specification/open-questions.md#oq-50-ysdg8s),
[`OQ-51-BCKA50`](../specification/open-questions.md#oq-51-bcka50), and
[`OQ-52-SNJKP1`](../specification/open-questions.md#oq-52-snjkp1); none gates the version-one
watchtower requirements. The settled redesign creates no new audit question or finding beyond
those recorded entries.
