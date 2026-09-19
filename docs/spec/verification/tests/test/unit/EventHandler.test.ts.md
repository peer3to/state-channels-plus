# test/unit/EventHandler.test.ts — Test Report

> **Test file:** [test/unit/EventHandler.test.ts](../../../../../../test/unit/EventHandler.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Drives the handler's replacement-evidence uploads on the losing side of the race every honest peer
runs into. Each case starts a real three-peer session, arms the observer's dispute submission to
fail at send with the contract's `RaceConditionDisputeEvidencePeriodExpired` custom error, and then
invokes one handler host-side with real domain arguments — no handler internals are stubbed, so the
refusal travels the production path through `DisputeManager.dispute`, whose deliberate rethrow of
that error is the behavior under test. The oracle is the pair `{ rejected, uploads }`: the handler
resolves (empty rejection message) and exactly one upload was attempted, which rules out both the
detached-promise rejection the containment fixes and a retry against the closed window. Both cases
are mutation-checked: replacing the site's `disputeToleratingLostRace` call with a bare
`disputeManager.dispute(...)` turns its own case red.

Out of scope here: the winning side of the race and the absence of duplicate commitments across
peers (that multi-peer oracle belongs to
[`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P4`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p4)),
and the third containment site — the evidence-improvement branch of `onDisputeCommitted` — which
needs an audited dispute the observer can add evidence to and has no declaration yet
([`FIND-DISPUTE-2-3HV3TZ` (The third lost-race containment site has no test)](../../../../audit/open-findings.md#find-dispute-2-3hv3tz)).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Unit: EventHandler > replacement evidence races > a chain slash whose replacement evidence loses the race leaves the handler successful`](../../../../../../test/unit/EventHandler.test.ts#L7) (line 7)      | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P8`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p8), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p12) |
| [`Unit: EventHandler > replacement evidence races > a killed dispute whose replacement evidence loses the race leaves the handler successful`](../../../../../../test/unit/EventHandler.test.ts#L51) (line 51) | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P7`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p7), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P13`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p13) |
