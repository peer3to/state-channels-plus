# E2E-TargetedChannelJoin.test.ts

Test file: [test/e2e/E2E-TargetedChannelJoin.test.ts](../../../../../../test/e2e/E2E-TargetedChannelJoin.test.ts)
Exercises: [targeted-channel-join.md](../../../../specification/peer-communication/targeted-channel-join.md)

## Overview

The suite contains 31 direct literal cases. It drives unopened preflight, targeted matching, opening,
authoritative-open handoff, exact-channel sync, requested membership, cancellation, matcher-only timeout,
explicit retry, caller-owned initial synchronization failure, transport preservation, and host-local policy.
Every full connect reaches its production success, failure, or disposal boundary before detached settlement.

Each initial-sync failure case maps to its own failure angle (selected-peer disconnect, invalid response,
requester expiry, observed-open failure); the broad fatal-disposal permutation stays with the component
suite that also proves the root closes. The sync-timeout case has the same body as the sync-silence case, so
only the silence case carries the no-fallback permutation. The explicit same-ID retry case repeats the
component suite's retry case through the same public API and carries no ID.

## Coverage

| Test group | Specification coverage |
| Option and result cases 1–10 | `REQ-TJOIN-1-5VGR1F`, `REQ-TJOIN-2-MFWADG` |
| Open-race, timeout, and cancellation cases 11–21 | `REQ-TJOIN-3-DCZKS6`, `REQ-TJOIN-4-SDPZJW` |
| Retry, deferral, failure phase, handoff, and policy cases 22–31 | `REQ-TJOIN-5-Q795M7`, `INV-TJOIN-1-R3K75D` |

## Tests

- `unopened target without autoOpen and without balance returns false without discovery`: REQ-TJOIN-1-5VGR1F.T1.P7
- `rejects a second target without changing the selected channel`: REQ-TJOIN-6-0HEVYH.T1.P2
- `terminal leave settles before a fresh runtime connects another channel`: REQ-TJOIN-7-NNGTAY.T1.P8, REQ-LIF-10-QR8NQ9.T1.P4
- `unopened target without autoOpen and with balance returns false without discovery`: REQ-TJOIN-1-5VGR1F.T1.P5
- `initial observer sync accepts one valid response without probing another peer`: REQ-TJOIN-3-DCZKS6.T1.P1
- `initial observer sync silence aborts without probing another ready peer`: REQ-TJOIN-3-DCZKS6.T1.P2
- `initial observer sync disconnect aborts without probing another ready peer`: REQ-TJOIN-5-Q795M7.T1.P7
- `initial observer sync timeout aborts without probing another ready peer`: none
- `initial observer sync invalid response aborts without probing another ready peer`: REQ-TJOIN-5-Q795M7.T1.P8
- `already-open join preserves a supplied full balance and internal deadline`: REQ-TJOIN-1-5VGR1F.T1.P4
- `already-open join uses the default balance and internal deadline`: REQ-TJOIN-1-5VGR1F.T1.P3
- `four targeted callers converge on one opened channel`: INV-TJOIN-1-R3K75D.T1.P2
- `target open at the post-match recheck skips negotiation initialization`: INV-TJOIN-1-R3K75D.T1.P3
- `targeted observed-open handoff syncs only from the selected channel`: REQ-TJOIN-5-Q795M7.T1.P3
- `targeted observed-open participation waits for selected-channel sync`: REQ-TJOIN-3-DCZKS6.T1.P9
- `targeted observed-open participant failure aborts without retry`: REQ-TJOIN-5-Q795M7.T1.P10
- `matchmaking timeout stops only an unmatched rendezvous`: REQ-TJOIN-2-MFWADG.T1.P2
- `accepted match is irrevocable past matchmaking timeout`: REQ-TJOIN-2-MFWADG.T1.P3
- `already-open discovery ignores finite and null matchmaking timeouts`: REQ-TJOIN-1-5VGR1F.T1.P1
- `finite matchmaking timeout does not settle a first-join receipt`: REQ-TJOIN-3-DCZKS6.T1.P10
- `finite matchmaking timeout does not settle a top-up receipt`: REQ-TJOIN-3-DCZKS6.T1.P11
- `pre-sync refusal returns false without starting sync`: REQ-TJOIN-5-Q795M7.T1.P12
- `matching cancellation settles false only before acceptance`: REQ-TJOIN-1-5VGR1F.T1.P6
- `preserves the target listener after unsigned targeted negotiation failure`: REQ-TJOIN-5-Q795M7.T1.P1
- `starts a fresh same-ID targeted attempt only after another explicit call`: none
- `initial sync accepts a response in the second agreement window`: REQ-TJOIN-3-DCZKS6.T1.P12
- `initial requester expiry aborts and disposes without retry`: REQ-TJOIN-5-Q795M7.T1.P9
- `accepted pending join result does not wait for later inclusion`: REQ-TJOIN-3-DCZKS6.T1.P3
- `pending runtime survives later operational failure`: REQ-TJOIN-5-Q795M7.T1.P5
- `participating runtime survives later operational failure`: REQ-TJOIN-5-Q795M7.T1.P6
- `preserves the successful matched-opening transport for the first channel sync`: REQ-TJOIN-2-MFWADG.T1.P6
- `manifest-loaded local policy blocks targeted matching without a worker policy payload`: REQ-TJOIN-2-MFWADG.T1.P7
