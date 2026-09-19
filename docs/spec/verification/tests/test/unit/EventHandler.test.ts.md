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
the staging both cases share, and the trigger union it takes is what a third case would extend.
The staging is real: a three-peer session, the observer's dispute submission armed to fail at send
with the contract's `RaceConditionDisputeEvidencePeriodExpired` custom error, and one handler
invoked host-side with real domain arguments. No handler internals are stubbed, so the refusal
travels the production path through `DisputeManager.dispute`, whose deliberate rethrow is what
`DisputeManager.disputeToleratingLostRace` has to absorb. The oracle is the pair
`{ rejected, uploads }`: the handler resolves (empty rejection message) and exactly one upload was
attempted, which rules out both the detached-promise rejection the containment fixes and a retry
against the closed window.

Both cases are mutation-checked at the site and at the owner. Replacing a site's
`disputeToleratingLostRace` call with a bare `disputeManager.dispute(...)` turns that site's own
case red and leaves the other green, which is what makes them independent evidence rather than two
views of one containment; making `disputeToleratingLostRace` rethrow for every caller turns both
red.

Out of scope here: the winning side of the race and the absence of duplicate commitments across
peers (that multi-peer oracle belongs to
[`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P4`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p4)),
and the two callers that still have no declaration — the evidence-improvement branch of
`onDisputeCommitted`, which needs an audited dispute the observer can add evidence to, and the
reducer's empty-window escalation, which is not a handler at all
([`FIND-DISPUTE-2-3HV3TZ` (Two of the four lost-race callers have no test)](../../../../audit/open-findings.md#find-dispute-2-3hv3tz)).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Unit: EventHandler > replacement evidence races > a chain slash whose replacement evidence loses the race leaves the handler successful`](../../../../../../test/unit/EventHandler.test.ts#L6) (line 6)      | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P8`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p8), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p12) |
| [`Unit: EventHandler > replacement evidence races > a killed dispute whose replacement evidence loses the race leaves the handler successful`](../../../../../../test/unit/EventHandler.test.ts#L13) (line 13) | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p7), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P13`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p13) |
