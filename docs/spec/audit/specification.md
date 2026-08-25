# Specification Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

The migrated protocol documents retain the reconstructed requirements, but their neutral templates and
interoperability cases are not yet complete. The generated specification index is the current queue.

**Staged: selected watchtowers (2026-08-24).** The selected-watchtower model —
[specification/runtime/watchtowers.md](../specification/runtime/watchtowers.md) (the `REQ-WT-*`
family and [`INV-WT-1-ST9SHX`](../specification/runtime/watchtowers.md#inv-wt-1-st9shx)) and the
delegated-evidence and delegated-submission dispute rules
([specification/disputes/disputes.md §6.4](../specification/disputes/disputes.md),
[`REQ-DIS-11-JJ9FG3`](../specification/disputes/disputes.md#req-dis-11-jj9fg3) through
[`REQ-DIS-15-GH01J0`](../specification/disputes/disputes.md#req-dis-15-gh01j0), including the
delegated representation of
[`REQ-WT-9-GKFQXZ`](../specification/runtime/watchtowers.md#req-wt-9-gkfqxz), the three
interaction boundary plans, and the watchtower-credit amendments to the existing confirmation
owners ([`REQ-BLOCK-PIPE-10-PHAKE2`](../specification/block-progression/block-processing.md#req-block-pipe-10-phake2),
[`REQ-BLOCK-PIPE-11-DCHAJ2`](../specification/block-progression/block-processing.md#req-block-pipe-11-dchaj2),
[`REQ-FIN-7-RTZWQZ`](../specification/protocol-model/finality.md#req-fin-7-rtzwqz),
[`REQ-SP-1-9YABY1`](../specification/disputes/state-proofs.md#req-sp-1-9yaby1),
[`REQ-SP-3-SP1JG4`](../specification/disputes/state-proofs.md#req-sp-3-sp1jg4), and
[`REQ-SP-7-70EMAT`](../specification/disputes/state-proofs.md#req-sp-7-70emat), the last three
carrying the effective-credit milestone verification across the proof-material boundary, plus the
non-equivocation and fraud owners consuming the tower block vote:
[`INV-FIN-2-MK27J6`](../specification/protocol-model/finality.md#inv-fin-2-mk27j6),
[`REQ-FIN-3-9P9J4Q`](../specification/protocol-model/finality.md#req-fin-3-9p9j4q), the
`BlockDoubleSign` boundary of
[`REQ-FP-2-CH4DA1`](../specification/disputes/fraud-proofs.md#req-fp-2-ch4da1), the
settlement-order rules of
[`REQ-LIF-2-Z3Z9Y3`](../specification/settlement/lifecycle.md#req-lif-2-z3z9y3), and the
authority-path safety premise of
[`REQ-TRUST-3-3YWEZR`](../specification/security/trust-model.md#req-trust-3-3ywezr))) — is **specified but not implemented**. No source, contract, executable test, or existing conformance claim implements the staged watchtower behavior and amendments — the existing implementation claims linked from the generated audit for the amended owners cover only their old behavior;
the requirement-side gaps they add to
[generated/implementation-coverage.md](../generated/implementation-coverage.md) and
[generated/traceability.md](../generated/traceability.md) are staged gaps permitted by the
specification-first staging rule in the maintenance instructions. The delegated powers are
deliberate trust boundaries with their failure modes stated in
[specification/security/trust-model.md §7](../specification/security/trust-model.md). The bond and
punishment policy, the delegated authorization question, and delegated dispute initiation are all
decided ([`OQ-47-QMYM54`](../specification/open-questions.md#oq-47-qmym54),
[`OQ-43-HWRTNF`](../specification/open-questions.md#oq-43-hwrtnf), and
[`OQ-46-ZXR2V3`](../specification/open-questions.md#oq-46-zxr2v3), all resolved);
[`OQ-45-23GGV6`](../specification/open-questions.md#oq-45-23ggv6) and
[`OQ-48-CS3JNE`](../specification/open-questions.md#oq-48-cs3jne) are future-work context and do
not gate the version-one watchtower requirements.
