# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite calls `multicallBestEffortLast` on a deployed diamond with `open` calls as legs. Two opens
of one channel make the last call revert with `RaceConditionChannelAlreadyOpen`: the test expects
`MulticallLastCallFailed` with that exact revert data, reads the opened channel's participants and
checks the empty result slot. A failing open in front of a last open of another channel must revert
the whole call with the same error and open neither channel. An open followed by a
`getParticipants` read is run through `multicall` and, after a state revert, through
`multicallBestEffortLast`: the results must be equal and the recorded logs must hold no failure event.
Three boundary cases: an empty call list returns no results and no failure event; a sole successful open
returns the same result as `multicall`, opens the channel and emits no failure event; a sole open of an
already-open channel returns one empty result and emits `MulticallLastCallFailed` with the
`RaceConditionChannelAlreadyOpen` data, and the whole call does not revert.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                    | Covers                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_multicallBestEffortLast_lastCallReverts_keepsEarlierEffectsAndEmitsRevertData`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L24) (line 24) | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p1) |
| [`test_multicallBestEffortLast_earlierCallReverts_revertsWhole`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L38) (line 38)                       | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P2`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p2) |
| [`test_multicallBestEffortLast_allCallsSucceed_matchesMulticall`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L51) (line 51)                      | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P3`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p3) |
| [`test_multicallBestEffortLast_emptyList_returnsNoResultsAndEmitsNothing`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L72) (line 72)             | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p4) |
| [`test_multicallBestEffortLast_soleCallSucceeds_returnsItsResultAndEmitsNothing`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L80) (line 80)      | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P5`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p5) |
| [`test_multicallBestEffortLast_soleCallReverts_returnsEmptyResultAndEmitsRevertData`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol#L97) (line 97)  | [`UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P6`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-4-4h4ffy.p6) |
