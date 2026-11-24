# OpenChannelNegotiationService.ts

> **Source:** [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts)

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
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P8` — a terms request whose attempt is cleared during its channel selection keeps the reset status and leaves no channel subscription
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P9` — a terms request whose attempt is cleared during its balance check selects no channel
- [x] `UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P10` — the lower address selects no channel while its terms request is pending

## UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA

Opening-data and genesis hooks, stale-attempt rule

- Setup: Run a committed ordinary negotiation with a probe peer on each side of the address order, through the base service (default hook) and a root service that derives, fails, or holds `buildOpeningData`; agree a counterparty balance of `MaxUint256` so the real Math genesis hook reverts on its checked sum; deliver proposals with an altered genesis hash or an altered counterparty balance; cancel a held attempt, start a replacement with another peer, then settle the held hook
- Oracle: The proposal or accepted data equals the hook result for the exact agreed terms in address order, and the proposal's genesis hash equals the hash the genesis hook derives for the signed terms and the chain records; a hook failure, opening-data or genesis, ends the attempt locally with no proposal, co-signature, strike or close; an altered genesis hash or term is refused and the proposer blacklisted, the term check running before the genesis hook; a late hook result or failure after cancellation leaves the replacement current with its channel, deadline and pending outcome, and the replacement opens while the old peer gets no signature and no penalty

- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P1` — lower role, default hook: proposes empty data, no deriving hook is called, the channel opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P2` — higher role, default hook: accepts an empty-data proposal, no deriving hook is called, the channel opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P3` — lower role, deriving hook: one hook call with the exact agreed channel ID, participants and balances in address order, and the proposal carries its result
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P4` — higher role, deriving hook: one hook call with the exact agreed terms in address order, and a proposal carrying that data is co-signed and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P5` — lower role, hook fails: attempt and channel ID cleared, no proposal sent, retry outcome, no strike, blacklist or close
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P6` — higher role, hook fails: the proposal is refused with "Opening data unavailable", nothing is co-signed, attempt and channel ID cleared, retry outcome, no penalty
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P7` — lower role, hook result arrives after cancellation: no proposal for the old attempt and the replacement stays current and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P8` — lower role, hook failure arrives after cancellation: the replacement stays current with its channel, deadline and pending outcome, and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P9` — higher role, hook result arrives after cancellation: the old proposal is answered without signing, the old channel never opens, the replacement stays current and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P10` — higher role, hook failure arrives after cancellation: the old proposal fails with "Opening data unavailable", the replacement stays current and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P11` — after a cancelled attempt's late failure the replacement opens with exactly the local and new peer, and the old peer gets no proposal, open, strike, blacklist or close
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P12` — lower role: the proposal carries the genesis hash the hook derives for the signed terms, and the chain records that hash
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P13` — higher role: the chain records the genesis hash the higher peer derives for the terms it co-signed
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P14` — higher role, the proposal's genesis hash differs from the locally derived one: refused with "Genesis state hash mismatch", the proposer blacklisted, the attempt cleared, no open
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P15` — higher role, the proposal alters the counterparty balance to one the genesis hook would reject: refused as a balance mismatch and the proposer blacklisted, so the term check runs before the hook
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P16` — lower role, the genesis hook rejects the agreed balances: attempt and channel ID cleared, no proposal sent, retry outcome, no strike, blacklist or close
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P17` — higher role, the genesis hook rejects the agreed balances: the proposal is refused with "Genesis unavailable", nothing is co-signed or opened, attempt and channel ID cleared, retry outcome, no penalty
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P18` — lower role, the genesis hash arrives after cancellation: no proposal for the old attempt and the replacement stays current with its channel, deadline and pending outcome, and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P19` — higher role, the genesis hash arrives after cancellation: the old proposal is answered without signing, the old channel never opens, the replacement stays current and opens
- [x] `UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P20` — lower role, the counterparty opens the derived ID first with another participant set and a hash no genesis derives from: retry outcome, the counterparty blacklisted, the runtime keeps running with no genesis installed

## UNIT-TEST-OBSERVED-OPEN-CLASSIFICATION-1-2WWP73

Await target-open classification

- Setup: Hold participant lookup, observe target open, release signing, then finish classification.
- Oracle: No opening submits before or after targeted handoff; exactly one handoff occurs and no peer is blacklisted.

- [x] `UNIT-TEST-OBSERVED-OPEN-CLASSIFICATION-1-2WWP73.P1` — signature completes while target participant lookup is pending
