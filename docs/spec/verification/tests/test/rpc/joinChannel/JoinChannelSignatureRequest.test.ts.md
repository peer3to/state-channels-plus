# JoinChannelSignatureRequest.test.ts

Test file: [test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts](../../../../../../../test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts)
Exercises: [JoinChannelService.ts](../../../../../implementation/source/src/rpc/network/services/joinChannel/JoinChannelService.ts.md)

## Overview

A real signed zero balance invokes the receiver service; the exact join balance error and actual blacklist side effect are observed.

The tests drive `JoinChannelService` through live `MathTestSession` peers. The slash case creates
and kills a real spam dispute, then proves the contract threshold and collected signers exclude
the slashed participant. The collector-guard case proves local-identity and non-positive-deadline
failures send no signature requests. The main validation case collects a valid confirmation,
checks the returned snapshot and fork pins, and sends crafted requests through the real RPC layer.
It covers missing and mismatched identities, malformed encodings and signatures, channel and pin
errors, expiry, non-member authority, refusal without disconnection,
and retry. It also advances and posts a real snapshot before checking stale-pin refusal, then adds
a pending participant without a transport and proves preflight sends no requests or partial join
state. The fault case uses concrete host controls to make one live threshold peer delay, throw, or
return the joiner's signature; every collection fails as a whole, and the short deadline wins over
the longer agreement timeout.

The owned-chain deadline fixture clears the shared-chain deployment-cache setting during startup and restores it in `finally`, alongside the provider URLs. This prevents private-chain deployments from reading or overwriting shared-chain markers. Run 450 failed during startup at `getAllTimes()`, before either deadline assertion; validation of this isolation correction is pending the next test run.

## Tests

- `excludes an on-chain-slashed participant from collection`: REQ-JOINSIG-2-RR2G4Q.T1.P7, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P8, UNIT-TEST-STATE-MANAGER-5-D8GDWH.P1
- `rejects collector identity and deadline failures before requesting signatures`: REQ-JOINSIG-2-RR2G4Q.T1.P8, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P5, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P9
- `validates requests, signs exact joins, and waits through reachability grace for a missing threshold transport`: REQ-ID-3-KR0BE3.T1.P4, REQ-RPC-3-ZM9WR5.T1.P5, INTEGRATION-TEST-RPC-6-009EGG.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P1, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P10, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P11, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P1, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P2, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P3, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P4, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P5, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P6, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P7, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P8, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P9, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P10, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P11, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P14, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P15, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P16, INV-JOINSIG-1-JX5EC4.T1.P1, INV-JOINSIG-1-JX5EC4.T1.P2, INV-JOINSIG-1-JX5EC4.T1.P3, INV-JOINSIG-1-JX5EC4.T1.P4, REQ-JOINSIG-1-8X1A4V.T1.P1, REQ-JOINSIG-1-8X1A4V.T1.P2, REQ-JOINSIG-1-8X1A4V.T1.P3, REQ-JOINSIG-2-RR2G4Q.T1.P1, REQ-JOINSIG-2-RR2G4Q.T1.P3, REQ-JOINSIG-3-VAGFVD.T1.P1, REQ-JOINSIG-3-VAGFVD.T1.P3, REQ-JOINSIG-3-VAGFVD.T1.P4, REQ-JOINSIG-3-VAGFVD.T1.P5, REQ-JOINSIG-3-VAGFVD.T1.P6, REQ-JOINSIG-3-VAGFVD.T1.P7
- `rejects erroring, wrong-signer, and deadline-silent threshold members`: REQ-JOINSIG-2-RR2G4Q.T1.P2, REQ-JOINSIG-2-RR2G4Q.T1.P4, REQ-JOINSIG-2-RR2G4Q.T1.P5, REQ-JOINSIG-2-RR2G4Q.T1.P6, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P2, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P4, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P6, UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P7
- `rejects a signed zero balance and blacklists the requesting joiner`: UNIT-TEST-JOIN-CHANNEL-SERVICE-32-BQYC6G.P1

The exact-deadline case uses the harness-owned private node path, checks ownership before pausing interval mining, and restores mining in `finally`. Real peer RPCs sign at the fixed latest block timestamp and refuse a deadline one second earlier. Shared worker nodes are never mutated. This replaces the prior race between a shared-node timestamp read and unrelated block production.

- `accepts the exact responder deadline and rejects one second past it on an owned chain`: UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P12, UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P13, REQ-JOINSIG-3-VAGFVD.T1.P2
