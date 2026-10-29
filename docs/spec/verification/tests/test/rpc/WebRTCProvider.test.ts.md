# WebRTCProvider.test.ts

Test file: [WebRTCProvider.test.ts](../../../../../../test/rpc/WebRTCProvider.test.ts)
Exercises: [WebRTCProvider.ts.md](../../../../implementation/source/src/rpc/network/services/WebRTCSetup/connection/WebRTCProvider.ts.md)

## Overview

Use the real global constructor or an isolated module environment; assert constructor identity, unchanged import rejection details, unavailable-provider message and Node non-worker result.

## Tests

- `returns the real global WebRTC constructor`: UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P1
- `propagates a rejected provider import without wrapping it`: UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P2
- `keeps the unavailable-provider error for a module without a constructor`: UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P3
- `does not classify the Node global as a browser worker`: UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P4
