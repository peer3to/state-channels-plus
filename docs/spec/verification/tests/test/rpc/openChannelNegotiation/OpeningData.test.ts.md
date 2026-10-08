# OpeningData.test.ts

Test file: [test/rpc/openChannelNegotiation/OpeningData.test.ts](../../../../../../../test/rpc/openChannelNegotiation/OpeningData.test.ts)
Exercises: [OpenChannelNegotiationService.ts](../../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md)

## Overview

Each test starts one runtime with a custom RPC root and drives it through a worker-side probe.
The probe registers a peer wallet on the chosen side of the address order, commits an ordinary
matched negotiation with balances 321 (local) and 700 (peer), and plays the peer's side of the
term exchange and proposal by hand: as the higher peer it answers the local proposal and submits
the open; as the lower peer it sends a signed proposal the local runtime must co-sign and submit.
The `default` source uses the SDK's base service (empty opening data); the `derived` source uses a
root service whose `buildOpeningData` ABI-encodes the agreed channel ID, participants and
balances, records every call, and can fail or hold a call.

The default and derived tests check the recorded hook calls (none for the base service, exactly
the agreed terms in address order for the root), the proposal data, the `opened` outcome, and the
chain-open state. The failure tests fail the hook and check the whole result: thrown error (none
for the lower role, "Opening data unavailable" for the higher), `retry` outcome, attempt and
selected channel ID cleared, no proposal frame, no open, and no blacklist, strike or close. The
late-settlement tests hold the hook, cancel the attempt with `dispose` (outcome `cancelled`),
start a replacement with a new peer, then resolve or reject the held call; they check that the
replacement is still the current attempt with its channel selection, deadline handle and pending
outcome, that the old attempt produced no proposal and no open (and, for the higher role, what its
pending proposal returned), and that the replacement then opens. The last test adds the chain
participant set of the replacement and the old peer's blacklist, strikes and transport state.

`INV-NEG-1-6FW90P.T1.P1` (exact match co-signed) and `.P10` (locally derived non-empty data
accepted) are covered by the higher-role tests, where the runtime receives the proposal. No
specification permutation names the stale-attempt rule; it is covered only at the unit level.

## Tests

- `lower address proposes empty opening data by default and opens`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P1
- `higher address accepts empty opening data by default and opens`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P2, INV-NEG-1-6FW90P.T1.P1
- `lower address derives opening data from the exact agreed terms`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P3
- `higher address derives opening data from the exact agreed terms`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P4, INV-NEG-1-6FW90P.T1.P10
- `lower address derivation failure clears the attempt without a proposal or penalty`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P5
- `higher address derivation failure clears the attempt without co-signing or penalty`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P6
- `lower address late derivation result after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P7
- `lower address late derivation failure after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P8
- `higher address late derivation result after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P9
- `higher address late derivation failure after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P10
- `replacement opens without a signature or penalty from the cancelled attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P11
