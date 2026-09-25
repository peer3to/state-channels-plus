# test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [JoinChannelFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                       | Covers                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_joinChannel_slashedParticipantCannotVetoLaterJoin`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L108) (line 108)               | [`REQ-ENFADM-1-V926CA.T1.P5`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p5), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a) |
| [`test_topUpBalance_slashedParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L134) (line 134)                         | [`REQ-ENFADM-2-K6K9SP.T1.P6`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p6), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a) |
| [`test_joinChannel_wrongForkPinRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L158) (line 158)                                | [`REQ-ENFADM-1-V926CA.T1.P6`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p6), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)  |
| [`test_topUpBalance_unknownParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L183) (line 183)                         | [`REQ-ENFADM-2-K6K9SP.T1.P2`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p2), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)  |
| [`test_joinChannel_invalidParticipantSignatureRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L208) (line 208)                 | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)                                                                                                                           |
| [`test_joinChannel_snapshotParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L236) (line 236)                         | [`REQ-ENFADM-2-K6K9SP.T1.P1`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p1), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)  |
| [`test_joinChannel_exactDeadlineAccepted`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L263) (line 263)                               | [`REQ-ENFADM-1-V926CA.T1.P3`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p3), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P18`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a) |
| [`test_joinChannel_depositRevertBubblesUnchanged`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L289) (line 289)                       | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P20`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)                                                                                                                           |
| [`test_joinChannel_confirmationNotThresholdSignedRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L320) (line 320)              | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P21`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)                                                                                                                           |
| [`test_joinChannel_confirmationSignedByOutsiderNamesTheRecoveredSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L361) (line 361) | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P22`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)                                                                                                                           |
| [`test_joinChannel_disputedForkRejectionNamesChannelAndFork`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L403) (line 403)            | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P24`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a)                                                                                                                           |
