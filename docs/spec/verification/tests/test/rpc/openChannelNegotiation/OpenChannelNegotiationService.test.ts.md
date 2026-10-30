# OpenChannelNegotiationService.test.ts

Test file: [test/rpc/openChannelNegotiation/OpenChannelNegotiationService.test.ts](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelNegotiationService.test.ts)
Exercises: [OpenChannelNegotiationService.ts](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md)

## Overview

Use authenticated host transports and real encoded terms; inspect exact admission, retained attempt, zero balance rejection and blacklist/retry outcome.

The worker-hosted component probes cover deferred replay, local channel-ID derivation, unsigned abandonment, invalid numeric terms, initiator silence, wrong peers and attempts, duplicate and conflicting terms, malformed proposals, already-open IDs, signed-attempt retention, typed internal chain-open observation, expiry completion, and a terms request whose attempt is cleared during its balance check or its channel selection. Each independent failure scenario has its own test declaration.

## Tests

- `replays an early committed request and clears an unsigned abandoned attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P16, REQ-NEG-4-ZQ0985.T1.P1, REQ-NEG-4-ZQ0985.T1.P7, REQ-NEG-4-ZQ0985.T1.P10
- `strikes a lost committed peer instead of blacklisting it`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P7
- `rejects a non-finite opening amount and clears the attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P8
- `strikes a silent lower-address initiator and clears the attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P17, REQ-NEG-4-ZQ0985.T1.P3, REQ-NEG-4-ZQ0985.T1.P17
- `blacklists a wrong peer without changing the selected attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P19
- `blacklists the selected peer for a wrong attempt and clears it`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P20, REQ-NEG-4-ZQ0985.T1.P4
- `accepts duplicate terms but punishes conflicting terms`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P21, REQ-NEG-4-ZQ0985.T1.P5
- `blacklists and clears a malformed opening proposal`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P22, REQ-NEG-4-ZQ0985.T1.P13
- `ordinary derived-ID already-open is failure with no raw-topic fallback`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P23, REQ-NEG-2-ED48TZ.T1.P5, REQ-NEG-4-ZQ0985.T1.P16
- `retains signed attempts and observes chain open through the internal event bus`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P18, REQ-NEG-1-RTKPT1.T1.P4, REQ-NEG-1-RTKPT1.T1.P6, REQ-NEG-4-ZQ0985.T1.P8, REQ-NEG-2-ED48TZ.T1.P6, REQ-NEG-2-ED48TZ.T1.P7, REQ-NEG-4-ZQ0985.T1.P15
- `targeted authoritative open returns the selected-channel handoff outcome`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P24
- `targeted open during local signature wait skips transaction submission`: REQ-TJOIN-2-MFWADG.T1.P4
- `negotiation probe settles at the observed-open handoff boundary`: none
- `tx wait rejection becomes observed-open handoff when the targeted channel opened`: REQ-TJOIN-2-MFWADG.T1.P5
- `tx wait rejection remains an error while the target is unopened`: none
- `ordinary derived-ID receipt rejection does not become an observed-open handoff`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P25, REQ-NEG-4-ZQ0985.T1.P18
- `clears the selected ID after an unsigned ordinary failure and resumes matching`: none
- `matched negotiation ignores expired matchmaking timeout`: none
- `submitted opening transaction ignores expired matchmaking timeout`: none
- `ordinary joinLobby forwards supplied and default balances with an internal deadline`: none
- `targeted auto-open forwards supplied and default balances with an internal deadline`: none

### Mode-specific outcome evidence

- `target-open classification blocks submission until participant lookup completes`: UNIT-TEST-OBSERVED-OPEN-CLASSIFICATION-1-2WWP73.P1

The suite consumes direct `NegotiationOutcome` values. Ordinary derived-ID collision remains a punished retry
with ID/listener cleanup and no raw-topic fallback. Targeted cases cover fixed-ID retention, terminal unsigned
failure, authoritative-open handoff, the post-sign no-submission guard, and receipt rejection reclassified only
after an authoritative fixed-target open read. Full encoded balances preserve `amount` and `data`.

- `characterizes selector commitment admission`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P1
- `characterizes advertiser commitment admission`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P2
- `characterizes absent commitment admission`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P3
- `characterizes malformed commitment admission`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P4
- `rejects zero local opening balance before installing an attempt`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P5
- `blacklists zero remote opening balance and clears its unsigned attempt`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P6
- `a terms request whose attempt is cleared during the balance check selects no channel and keeps the reset status`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P9
- `a terms request whose attempt is cleared during the channel selection keeps the reset status and subscribes nothing`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P8, UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P21
- `the lower address selects no channel while its terms request is pending`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-SERVICE-32-8V0VCD.P10
- `treats an unsigned remote abort as a lifecycle exit with no verdict and no strike`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P26
- `keeps a locally signed attempt observed after a remote abort`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P27
- `ends a targeted attempt on a remote abort without penalizing the peer`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P28
- `rejects a duplicate abort for an attempt that already ended`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-1-G73XX2.P29
