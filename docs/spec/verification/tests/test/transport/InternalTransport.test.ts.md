# InternalTransport.test.ts

Test file: [test/transport/InternalTransport.test.ts](../../../../../../test/transport/InternalTransport.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures. Three declarations check the fixture's outgoing-request hold: a held request stays off the port while later calls are answered, a released one gets its real answer, and a close drops it unposted while the router rejects its pending call.

## Tests

- `has a neutral transport surface without network identity metadata`: UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B.P1
- `rejects an internal transport passed to an untyped network request`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P1
- `rejects an internal transport passed to an untyped network send`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P2
- `rejects an internal transport passed to an untyped network recipient list`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P3
- `closes once and rejects only calls owned by that connection`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P4
- `removes both port subscriptions exactly once on close`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P7
- `rejects sends after the runtime connection closes`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P5
- `preserves the supplied close reason for a pending caller`: UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P6
- `holds the next outgoing request before it reaches the port`: none
- `posts a released outgoing request and settles it with the real answer`: none
- `drops a held outgoing request on close and rejects its pending call`: none
