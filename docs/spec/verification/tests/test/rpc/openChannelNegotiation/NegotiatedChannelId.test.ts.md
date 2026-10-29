# NegotiatedChannelId.test.ts

Test file: [test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts](../../../../../../../test/rpc/openChannelNegotiation/NegotiatedChannelId.test.ts)
Exercises: [OpenChannelNegotiationHelpers.ts](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md)

## Overview

The pure helper cases use real wallet addresses and committed challenge pairs. They prove both peer views derive one ID, fresh rounds differ, malformed/self/zero transcripts reject, and a lobby match has no caller- or peer-supplied channel ID.

## Tests

- `derives the same ID from both peer views of one committed transcript`: UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P1
- `derives distinct IDs for fresh challenge rounds between the same pair`: UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P2
- `rejects self matches and malformed or zero challenges`: UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P3
- `keeps the lobby match payload free of any supplied channel ID`: UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P4
