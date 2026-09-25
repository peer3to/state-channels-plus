# DisputeUtils.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-ENFDIS-1-8CSA6B` (Window bookkeeping integrity)](../../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-DIS-1-XAJ1VA` (A dispute MUST state at least one of the five valid inputs)](../../../../../../specification/disputes/disputes.md#req-dis-1-xaj1va)
- [`REQ-DIS-4-6J6YYG` (Reduction runs only after the kill period expires and consumes exactly the…)](../../../../../../specification/disputes/disputes.md#req-dis-4-6j6yyg)
- [`INV-DIS-5-J1QZ92` (The reduced result is independent of the order in which valid dispute inputs…)](../../../../../../specification/disputes/disputes.md#inv-dis-5-j1qz92)
  Missing: Order-sensitivity of the positional match is documented but unresolved; engineer decision pending. See [`OQ-4-JGDCNX` (Dispute-reduction order-independence)](../../../../../../verification/open-questions.md#oq-4-jgdcnx).
- [`REQ-LIF-6-VG861M` (Four protocol windows are configured on the manager at deployment)](../../../../../../specification/settlement/lifecycle.md#req-lif-6-vg861m)

## UNIT-TEST-DISPUTE-UTILS-1-30FXAM

Canonical dispute reason

- Setup: Call the pure shared reason validator with each reason and participant eligibility.
- Oracle: Only the accepted-window flag or an independently valid reason permits the claim.

- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1` — false alone is no reason
- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2` — true alone supplies reason without self-removal
- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3` — false preserves timeout
- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4` — false preserves self-removal
- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5` — false preserves forced-inbound evidence
- [x] `UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6` — false requires every slash entry to be eligible
