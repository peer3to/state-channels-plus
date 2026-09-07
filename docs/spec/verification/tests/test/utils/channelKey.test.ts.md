# test/utils/channelKey.test.ts — Test Report

> **Test file:** [channelKey.test.ts](../../../../../../test/utils/channelKey.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [channelKey.ts.md](../../../../implementation/source/src/utils/channelKey.ts.md)

## Overview

Case variants share a key and non-string inputs retain permissive String conversion without validation.

## Tests and covered test IDs

| Test declaration                                                                                                                          | Covers                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`channelKey > shares an identity across hex case variants`](../../../../../../test/utils/channelKey.test.ts#L6) (line 6)                 | [`UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P1`](../../../../implementation/source/src/utils/channelKey.ts.md#unit-test-channel-key-32-yj2a0a.p1) |
| [`channelKey > preserves permissive string conversion without validation`](../../../../../../test/utils/channelKey.test.ts#L10) (line 10) | [`UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P2`](../../../../implementation/source/src/utils/channelKey.ts.md#unit-test-channel-key-32-yj2a0a.p2) |
