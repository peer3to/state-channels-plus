# test/transport/ATransport.test.ts — Test Report

> **Test file:** [test/transport/ATransport.test.ts](../../../../../../test/transport/ATransport.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ATransport.ts](../../../../implementation/source/src/transport/ATransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the real `ATransport` base inside a worker-hosted peer runtime through a small
recording concrete transport. It compares real signer identities, the base and real loopback trust
surfaces, exact serialized frames, the real disconnect/event-bus lifecycle, idempotent cleanup, and
synchronous failure propagation. The probe records only the concrete `_send`/`_close` boundary and
forwards connection removal through the real `P2PManager`; it does not recreate transport logic.
Cross-module structural recognition remains in `CrossModuleValues.test.ts`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ATransport > compares peer identities across address boundaries and transport replacement`](../../../../../../test/transport/ATransport.test.ts#L14) (line 14)     | [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P1`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p1), [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P2`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p2), [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P4`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p4) |
| [`ATransport > serializes RPC calls and responses before delegating to the concrete sender`](../../../../../../test/transport/ATransport.test.ts#L38) (line 38)      | [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P3`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p3), [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P7`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p7)                                                                                                                                          |
| [`ATransport > closes an unexpected disconnection once and emits its lifecycle event once`](../../../../../../test/transport/ATransport.test.ts#L62) (line 62)       | [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P8`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p8), [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P10`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p10)                                                                                                                                        |
| [`ATransport > closes an expected disconnection without emitting an unexpected-disconnect event`](../../../../../../test/transport/ATransport.test.ts#L84) (line 84) | [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P9`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p9)                                                                                                                                                                                                                                                                                   |
| [`ATransport > propagates serialization and concrete-send failures`](../../../../../../test/transport/ATransport.test.ts#L106) (line 106)                            | [`UNIT-TEST-ATRANSPORT-1-7DGX9R.P11`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-1-7dgx9r.p11)                                                                                                                                                                                                                                                                                 |
