# IsForkDisputedRpcMethods.ts

> **Source:** [src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/is-fork-disputed.md](../../../../../../views/architecture/sdk/rpc/is-fork-disputed.md)

## Requirements

- [`REQ-DACK-1-ESEGGG` (One round per fork per peer pair)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)

## UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B

Responder verification

- Setup: Ask about disputed/undisputed forks; repeat
- Oracle: Truthful answers from own verification; repeats violate

- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P1` — disputed confirm
- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P2` — undisputed behavior
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P3` — chain-fallback path
- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P4` — duplicate violation
