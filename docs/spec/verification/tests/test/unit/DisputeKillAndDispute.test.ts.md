# DisputeKillAndDispute.test.ts

Test file: [test/unit/DisputeKillAndDispute.test.ts](../../../../../../test/unit/DisputeKillAndDispute.test.ts)

## Overview

Exercises audit handling of an invalid first dispute and an invalid dispute after the auditor has committed. Checks replacement construction, evidence publication and kill-only handling.

## Tests

- `U127: the initial dispute names a state below the peer's view -> the first audit finds more evidence and the peer's own dispute lands at once`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P41
- `U128: the initial dispute already represents the peer's state; a later lower-state dispute is still audited, and the peer submits nothing`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P42
- `U129: the initial dispute is invalid -> the auditor's kill and its own dispute go in one multicall, kill first, carrying the killed submitter's slash, and land without another valid dispute`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P3, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P43
- `U129: the replacement counts the killed submitter's slash -> held before the multicall that slash is not established and an auditor counters it; the multicall lands the kill first and the replacement passes`: REQ-DISPUTE-PIPE-6-6FZB9M.T3.P4, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P44
