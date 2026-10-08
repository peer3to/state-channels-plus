# OpenChannel.test.ts

Test file: [test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts)
Exercises: [StateChannelManagerProxy.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md), [JoinChannelFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md)

## Overview

A Hardhat suite on the Math channel proxy fixture (`deployMathChannelProxyFixture`) that drives
the admission surface of the manager: `open` with unanimous `OpenChannel` signatures, and
`joinChannel`/`topUpBalance` with SDK-built (`SignatureUtils`) signed payloads pinned to the
current snapshot hash and fork id. The oracles are receipt events (`ChannelOpened`,
`InboundMessagesProcessed` and their channel-id topics), revert strings/custom errors
(`Cryptography: …`, `ErrorJoinChannelInvalidSubmitter`, `ErrorInvalidChannelId`,
`RaceConditionChannelAlreadyOpen`, `ErrorInvalidJoinChannel`, `RaceConditionJoinChannelExpired`,
`ECDSAInvalidSignatureLength`), and post-state reads (`isChannelOpen`, `getStateSnapshot`,
`getChannelBalance`, `getPendingParticipants`). Signature-order independence, threshold
shortfalls, duplicate and zero channel ids, a zero-amount open, and the join deadline expiry are
each covered; the deepest test extracts the forced inbound JOIN message from the join receipt and
replays it against a raw `MathStateMachine` to confirm membership and balance effects.
Deposit-adapter composition (atomic vs partial), calldata posting, and disputed-fork join gates
are out of scope. The permutation pool has since been atomized: the former two-scenario bundles
are now single-scenario IDs (duplicate vs zero channel id, per-gate join reverts), and each half
is assigned to its own test below.

## Tests

- `enumerates successful opens in append order with safe page boundaries`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P1, REQ-LIF-8-2HDG3A.T1.P1, REQ-LIF-8-2HDG3A.T1.P3
- `keeps the open-channel registry unchanged after a duplicate open reverts`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P2, REQ-LIF-8-2HDG3A.T1.P2
- `2 participants - success`: INV-ENFADM-1-H53AQY.T1.P1, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P1
- `2 participants signatures not inorder - success`: none
- `2 participants 1 signature - fail`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P3
- `2 participants double signature - fail`: none
- `2 participants wrong encoded openChannel msg - fail`: none
- `2 participants no signatures - fail`: none
- `2 participants invalid signature length - fail`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P15
- `forces inbound join message and updates math state machine`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P2, REQ-ENFADM-1-V926CA.T1.P4, INV-ENFADM-1-H53AQY.T1.P2, INV-ENFADM-1-H53AQY.T1.P4, UNIT-TEST-SM-ASTATE-5-HYC257.P1, UNIT-TEST-SM-MATH-5-AYZHPG.P1, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P8, REQ-MSG-11-VS3ZGC.T2.P4
- `requires the encoded participant to submit the join`: REQ-ENFADM-1-V926CA.T1.P1, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P6
- `tops up an existing participant without duplicating membership`: INV-ENFADM-1-H53AQY.T1.P5, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P3
- `2 participants channelId = 0 - fail`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P1
- `2 participants channel already exists - fail`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P2
- `2 participants channelId cannot be 0x0 - fail`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P7
- `2 participants amount 0 - success with zero balance`: none
- `2 participants time expired - fail`: REQ-ENFADM-1-V926CA.T1.P7, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P7
