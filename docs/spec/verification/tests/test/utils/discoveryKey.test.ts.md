# test/utils/discoveryKey.test.ts — Test Report

> **Test file:** [test/utils/discoveryKey.test.ts](../../../../../../test/utils/discoveryKey.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [discoveryKey.ts](../../../../implementation/source/src/utils/discoveryKey.ts.md)

## Overview

These cases verify that channel discovery uses the exact bytes32 channel ID and rejects text or
short-hex values before transport discovery starts.

## Tests and covered test IDs

| Test declaration                                                                                                                              | Covers                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`discovery key > uses the exact channel ID bytes and rejects invalid values`](../../../../../../test/utils/discoveryKey.test.ts#L7) (line 7) | [`UNIT-TEST-P2P-MANAGER-2-HR5HCB.P3`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-2-hr5hcb.p3) |

The direct `targeted join topic is domain-separated from the raw channel key` case proves deterministic
`solidityPackedKeccak256(["string", "bytes32"], ["targeted-channel-join", channelId])`, exact 32-byte output,
and inequality with the unchanged raw discovery key.
