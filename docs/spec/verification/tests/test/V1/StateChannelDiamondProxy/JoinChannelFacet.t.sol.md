# test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [JoinChannelFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Eight direct Foundry component tests deploy `JoinChannelFacet` with a real `UtilityFacet` and a
harness-only manager boundary. They seed two snapshot participants and record one as slashed
on-chain. The join case submits a later join carrying only the remaining participant's
countersignature; it must reach the composable-deposit boundary, and the shared threshold set must
contain only the unslashed address. The top-up case submits as the recorded but slashed member with
the eligible member's countersignature; it must revert with
`ErrorTopUpBalanceParticipantSlashed` before the deposit boundary. The other cases isolate a stale
fork pin, a top-up by an unknown participant, a participant signature made by the wrong key, a
join attempted by a snapshot participant, the exact accepted deadline, and propagation of an
atomic deposit failure. Every gate rejection proves the deposit boundary was not reached; the
deposit-failure case proves the attempted admission leaves no recorded deposit effect.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                       | Covers                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_joinChannel_slashedParticipantCannotVetoLaterJoin`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L85) (line 85) | [`REQ-ENFADM-1-V926CA.T1.P5`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p5), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p13) |
| [`test_topUpBalance_slashedParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L112) (line 112)         | [`REQ-ENFADM-2-K6K9SP.T1.P6`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p6), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p14) |
| [`test_joinChannel_wrongForkPinRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L136) (line 136)                | [`REQ-ENFADM-1-V926CA.T1.P6`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p6), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p4)   |
| [`test_topUpBalance_unknownParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L162) (line 162)         | [`REQ-ENFADM-2-K6K9SP.T1.P2`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p2), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p9)   |
| [`test_joinChannel_invalidParticipantSignatureRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L185) (line 185) | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p10)                                                                                                                           |
| [`test_joinChannel_snapshotParticipantRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L209) (line 209)         | [`REQ-ENFADM-2-K6K9SP.T1.P1`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p1), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p8)   |
| [`test_joinChannel_exactDeadlineAccepted`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L233) (line 233)               | [`REQ-ENFADM-1-V926CA.T1.P3`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca.t1.p3), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P18`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p18) |
| [`test_joinChannel_atomicDepositFailureRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelFacet.t.sol#L257) (line 257)        | [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P20`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p20)                                                                                                                           |
