# IsForkDisputedService.ts

> **Source:** [src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/is-fork-disputed.md](../../../../../../views/architecture/sdk/rpc/is-fork-disputed.md)

## Requirements

- [`REQ-DACK-1-ESEGGG` (One round per fork per peer pair)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)
- [`REQ-DACK-2-MJZENJ` (Bilateral records)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-2-mjzenj)
- [`REQ-DACK-3-J4Z33Y` (Knowledge-gated consequences)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3-j4z33y)
  Missing: The rule assumes every honest peer can verify within the window, so the unavailability-versus-misbehavior split applies at the bound and stays an open fault-taxonomy decision ([`DEF-5-E8TP9N`](../../../../../../../audit/open-findings.md#def-5-e8tp9n) family).

## UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE

Round semantics

- Setup: Run rounds normally, duplicate in both directions, across reconnects, with confirming/refusing/silent peers
- Oracle: One round per fork per pair; duplicates violate; records survive churn; refusal/silence counts one close; straggler tolerance flips exactly at recording

- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P1` — normal round bilateral records
- [x] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P2` — duplicate request violation
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P3` — record survives reconnect
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P4` — refusal strike
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P5` — tolerance boundary before recording
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P6` — duplicate answer violation
- [x] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P7` — timeout strike and reconnection
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-SERVICE-1-8DQFCE.P8` — tolerance boundary after recording
