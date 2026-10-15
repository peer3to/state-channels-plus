# JoinChannelFacet.t.sol

Test file: [test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol)
Exercises: [JoinChannelFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md)

## Overview

Eleven direct Foundry component tests deploy `JoinChannelFacet` with a real `UtilityFacet` and a
harness-only manager boundary. They seed two snapshot participants and record one as slashed
on-chain. The join case submits a later join carrying only the remaining participant's
countersignature; it must reach the composable-deposit boundary, and the shared threshold set must
contain only the unslashed address. The top-up case submits as the recorded but slashed member with
the eligible member's countersignature; it must revert with
`ErrorTopUpBalanceParticipantSlashed` before the deposit boundary. The other cases isolate a stale
fork pin, a top-up by an unknown participant, a participant signature made by the wrong key, a
join attempted by a snapshot participant, the exact accepted deadline, and unchanged propagation of
a deposit revert — the harness stub raises a payload the real single-join loop could not build, so
the facet is shown to bubble it rather than rebuild it. A second seeded channel with two unslashed
participants carries the threshold cases. It first receives only one countersignature, and the
revert is matched against the exact two-member threshold set and the single recovered signer,
both hand-built in the test from the keys it signed with. It then receives two signatures — as
many as the threshold has members, but the second made by the joiner rather than a member — so
the counts alone cannot distinguish the rejection, and the revert is matched against the same
threshold set beside the recovered pair that names the outsider. A third seeded channel opens a dispute window on its own
fork the way the first dispute does, so the join branch's undisputed-fork gate rejects a fully countersigned join and the
revert is matched against that channel and that fork — two constants with different preimages, so a swapped payload would
not match. Every gate rejection proves the deposit boundary was not reached; the
deposit-failure case proves the attempted admission leaves no recorded deposit effect.

## Tests

- `test_joinChannel_slashedParticipantCannotVetoLaterJoin`: REQ-ENFADM-1-V926CA.T1.P5, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P13
- `test_topUpBalance_slashedParticipantRejected`: REQ-ENFADM-2-K6K9SP.T1.P6, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P14
- `test_joinChannel_wrongForkPinRejected`: REQ-ENFADM-1-V926CA.T1.P6, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4
- `test_topUpBalance_unknownParticipantRejected`: REQ-ENFADM-2-K6K9SP.T1.P2, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9
- `test_joinChannel_invalidParticipantSignatureRejected`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10
- `test_joinChannel_snapshotParticipantRejected`: REQ-ENFADM-2-K6K9SP.T1.P1, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8
- `test_joinChannel_exactDeadlineAccepted`: REQ-ENFADM-1-V926CA.T1.P3, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P18
- `test_joinChannel_depositRevertBubblesUnchanged`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P20
- `test_joinChannel_confirmationNotThresholdSignedRejected`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P21
- `test_joinChannel_confirmationSignedByOutsiderNamesTheRecoveredSigner`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P22
- `test_joinChannel_disputedForkRejectionNamesChannelAndFork`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P24
- `test_topUpBalance_disputedForkRejected`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P26
