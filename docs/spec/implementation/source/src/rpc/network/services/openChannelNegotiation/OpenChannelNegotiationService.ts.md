# OpenChannelNegotiationService.ts

> **Source:** [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/open-channel-negotiation.md](../../../../../../views/architecture/sdk/rpc/open-channel-negotiation.md)

## Requirements

- [`INV-NEG-1-6FW90P` (Negotiated-terms-only signing)](../../../../../../../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p)
- [`REQ-NEG-1-RTKPT1` (Deterministic proposer and submitter)](../../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-1-rtkpt1)
- [`REQ-NEG-2-ED48TZ` (Chain-observed completion)](../../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz)
- [`REQ-NEG-4-ZQ0985` (Committed-attempt admission and recovery)](../../../../../../../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985)

## UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2

Terms integrity and completion

- Setup: Run negotiations from both directions; deliver altered/cold/wrong-role proposals; race opens; lapse deadlines; contend the slot
- Oracle: Only self-rebuilt terms co-sign; invalid terms punish and clean up; completion only occurs through the chain.

- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P1` — local-initiated negotiation
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P2` — altered channelId
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P3` — cold proposal refused
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P4` — wrong-role proposer
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P5` — race-lost open defers
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P6` — deadline lapse resets
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P7` — slot busy
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P8` — invalid amount rejects and cleans up
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P9` — remote-initiated negotiation
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P10` — altered participants
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P11` — altered balances
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P12` — altered isAtomic
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P13` — altered data
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P14` — altered deadline
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P15` — third-party proposal ignored
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P16` — early replay, derived ID, and unsigned abandonment
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P17` — delayed ID selection and initiator silence
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P18` — submission failure, signed cancellation, final loss, open observation, and expiry
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P19` — wrong peer rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P20` — wrong attempt rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P21` — duplicate and conflicting terms rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P22` — malformed proposal rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P23` — already-open derived ID rejected
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P24` — an authoritative targeted open settles one selected-channel handoff, preserves the fixed target, and punishes neither peer
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P25` — an ordinary opening receipt failure closes with no strike and never excludes
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P26` — an unsigned remote abort clears the attempt with no verdict and no strike
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P27` — a remote abort against a locally signed attempt keeps it observed with no strike
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P28` — a remote abort ends a targeted attempt as targeted-failed with no strike
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P29` — a duplicate abort for an ended attempt is rejected
- [ ] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P30` — a silent initiator, a committed-peer loss, and an expired signed opening each record one strike and no verdict

## UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD

Negotiation admission and balance

- Setup: Use authenticated host transports and real encoded terms; inspect exact admission, retained attempt, zero balance rejection and blacklist/retry outcome.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P1` — characterizes selector commitment admission
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P2` — characterizes advertiser commitment admission
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P3` — characterizes absent commitment admission
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P4` — characterizes malformed commitment admission
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P5` — rejects zero local opening balance before installing an attempt
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P6` — blacklists zero remote opening balance and clears its unsigned attempt
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P7` — losing the committed peer bars it from the lobby session and leaves its identity standing intact

## UNIT-TEST-OBSERVED-OPEN-CLASSIFICATION-1-2WWP73

Await target-open classification

- Setup: Hold participant lookup, observe target open, release signing, then finish classification.
- Oracle: No opening submits before or after targeted handoff; exactly one handoff occurs and no peer is blacklisted.

- [x] `UNIT-TEST-OBSERVED-OPEN-CLASSIFICATION-1-2WWP73.P1` — signature completes while target participant lookup is pending
