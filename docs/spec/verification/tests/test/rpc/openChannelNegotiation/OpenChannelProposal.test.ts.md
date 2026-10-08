# test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts — Test Report

> **Test file:** [test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [OpenChannelNegotiationHelpers.ts](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite unit-tests the pure comparator `getOpenChannelProposalMismatch` with hand-built
`OpenChannelStruct` fixtures — no service, signatures, or transport. An exactly matching proposal
returns `null`; then each security-sensitive field is varied one test at a time — a tampered
balance amount, tampered balance data, a substituted participant, a different `channelId`, a
non-atomic open, non-empty opening `data`, a deadline in the past, deadlines one and 29 seconds
ahead (below the 30-second minimum), a deadline exactly 30 seconds ahead (accepted), and a deadline
beyond the allowed window — and each test asserts the specific mismatch reason string. A final test shows
participant/address comparison is checksum-canonical (casing-insensitive). What the negotiation
service does with the mismatch result (co-sign vs disconnect + blacklist + reset), lower-signature
recovery, and slot/state handling are out of scope. The
[`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) permutations are now one field variation each, and the
per-field tests below are assigned to them. Still unassigned: the length variations (P4
participants, P6 balances) have no test; P2 (deadline at the expired edge) is probed one second
past the edge (`now - 1`), and the comparator now rejects everything below the 30-second minimum,
so the expired edge is not a boundary any more; and P3 (sort/alignment canonicalization) is not what the casing test shows.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                         | Covers                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`getOpenChannelProposalMismatch > accepts a proposal that matches the negotiated terms`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L47) (line 47)                | —                                                                                                                                                                                                                         |
| [`getOpenChannelProposalMismatch > rejects a tampered balance amount (no fund redirection)`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L57) (line 57)             | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P7`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf)  |
| [`getOpenChannelProposalMismatch > rejects tampered balance data`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L65) (line 65)                                       | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P8`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf)  |
| [`getOpenChannelProposalMismatch > rejects a different participant set`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L73) (line 73)                                 | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P5`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf)  |
| [`getOpenChannelProposalMismatch > rejects a different channelId`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L81) (line 81)                                       | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P1`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf)  |
| [`getOpenChannelProposalMismatch > rejects non-atomic opens`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L89) (line 89)                                            | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P9`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf)  |
| [`getOpenChannelProposalMismatch > rejects opening data that differs from the locally derived data`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L97) (line 97)     | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P10`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
| [`getOpenChannelProposalMismatch > rejects a deadline in the past`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L105) (line 105)                                    | —                                                                                                                                                                                                                         |
| [`getOpenChannelProposalMismatch > rejects a deadline one second ahead as too close`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L113) (line 113)                  | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P13`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
| [`getOpenChannelProposalMismatch > rejects a deadline 29 seconds ahead as too close`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L121) (line 121)                  | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P14`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
| [`getOpenChannelProposalMismatch > accepts a deadline exactly 30 seconds ahead`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L129) (line 129)                       | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P15`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
| [`getOpenChannelProposalMismatch > rejects a deadline beyond the allowed window`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L137) (line 137)                      | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P11`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
| [`getOpenChannelProposalMismatch > matches participants and channelId irrespective of address casing`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L145) (line 145) | —                                                                                                                                                                                                                         |
| [`getOpenChannelProposalMismatch > accepts the locally derived application opening data`](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L153) (line 153)              | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P12`](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) |
