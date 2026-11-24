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

The default and derived success tests also return the proposal's genesis hash, the hash the genesis
hook derives for the signed terms and the hash the chain recorded; the lower-role tests check all three
are equal, the higher-role tests check the chain's against the derived one. Two genesis-failure tests
agree a peer balance of `MaxUint256`, which the real Math hook rejects on its checked sum, and check the
same whole result as the derivation failures ("Genesis unavailable" for the higher role). Two
altered-proposal tests send the higher role a proposal with a hash it never derived, or with the
counterparty balance changed to `MaxUint256`: both are refused, the proposer blacklisted and the attempt
cleared with no open; the balance case fails as a balance mismatch, so the term check runs before the
hook.

Two more late-settlement tests hold the old attempt's genesis hook call instead of its opening data
(the probe holds the manager's read-only call) and resolve it after the replacement started, with the
same oracle as the late derivation results. The foreign-open test plays a lower-address runtime whose
higher peer opens the derived channel ID first with a key of its own and a hash no genesis derives
from: the attempt ends `retry`, the peer is blacklisted, and the runtime is neither disposed nor holds
the opened fork.

`INV-NEG-1-6FW90P.T1.P1` (exact match co-signed) and `.P10` (locally derived non-empty data
accepted) are covered by the higher-role tests, where the runtime receives the proposal. No
specification permutation names the stale-attempt rule; it is covered only at the unit level.

## Tests

- `lower address proposes empty opening data by default and opens`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P1, UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P12, INV-NEG-1-6FW90P.T1.P16
- `higher address accepts empty opening data by default and opens`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P2, UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P13, INV-NEG-1-6FW90P.T1.P1
- `lower address derives opening data from the exact agreed terms`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P3
- `higher address derives opening data from the exact agreed terms`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P4, INV-NEG-1-6FW90P.T1.P10
- `the lower address whose genesis hook rejects the agreed balances clears the attempt without blacklisting the peer or proposing`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P16, INV-NEG-1-6FW90P.T1.P14
- `the higher address whose genesis hook rejects the agreed balances clears the attempt without blacklisting, co-signing or opening`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P17, INV-NEG-1-6FW90P.T1.P15
- `blacklists and clears a proposal whose genesis hash differs from the locally computed genesis`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P14, INV-NEG-1-6FW90P.T1.P12
- `blacklists a proposal whose altered counterparty balance the genesis hook would reject`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P15, INV-NEG-1-6FW90P.T1.P13
- `an ordinary attempt whose channel ID the peer opens with another participant set and a hash no genesis derives from retries and blacklists the peer without aborting`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P20, REQ-NEG-2-ED48TZ.T1.P8, REQ-LIF-12-TSXRBG.T1.P6
- `lower address derivation failure clears the attempt without a proposal or penalty`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P5
- `higher address derivation failure clears the attempt without co-signing or penalty`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P6
- `lower address late derivation result after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P7
- `lower address late derivation failure after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P8
- `higher address late derivation result after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P9
- `higher address late derivation failure after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P10
- `lower address late genesis hash after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P18
- `higher address late genesis hash after cancellation keeps the replacement attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P19
- `replacement opens without a signature or penalty from the cancelled attempt`: UNIT-TEST-OPEN-NEGOTIATION-SERVICE-2-KVTMDA.P11
