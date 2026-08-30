# test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts — Test Report

> **Test file:** [test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [OpenChannelNegotiationHelpers.ts](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md)

## Overview

The pure helper cases use real wallet addresses and committed challenge pairs. They prove both peer views derive one ID, fresh rounds differ, malformed/self/zero transcripts reject, and a lobby match has no caller- or peer-supplied channel ID.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                  | Covers                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Negotiated channel ID > derives the same ID from both peer views of one committed transcript`](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts#L23) (line 23)  | [`UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P1`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-negotiated-channel-id-1-4c09gw.p1) |
| [`Negotiated channel ID > derives distinct IDs for fresh challenge rounds between the same pair`](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts#L32) (line 32) | [`UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P2`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-negotiated-channel-id-1-4c09gw.p2) |
| [`Negotiated channel ID > rejects self matches and malformed or zero challenges`](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts#L45) (line 45)                 | [`UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P3`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-negotiated-channel-id-1-4c09gw.p3) |
| [`Negotiated channel ID > keeps the lobby match payload free of any supplied channel ID`](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts#L59) (line 59)         | [`UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P4`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-negotiated-channel-id-1-4c09gw.p4) |
