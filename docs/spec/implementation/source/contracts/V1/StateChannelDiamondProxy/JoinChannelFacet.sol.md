# JoinChannelFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-ENFADM-1-V926CA` (Self-submission with pinned state)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca)
- [`REQ-ENFADM-2-K6K9SP` (Membership-split correctness)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp)
- [`REQ-ENFADM-3-6A3BEB` (Custody through the adapter only)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb)
- [`INV-ENFADM-1-H53AQY` (Inbound append is the only membership/value entry)](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy)
- [`REQ-MSG-10-7JS45Q` (Joining MUST carry the joiner's signature plus the full threshold set's…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q)

## UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A

Admission and atomic deposit

- Setup: Join/top-up under every gate violation, the valid paths, and an atomic deposit failure
- Oracle: Only correctly pinned, signed, membership-correct submissions append; each violation or deposit failure reverts without admission effects

- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P1` — zero-channel-id revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P2` — valid join
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P3` — valid top-up
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4` — fork-pin race
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P5` — disputed-fork join
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P6` — wrong-submitter revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P7` — expired-deadline revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8` — join snapshot participant revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9` — top-up unknown-participant revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10` — participant-signature revert
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P11` — threshold-shortfall revert against a live channel, decoded to the widened threshold set and the recovered signer set
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P12` — snapshot-pin race
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P13` — join after an on-chain slash succeeds without the slashed participant's signature
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P14` — on-chain-slashed participant's top-up reverts before deposit
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P15` — malformed threshold signature reverts
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P16` — stale top-up snapshot pin reverts without changing participant lifecycle state
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P17` — join pending participant reverts per the snapshot ∪ pending membership rule
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P18` — join at the exact deadline succeeds
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P19` — pending participant's top-up succeeds
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P20` — atomic deposit failure propagates through join without admission effects
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P21` — threshold-shortfall revert names the submitter, the exact threshold participant set, and the exact set the supplied signatures recover to
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P22` — a confirmation carrying as many signatures as the threshold has members but one from a non-member reverts, and the payload names the non-member as the recovered signer
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P23` — snapshot-pin race revert decodes to both hash operands: the submitted hash is the stale pin the joiner sent and the current hash is the newly posted on-chain snapshot
- [x] `UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P24` — disputed-fork join revert names the rejected channel and the disputed fork as two distinct operands
