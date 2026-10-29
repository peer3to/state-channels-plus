# OpenChannelProposal.test.ts

Test file: [test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts](../../../../../../../test/rpc/openChannelNegotiation/OpenChannelProposal.test.ts)
Exercises: [OpenChannelNegotiationHelpers.ts](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md)

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
`UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF` permutations are now one field variation each, and the
per-field tests below are assigned to them. Still unassigned: the length variations (P4
participants, P6 balances) have no test; P2 (deadline at the expired edge) is probed one second
past the edge (`now - 1`), and the comparator now rejects everything below the 30-second minimum,
so the expired edge is not a boundary any more; and P3 (sort/alignment canonicalization) is not what the casing test shows.

## Tests

- `accepts a proposal that matches the negotiated terms`: none
- `rejects a tampered balance amount (no fund redirection)`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P7
- `rejects tampered balance data`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P8
- `rejects a different participant set`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P5
- `rejects a different channelId`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P1
- `rejects non-atomic opens`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P9
- `rejects opening data that differs from the locally derived data`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P10
- `rejects a deadline in the past`: none
- `rejects a deadline one second ahead as too close`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P13
- `rejects a deadline 29 seconds ahead as too close`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P14
- `accepts a deadline exactly 30 seconds ahead`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P15
- `rejects a deadline beyond the allowed window`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P11
- `matches participants and channelId irrespective of address casing`: none
- `accepts the locally derived application opening data`: UNIT-TEST-OPEN-NEGOTIATION-HELPERS-1-RWQAZF.P12
