# test/stateManager/DisputeReductionStaleEvent.test.ts — Test Report

> **Test file:** [test/stateManager/DisputeReductionStaleEvent.test.ts](../../../../../../test/stateManager/DisputeReductionStaleEvent.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A race regression for `EventHandler.onDisputeReducedResultCommitted`: a
`DisputeReducedResultCommitted` chain event can be delivered again after the local dispute state
moved on (reduction consumed, fork windows pruned), and the handler used to pass the resulting
empty dispute set to the Solidity reducer, which reverted with `ErrorNoDisputesProvided` as a
fatal detached error. The case stages a real four-peer dispute with reduction and snapshot
update, captures the real committed-reduction event arguments from the mirrored `EventHandler`
notification of whichever peer observed it, lets the peers consume the reduction, then redelivers
the exact same event through the real handler entry in the worker realm. The oracles assert the
redelivery is treated as already processed: no error surfaces and the peer's fork id is
unchanged. First-delivery branch behavior and the other dispute-event branches are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                | Covers                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Dispute reduction stale event > treats a redelivered reduced-result event as consumed after the reduction was applied`](../../../../../../test/stateManager/DisputeReductionStaleEvent.test.ts#L20) (line 20) | [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p2) |
