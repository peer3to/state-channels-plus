# ATransport.test.ts

Test file: [test/transport/ATransport.test.ts](../../../../../../test/transport/ATransport.test.ts)
Exercises: [ATransport.ts](../../../../implementation/source/src/transport/ATransport.ts.md)

## Overview

Invoke the real base onMessage with string, Buffer and a throwing conversion; a record-only onRpc capture observes payload/receiver and the same conversion error escapes.

The suite drives the real `ATransport` base inside a worker-hosted peer runtime through a small
recording concrete transport. It compares real signer identities, the base and real loopback trust
surfaces, exact serialized frames, the real disconnect/event-bus lifecycle, idempotent cleanup, and
synchronous failure propagation. The probe records only the concrete `_send`/`_close` boundary and
forwards connection removal through the real `P2PManager`; it does not recreate transport logic.
Cross-module structural recognition remains in `CrossModuleValues.test.ts`.

## Tests

- `converts string and Buffer frames and preserves conversion errors`: UNIT-TEST-ATRANSPORT-32-QF87JK.P1
- `compares peer identities across address boundaries and transport replacement`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P1, UNIT-TEST-ATRANSPORT-1-7DGX9R.P2, UNIT-TEST-ATRANSPORT-1-7DGX9R.P4
- `serializes RPC calls and responses before delegating to the concrete sender`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P3, UNIT-TEST-ATRANSPORT-1-7DGX9R.P7
- `closes an unexpected disconnection once and emits its lifecycle event once`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P8, UNIT-TEST-ATRANSPORT-1-7DGX9R.P10
- `closes an expected disconnection without emitting an unexpected-disconnect event`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P9
- `propagates serialization and concrete-send failures`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P11
