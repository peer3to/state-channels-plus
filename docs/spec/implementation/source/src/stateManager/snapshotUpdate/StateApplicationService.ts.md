# StateApplicationService.ts — Source Report

> **Source:** [src/stateManager/snapshotUpdate/StateApplicationService.ts](../../../../../../../src/stateManager/snapshotUpdate/StateApplicationService.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Applies a validated initial snapshot and emits the existing readiness event. Targeted connect does not add
another application path. The readiness event releases deferred responder work, while observer success waits
for the committed `SYNCED` transition.

## Linked requirements

| Source file                                                                                                   | Specification IDs                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [StateApplicationService.ts](../../../../../../../src/stateManager/snapshotUpdate/StateApplicationService.ts) | [`REQ-TJOIN-3-DCZKS6`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6) |

## Component test obligations

| Unit test ID                                                                                            | Obligation                     | Public entry and setup                                                             | Oracle and forbidden effects                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-application-service-1-b8v3dr"></a>`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR` | Canonical snapshot application | Apply genesis and participant/non-participant snapshots through the existing owner | Storage, active fork, and local status update atomically before readiness is reported | <a id="unit-test-state-application-service-1-b8v3dr.p1"></a>`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P1` — genesis height-zero storage and active fork; <a id="unit-test-state-application-service-1-b8v3dr.p2"></a>`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P2` — participant status; <a id="unit-test-state-application-service-1-b8v3dr.p3"></a>`UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P3` — observer status |

## Verification

State-application tests cover atomic genesis application and participant/observer status derivation. Peer
authentication and responder readiness are covered at the P2P and spectate boundaries.
# Terminal leave contribution

Applied settled state rechecks terminal leave after participant status and fork state are authoritative. This contributes to [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9).
