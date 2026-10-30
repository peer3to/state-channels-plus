# JoinChannelSignatureRequest.test.ts

Test file: [test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts](../../../../../../../test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts)
Exercises: [JoinChannelService.ts](../../../../../implementation/source/src/rpc/network/services/joinChannel/JoinChannelService.ts.md), [ChannelJoinService.ts](../../../../../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md)

## Overview

A real signed zero balance invokes the receiver service; the exact join balance error and actual blacklist side effect are observed.

The tests drive `JoinChannelService` through live `MathTestSession` peers. The slash case creates
and kills a real spam dispute, then proves the contract threshold and collected signers exclude
the slashed participant. The collector-guard case proves local-identity and non-positive-deadline
failures send no signature requests. The main validation case collects a valid confirmation,
checks the returned snapshot and fork pins, and sends crafted requests through the real RPC layer.
It covers missing and mismatched identities, malformed encodings and signatures, channel errors,
expiry, non-member authority, refusal without disconnection,
and retry. It also advances and posts a real snapshot and proves the responder still signs the
join pinned to the old snapshot, then adds a pending participant without a transport and proves
preflight sends no requests or partial join state. The pin-race case holds a synced joiner's
collection at its threshold read, right after it pinned the snapshot, while the three participants
finalize a block and post a real snapshot; the released collection gets all three threshold
signatures and still returns the old pin. The reachability-grace case disconnects a synced joiner
from peer 1 and holds the joiner's handshake initiation, so peer 1 stays unproven after rediscovery;
once the joiner's reachability timeout is scheduled the collection is waiting, and releasing the
handshake lets it assemble both threshold signatures. With two of three members missing, releasing
one member's handshake leaves the collection pending with no signature request until the second
member is rediscovered, then all three sign. A failed collection is one typed `JoinCollectionError` that
names each failed member with its reason and detail; the unreachable case checks its name and exact message.
The fault case uses concrete host controls to make one live threshold peer throw or return the joiner's
signature, then makes one peer return the joiner's signature while another throws, and checks that the error
names both. It then holds the responder's join-signature answers (`holdJoinSignatureResponses`, released in
`finally`), so the request with a one-second deadline fails before the longer agreement timeout. Every
collection fails as a whole.

The connect cases hold one remote threshold member's join-signature answers past the request deadline. A
synced spectator's connect with a join returns `false`: `onAbort` fires once, the runtime closes, the joiner's
nonce is unchanged and the chain does not list it as pending. A participating peer's connect with a balance
returns `false`, stays `PARTICIPATING` with no abort and an unchanged nonce. A third case fails the joiner's
next threshold set read (`failNextJoinThresholdRead`); connect rejects with that error, with no abort,
`SYNCED` kept and an unchanged nonce.

The deadline case ([JoinSignatureDeadlineStaging](../../../../../../../test/fixtures/node/JoinSignatureDeadlineStaging.ts)) runs on the shared chain. The joiner pre-signs one request per second from 30 seconds before to 30 seconds after the responder's clock reading. On the responder's host, one synchronous run reads `Clock.getTimeInSeconds()` and calls the real `signJoinRequest` with the request whose deadline is that second and the one a second earlier; `signJoinRequest` checks the deadline before its first await, so both checks read the same second, and the run repeats when a second boundary passed. The oracles are a signature by the responder for the exact deadline and the `join expired` error one second past it. The chain is not mutated.

The held-chain case starts two founders with peer 1's chain RPC behind a proxy, adds a synced spectator, and holds every `eth_call` and `eth_getBlockByNumber` at that proxy. The spectator then collects a join confirmation; its signers must equal the on-chain threshold set, so peer 1 answered from its local clock and mirror. The mirror-miss case holds a member's mirror update, forces that member's join to land, and checks that the member's mirror does not list it while the chain does; a join signature request to that member must then return its signature.

The configured-lifetime case (staging in `test/fixtures/JoinDeadlineStaging.ts`) prepares a real first
join on a session configured with `JOIN_CHANNEL_DEADLINE_SECONDS: 300` and asserts two collected
signatures and a deadline equal to the chain timestamp read during preparation plus 300. After a session
reset, a runtime without the option gets the chain timestamp plus the default lifetime.

## Tests

- `a prepared first join's deadline is its chain time plus the configured lifetime; a later runtime gets the default`: UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P13
- `rejects a signed zero balance and blacklists the requesting joiner`: UNIT-TEST-JOIN-CHANNEL-SERVICE-32-BQYC6G.P1
- `excludes an on-chain-slashed participant from collection`: REQ-JOINSIG-2-RR2G4Q.T1.P7, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P8, UNIT-TEST-STATE-MANAGER-5-D8GDWH.P1
- `collects every countersignature when a snapshot post lands between the joiner's pin read and the countersigners' replies`: REQ-JOINSIG-1-8X1A4V.T1.P2, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P14
- `rejects collector identity and deadline failures before requesting signatures`: REQ-JOINSIG-2-RR2G4Q.T1.P8, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P5, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P9
- `validates requests, signs exact joins, and waits through reachability grace for a missing threshold transport`: UNIT-TEST-JOIN-COLLECTION-ERROR-1-W9DB6V.P1, REQ-ID-3-KR0BE3.T1.P4, REQ-RPC-3-ZM9WR5.T1.P5, INTEGRATION-TEST-RPC-6-009EGG.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P1, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P10, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P11, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P1, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P4, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P5, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P6, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P7, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P8, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P9, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P10, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P11, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P16, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P17, INV-JOINSIG-1-JX5EC4.T1.P1, INV-JOINSIG-1-JX5EC4.T1.P2, INV-JOINSIG-1-JX5EC4.T1.P3, INV-JOINSIG-1-JX5EC4.T1.P4, REQ-JOINSIG-1-8X1A4V.T1.P1, REQ-JOINSIG-2-RR2G4Q.T1.P1, REQ-JOINSIG-2-RR2G4Q.T1.P3, REQ-JOINSIG-3-VAGFVD.T1.P1, REQ-JOINSIG-3-VAGFVD.T1.P3, REQ-JOINSIG-3-VAGFVD.T1.P4, REQ-JOINSIG-3-VAGFVD.T1.P5, REQ-JOINSIG-3-VAGFVD.T1.P7
- `waits through reachability grace until a threshold participant's handshake completes, then collects every countersignature`: UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P15
- `keeps waiting through reachability grace after a handshake that leaves another threshold participant unreachable`: UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P16
- `rejects erroring, wrong-signer, and deadline-silent threshold members`: REQ-JOINSIG-2-RR2G4Q.T1.P2, REQ-JOINSIG-2-RR2G4Q.T1.P4, REQ-JOINSIG-2-RR2G4Q.T1.P5, REQ-JOINSIG-2-RR2G4Q.T1.P6, REQ-JOINSIG-2-RR2G4Q.T1.P9, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P2, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P4, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P6, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P7, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P17, UNIT-TEST-JOIN-COLLECTION-ERROR-1-W9DB6V.P2
- `accepts the exact responder deadline and rejects one second past it on the responder's local clock`: UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P12, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P13, REQ-JOINSIG-3-VAGFVD.T1.P2
- `collects every countersignature while a threshold member's chain RPC holds every read: the member answers from its local clock and mirror`: UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P18, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P78, REQ-JOINSIG-1-8X1A4V.T1.P25
- `signs for a threshold member whose mirror misses its own pending join: the chain lists it`: UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P19, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P79, REQ-JOINSIG-1-8X1A4V.T1.P26
- `a connect's join with one silent threshold member returns false: the joiner aborts and disposes, and submits nothing`: REQ-TJOIN-5-Q795M7.T1.P27, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P107
- `a committed member's top-up through connect with one silent threshold member returns false: it keeps its status and submits nothing`: REQ-TJOIN-5-Q795M7.T1.P29, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P108, UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P9
- `a connect's join whose threshold set read fails rejects: the failure is not a collection failure, so the joiner neither aborts nor submits`: REQ-TJOIN-5-Q795M7.T1.P28, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P109
