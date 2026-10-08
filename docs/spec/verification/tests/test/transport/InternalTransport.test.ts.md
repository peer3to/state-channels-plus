# test/transport/InternalTransport.test.ts — Test Report

> **Test file:** [test/transport/InternalTransport.test.ts](../../../../../../test/transport/InternalTransport.test.ts) > **Status:** Authored — engineer verification pending.

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests and covered test IDs

| Test                                                                                                                                                                        | Covers                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InternalTransport > has a neutral transport surface without network identity metadata`](../../../../../../test/transport/InternalTransport.test.ts#L36) (line 36)         | [`UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B.P1`](../../../../implementation/source/src/transport/ATransport.ts.md#unit-test-atransport-neutral-1-m1ef2b)        |
| [`InternalTransport > rejects an internal transport passed to an untyped network request`](../../../../../../test/transport/InternalTransport.test.ts#L45) (line 45)        | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P1`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [`InternalTransport > rejects an internal transport passed to an untyped network send`](../../../../../../test/transport/InternalTransport.test.ts#L48) (line 48)           | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P2`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [`InternalTransport > rejects an internal transport passed to an untyped network recipient list`](../../../../../../test/transport/InternalTransport.test.ts#L51) (line 51) | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P3`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [`InternalTransport > closes once and rejects only calls owned by that connection`](../../../../../../test/transport/InternalTransport.test.ts#L54) (line 54)               | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P4`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [removes both port subscriptions exactly once on close](../../../../../../test/transport/InternalTransport.test.ts#L12) (line 12)                                           | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P7`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [rejects sends after the runtime connection closes](../../../../../../test/transport/InternalTransport.test.ts#L15) (line 15)                                               | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P5`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
| [preserves the supplied close reason for a pending caller](../../../../../../test/transport/InternalTransport.test.ts#L23) (line 23)                                        | [`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P6`](../../../../implementation/source/src/transport/InternalTransport.ts.md#unit-test-internal-transport-1-3g1yg2) |
