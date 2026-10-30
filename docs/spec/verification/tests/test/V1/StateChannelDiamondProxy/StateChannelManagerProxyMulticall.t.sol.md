# StateChannelManagerProxyMulticall.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyMulticall.t.sol)
Exercises: [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

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

## Tests

- `test_multicallBestEffortLast_lastCallReverts_keepsEarlierEffectsAndEmitsRevertData`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P1
- `test_multicallBestEffortLast_earlierCallReverts_revertsWhole`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P2
- `test_multicallBestEffortLast_allCallsSucceed_matchesMulticall`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P3
- `test_multicallBestEffortLast_emptyList_returnsNoResultsAndEmitsNothing`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P4
- `test_multicallBestEffortLast_soleCallSucceeds_returnsItsResultAndEmitsNothing`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P5
- `test_multicallBestEffortLast_soleCallReverts_returnsEmptyResultAndEmitsRevertData`: UNIT-TEST-MANAGER-PROXY-4-4H4FFY.P6
