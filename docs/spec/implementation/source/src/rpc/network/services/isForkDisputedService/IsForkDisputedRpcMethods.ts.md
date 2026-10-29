# IsForkDisputedRpcMethods.ts

> **Source:** [src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../../../../../src/rpc/network/services/isForkDisputedService/IsForkDisputedRpcMethods.ts)

## Requirements

- [`REQ-DACK-1-ESEGGG` (One round per fork per peer pair)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)
- [`REQ-IFD-2-13862Z` (Acknowledge only verified disputes)](../../../../../../../specification/peer-communication/dispute-acknowledgment.md#req-ifd-2-13862z)

## UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B

Responder verification

- Setup: Ask about disputed/undisputed forks; repeat
- Oracle: Truthful answers from own verification; an undisputed fork is a counted close of the requester, no blacklist; repeats violate

- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P1` — disputed confirm
- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P2` — a fork the responder does not see as disputed: counted close of the requester, no blacklist
- [ ] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P3` — chain-fallback path
- [x] `UNIT-TEST-IS-FORK-DISPUTED-METHODS-1-JZBH4B.P4` — duplicate violation
