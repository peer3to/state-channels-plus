# test/rpc/WebRTCProvider.test.ts — Test Report

> **Test file:** [WebRTCProvider.test.ts](../../../../../../test/rpc/WebRTCProvider.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [WebRTCProvider.ts.md](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts.md)

## Overview

Use the real global constructor or an isolated module environment; assert constructor identity, unchanged import rejection details, unavailable-provider message and Node non-worker result.

## Tests and covered test IDs

| Test declaration                                                                                                                                              | Covers                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCProvider > returns the real global WebRTC constructor`](../../../../../../test/rpc/WebRTCProvider.test.ts#L10) (line 10)                              | [`UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P1`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts.md#unit-test-web-rtcprovider-32-gqwrrs.p1) |
| [`WebRTCProvider > propagates a rejected provider import without wrapping it`](../../../../../../test/rpc/WebRTCProvider.test.ts#L34) (line 34)               | [`UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P2`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts.md#unit-test-web-rtcprovider-32-gqwrrs.p2) |
| [`WebRTCProvider > keeps the unavailable-provider error for a module without a constructor`](../../../../../../test/rpc/WebRTCProvider.test.ts#L39) (line 39) | [`UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P3`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts.md#unit-test-web-rtcprovider-32-gqwrrs.p3) |
| [`WebRTCProvider > does not classify the Node global as a browser worker`](../../../../../../test/rpc/WebRTCProvider.test.ts#L45) (line 45)                   | [`UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P4`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts.md#unit-test-web-rtcprovider-32-gqwrrs.p4) |
