# JoinChannelService.ts

> **Source:** [src/rpc/network/services/joinChannel/JoinChannelService.ts](../../../../../../../../../src/rpc/network/services/joinChannel/JoinChannelService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/join-channel.md](../../../../../../views/architecture/sdk/rpc/join-channel.md)

## Requirements

- [`INV-JOINSIG-1-JX5EC4` (Identity triple-binding)](../../../../../../../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4)
- [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
- [`REQ-JOINSIG-2-RR2G4Q` (All-or-nothing unanimity)](../../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)
- [`REQ-JOINSIG-3-VAGFVD` (Refusal is penalty-free)](../../../../../../../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)
- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)
- [`REQ-MSG-10-7JS45Q` (Joining MUST carry the joiner's signature plus the full threshold set's…)](../../../../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q)

## UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS

Collector unanimity

- Setup: Collect with responsive/silent/erroring/wrong-signer/unreachable members and deadline pressure
- Oracle: Only full unanimity assembles; every failure mode fails whole; requests never outlive the join deadline

- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P1` — unanimous success
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P2` — single silent member
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P3` — preflight unreachable
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P4` — deadline-bounded timeout
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P5` — self-collection-only guard
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P6` — single erroring member
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P7` — single wrong-signer member
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P8` — on-chain-slashed member excluded from collection
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P9` — deadline at or before collector time rejects before signature requests
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P10` — pending threshold member without a transport fails preflight
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P11` — returned snapshot and fork pins equal the collector's current chain view

## UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ

Responder validation chain

- Setup: Request signatures with each binding/pin/authority violated and fully valid
- Oracle: Only fully bound, currently pinned, in-threshold requests are signed over exact bytes; failures are penalty-free errors

- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P1` — all triple-binding violations
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P2` — snapshot or fork pin mismatch
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P3` — exact and expired deadline boundaries
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P4` — non-member authority
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P5` — valid countersign byte-exactness
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P6` — missing authenticated peer address
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P7` — signed-join decode failure
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P8` — valid signature from the wrong embedded signer
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P9` — authenticated requester differs from the participant
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P10` — malformed participant signature
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P11` — wrong channel
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P12` — exact responder deadline accepted
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P13` — deadline after boundary rejected
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P14` — snapshot moves after pinning
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P15` — fork pin mismatch
- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-2-834WFZ.P16` — validation refusal keeps the session usable for retry

## UNIT-TEST-JOIN-CHANNEL-SERVICE-32-BQYC6G

Join balance admission

- Setup: A real signed zero balance invokes the receiver service; the exact join balance error and actual blacklist side effect are observed.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-JOIN-CHANNEL-SERVICE-32-BQYC6G.P1` — rejects a signed zero balance and blacklists the requesting joiner
