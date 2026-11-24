# OpenChannelNegotiationHelpers.ts

> **Source:** [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts](../../../../../../../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts)

## Requirements

- [`INV-NEG-1-6FW90P` (Negotiated-terms-only signing)](../../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p)
- [`REQ-NEG-4-ZQ0985` (Committed-attempt admission and recovery)](../../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985)
- [`REQ-ENFSM-3-JZK0FB` (Genesis derivation)](../../../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-3-jzk0fb)

## UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF

Mismatch exhaustiveness

- Setup: Vary each field independently; boundary deadlines
- Oracle: Each variation detected; identical structs pass; deadline window edges correct

- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P1` — channelId variation
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P2` — deadline at expired edge
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P3` — sort/alignment canonicalization
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P4` — participants length variation
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P5` — participant address variation
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P6` — balances length variation
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P7` — balance amount variation
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P8` — balance data variation
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P10` — opening data variation
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P11` — deadline beyond max edge
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P12` — expected non-empty opening data accepted
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P13` — deadline one second ahead rejected as too close
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P14` — deadline one second below the minimum window (`now + 29`) rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P15` — deadline exactly at the minimum window (`now + 30`) accepted

## UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW

Transcript-derived channel identity

- Setup: Derive IDs directly from valid and invalid committed lobby transcripts.
- Oracle: Both peer views agree; fresh rounds differ; no remote ID is accepted; malformed/self/zero inputs reject.

- [x] `UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P1` — both views agree
- [x] `UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P2` — fresh challenges derive distinct IDs
- [x] `UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P3` — malformed, zero, and self transcripts reject
- [x] `UNIT-TEST-NEGOTIATED-CHANNEL-ID-1-4C09GW.P4` — lobby match carries no channel ID

## UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-HELPERS-32-FMP9H2

Lobby role ordering

- Setup: Two real peer addresses in both index orders assign the lower address to advertiser and the other to selector.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-HELPERS-32-FMP9H2.P1` — orders lobby roles by the two real peer addresses in either peer ordering

## UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4

Opening joins and genesis hash

- Setup: Map the terms of a real open to their joins and compare them with the JOIN messages the open stores; compute the genesis hash for terms that open on chain and compare it with what every observer rebuilds from the chain's genesis join block
- Oracle: Each join pairs a participant with its balance, the channel ID and the deadline, in participant order and in the field order `open` encodes; the hash equals the hash of the state the consumer facet's hook derives from the chain's joins

- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4.P1` — `openChannelJoins` builds, for the terms of a real open, exactly the JOIN message data that open stores, in participant order
- [x] `UNIT-TEST-OPEN-NEGOTIATION-HELPERS-2-9KPZH4.P2` — `computeGenesisStateHash` equals the hash an observer rebuilds from the chain's genesis join block
