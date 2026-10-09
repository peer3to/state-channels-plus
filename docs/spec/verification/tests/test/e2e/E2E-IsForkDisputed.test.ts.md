# E2E-IsForkDisputed.test.ts

Test file: [test/e2e/E2E-IsForkDisputed.test.ts](../../../../../../test/e2e/E2E-IsForkDisputed.test.ts)
Exercises: [IsForkDisputedService.ts](../../../../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts.md), [IsForkDisputedRpcMethods.ts](../../../../implementation/source/src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts.md)

## Overview

Exercises the isForkDisputed acknowledgment protocol over real channels, mostly through the
`activeChannelWithDispute` scenario (three peers, one byzantine, a genuine dispute) plus direct
RPC helpers. Requester side: one broadcast collects acknowledgments from every connected peer, a
repeated request for the same fork is locally ignored (no second round), and peers that never
answer a request are disconnected after the reply window. Responder side: a first request for a
genuinely disputed fork is verified and recorded, a duplicate request from the same peer is a
protocol violation that disconnects the requester, and a request naming a non-disputed fork
disconnects the false claimer. A recorded acknowledger that afterwards supplies a block on the
disputed fork is cut by the observer. Oracles are per-peer acknowledgment records in both
directions (`didPeerAcknowledgeDisputedFork`, `didIAcknowledgeDisputedFork`), disputed-fork
counters, and transport disconnect assertions; the last test only pins the harness's RPC stubbing
seam and carries no protocol obligation. After the permutation split, timeout exclusion is its own
permutation and is assigned to the timeout-disconnect test; the refusal-exclusion permutation
remains uncovered here.

## Tests

- `should broadcast acknowledgment request and receive responses from all peers`: REQ-DACK-1-ESEGGG.T1.P1, UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P1
- `should ignore duplicate dispute acknowledgment requests`: none
- `should disconnect peer sending duplicate acknowledgment requests`: REQ-DACK-1-ESEGGG.T1.P2, UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P4, UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P2, REQ-RPC-4-9VX0B9.T1.P7, INTEGRATION-TEST-RPC-6-009EGG.P5
- `should strike non-responding peers after acknowledgment timeout and let them reconnect`: UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P7
- `should disconnect peer building on acknowledged disputed fork`: REQ-DACK-3-J4Z33Y.T1.P2
- `should disconnect peer requesting acknowledgment of non-disputed fork`: UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P2
- `should run stubbed RPC method via createRPCMethods wrapper`: none
