# InternalTransport.test.ts

Test file: [test/transport/InternalTransport.test.ts](../../../../../../test/transport/InternalTransport.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `has a neutral transport surface without network identity metadata`: UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B.P1
- `rejects an internal transport passed to an untyped network request`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P1
- `rejects an internal transport passed to an untyped network send`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P2
- `rejects an internal transport passed to an untyped network recipient list`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P3
- `closes once and rejects only calls owned by that connection`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P4
- `InternalTransport > removes both port subscriptions exactly once on close`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P7
- `InternalTransport > rejects sends after the runtime connection closes`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P5
- `InternalTransport > preserves the supplied close reason for a pending caller`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P6
