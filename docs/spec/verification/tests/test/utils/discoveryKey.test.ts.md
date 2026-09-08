# test/utils/discoveryKey.test.ts — Test Report

> **Test file:** [test/utils/discoveryKey.test.ts](../../../../../../test/utils/discoveryKey.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [discoveryKey.ts](../../../../implementation/source/src/utils/discoveryKey.ts.md)

## Overview

Derive raw and domain-separated keys with boundary hex inputs and compare exact bytes/errors; direct validator cases assert caller error and void return.

These cases verify that channel discovery uses the exact bytes32 channel ID and rejects text or
short-hex values before transport discovery starts.

## Tests and covered test IDs

| Test declaration                                                                                                                              | Covers                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`discovery key > uses the exact channel ID bytes and rejects invalid values`](../../../../../../test/utils/discoveryKey.test.ts#L7) (line 7) | [`UNIT-TEST-P2P-MANAGER-2-HR5HCB.P3`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-2-hr5hcb.p3) |

The direct `targeted join topic is domain-separated from the raw channel key` case proves deterministic
`solidityPackedKeccak256(["string", "bytes32"], ["targeted-channel-join", channelId])`, exact 32-byte output,
and inequality with the unchanged raw discovery key.
| [`discovery key > targeted join topic is domain-separated from the raw channel key`](../../../../../../test/utils/discoveryKey.test.ts#L19) (line 19) | — |
| [`discovery key > rejects short IDs in both discovery derivations`](../../../../../../test/utils/discoveryKey.test.ts#L33) (line 33) | [`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P1`](../../../../implementation/source/src/utils/discoveryKey.ts.md#unit-test-discovery-key-32-f0qwhx.p1) |
| [`discovery key > rejects long IDs in both discovery derivations`](../../../../../../test/utils/discoveryKey.test.ts#L42) (line 42) | [`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P2`](../../../../implementation/source/src/utils/discoveryKey.ts.md#unit-test-discovery-key-32-f0qwhx.p2) |
| [`discovery key > rejects malformed IDs in both discovery derivations`](../../../../../../test/utils/discoveryKey.test.ts#L51) (line 51) | [`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P3`](../../../../implementation/source/src/utils/discoveryKey.ts.md#unit-test-discovery-key-32-f0qwhx.p3) |
| [`discovery key > preserves mixed-case channel bytes and targeted derivation`](../../../../../../test/utils/discoveryKey.test.ts#L60) (line 60) | [`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P4`](../../../../implementation/source/src/utils/discoveryKey.ts.md#unit-test-discovery-key-32-f0qwhx.p4) |
| [`discovery key > uses the caller message for undefined bytes32 input`](../../../../../../test/utils/discoveryKey.test.ts#L73) (line 73) | [`UNIT-TEST-BYTES32-32-E6KC18.P1`](../../../../implementation/source/src/utils/bytes32.ts.md#unit-test-bytes32-32-e6kc18.p1) |
| [`discovery key > validates bytes32 without returning a normalized value`](../../../../../../test/utils/discoveryKey.test.ts#L78) (line 78) | [`UNIT-TEST-BYTES32-32-E6KC18.P2`](../../../../implementation/source/src/utils/bytes32.ts.md#unit-test-bytes32-32-e6kc18.p2) |
