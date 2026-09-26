# test/unit/EventHandler.test.ts — Test Report

> **Test file:** [test/unit/EventHandler.test.ts](../../../../../../test/unit/EventHandler.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Drives the handler's replacement-evidence uploads on the losing side of the race every honest peer
runs into. Each case is one line that names its trigger and hands the session harness to
`assertLostEvidenceRaceTolerated` in `test/fixtures/LostEvidenceRaceStaging.ts`; the fixture holds
the staging both cases share. Each trigger is a real on-chain event on a live session. The kill case
posts a tampered dispute on a four-peer session, lets the honest peers kill it automatically, and
checks the window is left empty. The slash case has one participant apply a real
InvalidStateTransition fraud proof on its own, outside any dispute, which the routed facet function
allows; the fork stays undisputed. Every peer but the observer has dispute initiation suppressed, so
the observer's upload is the only one, and its submission is armed to fail at send with the
contract's `RaceConditionDisputeEvidencePeriodExpired` custom error. No handler internals are
stubbed, so the refusal travels the production path through `DisputeManager.dispute`, whose
deliberate rethrow is what `DisputeManager.disputeToleratingLostRace` has to absorb. The oracle is
the event pipeline's processed-block watermark passing the trigger's block, which a handler that
throws holds below that block forever, plus exactly one recorded upload, which rules out a retry
against the closed window.

Both cases are mutation-checked at the site and at the owner. Replacing a site's
`disputeToleratingLostRace` call with a bare `disputeManager.dispute(...)` turns that site's own
case red and leaves the other green (the kill case fails at the harness's `onDisputeKilled` barrier,
which only counts a handler that returned), which is what makes them independent evidence rather than two
views of one containment; making `disputeToleratingLostRace` rethrow for every caller turns both
red.

Out of scope here: the winning side of the race and the absence of duplicate commitments across
peers (that multi-peer oracle belongs to
[`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P4`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p4)),
and the one caller that still has no declaration — the evidence-improvement branch of
`onDisputeCommitted`, which needs an audited dispute the observer can add evidence to
([`FIND-DISPUTE-2-3HV3TZ` (The evidence-improvement lost-race caller has no test)](../../../../audit/open-findings.md#find-dispute-2-3hv3tz)).
The fourth caller, the reducer's empty-window escalation, is not a handler at all and is driven by
[test/e2e/E2E-ReductionManager.test.ts](../e2e/E2E-ReductionManager.test.ts.md).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                        | Covers                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Unit: EventHandler > replacement evidence races > a real slash on an undisputed fork whose replacement evidence loses the race completes its event`](../../../../../../test/unit/EventHandler.test.ts#L6) (line 6)    | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P8`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p8), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p12) |
| [`Unit: EventHandler > replacement evidence races > a real kill that empties the window whose replacement evidence loses the race completes its event`](../../../../../../test/unit/EventHandler.test.ts#L13) (line 13) | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p7), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P13`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p13) |
