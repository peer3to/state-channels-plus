# JoinCollectionError.ts

> **Source:** [src/rpc/network/services/joinChannel/JoinCollectionError.ts](../../../../../../../../../src/rpc/network/services/joinChannel/JoinCollectionError.ts)

## Requirements

- [`REQ-JOINSIG-2-RR2G4Q` (All-or-nothing unanimity)](../../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)

## UNIT-TEST-JOIN-COLLECTION-ERROR-1-W9DB6V

Collection failure report

- Setup: Fail a join collection with one unreachable member, with one erroring member, with one wrong-signer member, and with one wrong-signer and one erroring member together
- Oracle: The error's name is `JoinCollectionError`; its message names every failed member by checksum address, each with its reason (`unreachable`, `no-answer`, `wrong-signer`) and detail

- [x] `UNIT-TEST-JOIN-COLLECTION-ERROR-1-W9DB6V.P1` — one unreachable member after the reachability grace: the name and the message with the member, `unreachable` and its detail
- [x] `UNIT-TEST-JOIN-COLLECTION-ERROR-1-W9DB6V.P2` — one erroring member and one wrong-signer member: the name and the message with each member, its reason and its detail
