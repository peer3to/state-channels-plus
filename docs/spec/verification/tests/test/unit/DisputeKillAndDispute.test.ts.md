# DisputeKillAndDispute.test.ts

Test file: [test/unit/DisputeKillAndDispute.test.ts](../../../../../../test/unit/DisputeKillAndDispute.test.ts)

## Overview

Exercises audit handling of an invalid first dispute and an invalid dispute after the auditor has committed. Checks replacement construction, evidence publication and kill-only handling. A slow auditor, parked in its own construction while another auditor's kill and replacement land and the evidence period closes, then sends its kill and dispute in one best-effort multicall; the test reads the recorded multicall (method, kill first, the upload refusal decoded from the mined receipt), the absence of a lone kill, the window commitments, its marker and its contract-event block states. A second slow auditor, parked the same way while a kill lands alone and another auditor's replacement closes the window after the evidence end, queues a replacement from its kill handler; the test counts the constructions its `dispute()` started, reads both recorded uploads and their refusals, its marker and its contract-event block states.

Three more slow-auditor cases (staging in `test/fixtures/DisputeAuditStaging.ts`) end in the same lost-race
no-op, checked by one shared assertion: the multicall landed with its kill first, the dispute did not land,
the marker rolled back, no kill was sent alone and the event pipeline has no failed block and is not
disposed. In the first a stub answers the best-effort estimate with the least gas at which the multicall
succeeds; the recorded estimates show the all-or-nothing estimate refused with
`RaceConditionDisputeEvidencePeriodExpired` and the best-effort estimate accepted, and the mined refusal
still names that race. In the second the upload is refused with no revert data (`0x`); in the third its
facet reverts without data, which the proxy reports as `Error("StateChannelManagerProxy - Delegatecall failed")`.
Two refusal cases send the kill-and-dispute directly: an upload refused with `ErrorDisputerNotMsgSender`
makes `dispute()` reject with that error, and an empty refusal while the all-or-nothing estimate
succeeded makes it reject with "dispute upload reverted: 0x". In both the kill landed once in the
recorded multicall, nothing was applied alone, the marker is false and the window holds only the other
replacement.

## Tests

- `U127: the initial dispute names a state below the peer's view -> the first audit finds more evidence and the peer's own dispute lands at once`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P41
- `U128: the initial dispute already represents the peer's state; a later lower-state dispute is still audited, and the peer submits nothing`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P42
- `U129: the initial dispute is invalid -> the auditor's kill and its own dispute go in one multicall, kill first, carrying the killed submitter's slash, and land without another valid dispute`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P3, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P43
- `U129: the replacement counts the killed submitter's slash -> held before the multicall that slash is not established and an auditor counters it; the multicall lands the kill first and the replacement passes`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P4, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P44
- `a slow auditor's kill and dispute land after another auditor's kill and replacement closed the evidence period → the multicall lands its kill, its refused upload is a no-op, no kill is sent alone, and its event pipeline stays alive`: REQ-DISPUTE-PIPE-6-6FZB9M.T1.P12, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P48
- `a slow auditor's kill and dispute land after the evidence period closed, and a searching estimator gives the best-effort multicall only the least gas at which it succeeds → the upload still reaches its evidence check and names the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P50
- `a slow auditor's kill and dispute land after the evidence period closed and the upload's refusal carries no revert data → the all-or-nothing estimate's refusal classifies it as the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P51, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P34
- `a slow auditor's kill and dispute land after the evidence period closed and the upload's facet reverts without data, which the proxy reports as its "Delegatecall failed" Error(string) → the all-or-nothing estimate's refusal classifies it as the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P52, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P35
- `the upload of a mined kill-and-dispute multicall is refused with a custom error no dispute handler takes (ErrorDisputerNotMsgSender) → the kill landed once in the multicall, the marker rolled back, dispute() rejects with the refusal, and no kill is sent alone`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P53, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P36
- `the upload of a mined kill-and-dispute multicall is refused without revert data while its all-or-nothing estimate succeeded → nothing classifies the refusal: the kill landed once in the multicall, the marker rolled back, dispute() rejects, and no kill is sent alone`: UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P54, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P37
- `a kill lands while a slow auditor's kill and dispute is in flight → the replacement it queues is built and its lone upload, refused because the evidence period closed, is a no-op`: REQ-DISPUTE-PIPE-6-6FZB9M.T1.P13, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P49
