# LeaveChannelService.ts

> **Source:** [LeaveChannelService.ts](../../../../../../../src/stateManager/membership/LeaveChannelService.ts)
>
> **Design views:** [architecture.md](../../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-DISPUTE-PIPE-7-76N72X` (Combined membership intent)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)

## UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9

Terminal leave state machine

- Setup: Enter through `P2pInstance.leaveChannel` or the internal signer route from every commitment state.
- Oracle: Hook substitution, fixed bounds, self-removal dispute input, settled removal, and one terminal disposal are exact; no cross-channel work starts.

- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P1` — immediate non-committed leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P2` — authored exit
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P3` — pending promotion
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P4` — fixed block bound
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P5` — zero-block watchdog
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6` — existing dispute wait and next-fork retry
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P7` — authored exit cancels the recorded watchdog and enters exit-authored
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P8` — pending leave with the signer still local makes no chain membership read
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P9` — pending terminal leave rejects joinLobby
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P10` — pending terminal leave rejects joinChannel
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P11` — pending terminal leave rejects topUpBalance
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P12` — pending terminal leave rejects collectJoinChannelConfirmation
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P13` — leave watchdog rejects without a dispute marker
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P14` — leave watchdog rejects after the evidence period expires
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P15` — disposal rejects leave before a held watchdog upload completes; late completion preserves the disposal rejection
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P16` — fast snapshot failure followed by a missing dispute marker rejects authored leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P17` — fast snapshot failure followed by an evidence-expired error rejects authored leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P18` — an unsigned exit followed by a missing dispute marker rejects authored leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P19` — an unsigned exit followed by an evidence-expired error rejects authored leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P20` — an unsigned exit starts one real self-removal dispute and settles leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P21` — fallback failure ignores absent and awaiting-exit operations
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P22` — a fallback failure for another fork cannot reject an authored leave
