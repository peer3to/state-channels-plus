# test/unit/SpectateService.test.ts — Test Report

> **Test file:** [test/unit/SpectateService.test.ts](../../../../../../test/unit/SpectateService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SpectateService.ts](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two regression tests for the responder side of spectate sync, driving
`spectate.generateSyncPayload` through the harness control RPC on a real 4-peer channel while the
observer's reduction entry points and incoming dispute-committed events are held. The first stages
a dispute commitment that is on-chain but genuinely missing from local storage and pins that
`generateSyncPayload` recovers it (via the same
`EventSyncService.loadSynchronizedWindowCommitments` owner reduction uses) instead of throwing —
the oracles verify the gap was real before the call and that afterwards every window commitment
resolves to a stored confirmation, with the held events and frozen reduction ruling out any other
recovery path. The second suppresses every dispute event so the local mirror still reports the
fork undisputed while the chain says it is, and asserts the payload walk takes the disputed flag
from the chain: the call returns `null` rather than proving a disputed, already-reducible fork as
the tip. The suite does not exercise the planned obligation permutations for this component — the
requester verification chain ([`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct)) and responder target proving
([`UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD`](../../../../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#unit-test-spectate-service-2-chk2pd)) — so no test IDs are assigned here; both scenarios sit outside
those tables.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                              | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`Unit: SpectateService > generateSyncPayload > committed dispute missing locally → recovers before generating the payload`](../../../../../../test/unit/SpectateService.test.ts#L12) (line 12)               | —      |
| [`Unit: SpectateService > generateSyncPayload > all dispute events suppressed → still declines the disputed fork instead of proving it`](../../../../../../test/unit/SpectateService.test.ts#L162) (line 162) | —      |
