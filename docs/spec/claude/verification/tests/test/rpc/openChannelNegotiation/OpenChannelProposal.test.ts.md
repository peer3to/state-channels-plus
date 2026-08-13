# test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts — Test Report

> **Test file:** [test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [OpenChannelNegotiationHelpers.ts](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite unit-tests the pure comparator `getOpenChannelProposalMismatch` with hand-built
`OpenChannelStruct` fixtures — no service, signatures, or transport. An exactly matching proposal
returns `null`; then each security-sensitive field is varied one test at a time — a tampered
balance amount, tampered balance data, a substituted participant, a different `channelId`, a
non-atomic open, non-empty opening `data`, a deadline in the past, and a deadline beyond the
allowed window — and each test asserts the specific mismatch reason string. A final test shows
participant/address comparison is checksum-canonical (casing-insensitive). What the negotiation
service does with the mismatch result (co-sign vs disconnect + blacklist + reset), lower-signature
recovery, and slot/state handling are out of scope. The
[`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf) permutations are now one field variation each, and the
per-field tests below are assigned to them. Still unassigned: the length variations (P4
participants, P6 balances) have no test; P2 (deadline at the expired edge) is probed one second
past the edge (`now - 1`, while the comparator rejects at `<= now`), so the exact boundary is not
demonstrated; and P3 (sort/alignment canonicalization) is not what the casing test shows.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                            | Covers                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`getOpenChannelProposalMismatch > accepts a proposal that matches the negotiated terms`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L45) (line 45)                | —                                                                                                                                                                                                                     |
| [`getOpenChannelProposalMismatch > rejects a tampered balance amount (no fund redirection)`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L55) (line 55)             | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P7`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p7)   |
| [`getOpenChannelProposalMismatch > rejects tampered balance data`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L63) (line 63)                                       | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P8`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p8)   |
| [`getOpenChannelProposalMismatch > rejects a different participant set`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L71) (line 71)                                 | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P5`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p5)   |
| [`getOpenChannelProposalMismatch > rejects a different channelId`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L79) (line 79)                                       | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P1`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p1)   |
| [`getOpenChannelProposalMismatch > rejects non-atomic opens`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L87) (line 87)                                            | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P9`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p9)   |
| [`getOpenChannelProposalMismatch > rejects arbitrary opening data`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L95) (line 95)                                      | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P10`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p10) |
| [`getOpenChannelProposalMismatch > rejects a deadline in the past`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L103) (line 103)                                    | —                                                                                                                                                                                                                     |
| [`getOpenChannelProposalMismatch > rejects a deadline beyond the allowed window`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L111) (line 111)                      | [`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P11`](../../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-negotiation-helpers-1-rwqazf.p11) |
| [`getOpenChannelProposalMismatch > matches participants and channelId irrespective of address casing`](../../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts#L119) (line 119) | —                                                                                                                                                                                                                     |
