# P2pRuntimeHostReadiness.test.ts

Test file: [P2pRuntimeHostReadiness.test.ts](../../../../../../test/evm/P2pRuntimeHostReadiness.test.ts)
Exercises: [P2pRuntimeHostRoot.ts.md](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Overview

Create a real port and host before deployComplete; each signer/hostRpc request returns the same request ID and Runtime is not ready before payload decode, while deploy signer reads succeed.

## Tests

- `allows chain message signing before deployment`: none
- `allows raw message signing before deployment`: none
- `allows chain typed data signing before deployment`: none
- `allows raw typed data signing before deployment`: none
- `rejects sendTransaction before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P1
- `rejects callView before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P2
- `rejects connectToChannel before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P3
- `rejects cancelConnectToChannel before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P4
- `rejects leaveChannel before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P5
- `rejects joinLobby before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P6
- `rejects leaveLobby before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P7
- `rejects joinChannel before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P8
- `rejects topUpBalance before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P9
- `rejects collectJoinChannelConfirmation before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P10
- `rejects getChannelStatus before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P11
- `rejects setIsLeader before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P12
- `rejects disconnectFromPeers before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P13
- `rejects hostRpc before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P14
- `allows deploy signer address reads before deployment`: UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P15
