# E2E-BotConnectionFixes.test.ts

Test file: [test/e2e/E2E-BotConnectionFixes.test.ts](../../../../../../test/e2e/E2E-BotConnectionFixes.test.ts)

## Overview

Exercises founder discovery, leave completion, successor-fork synchronization, initial-peer eligibility and force-join timing across real peers and chain state.

The uninstalled-successor sync scenario delegates to the same staging owner as the component case.

The syncing-responder cases restart a participant whose own initial sync is held at its application step. One probes it from the other participant past a one-window timeout and checks the strike, both blacklists and the requester's state after the late answer. One fails the held sync in the same host step that lets a held raw request into the endpoint and checks the refusal message. A third probes a fresh runtime whose only handshake is a spectator and checks that the probe fails only after that runtime aborts at its initial-sync deadline.

## Tests

- `E23 (spectator): both lobby founders announce the opened channel and a later spectator discovers it and syncs from them`: REQ-TJOIN-3-DCZKS6.T2.P1, UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P7
- `E23 (joiner): a joiner discovers a lobby-opened channel through its founders and its join lands on chain`: REQ-TJOIN-3-DCZKS6.T2.P2, UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P8
- `E24: terminal leaves of both founders settle when their exits close the channel`: REQ-LIF-10-QR8NQ9.T3.P1, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P26
- `E25: founders whose exits wait on an unconsumed join do not report a posted snapshot; their self-removal disputes settle the leaves and seat the joiner`: REQ-LIF-10-QR8NQ9.T3.P2, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P27
- `E26: a latest-state sync request served by a responder whose installed state lags the chain-derived fork succeeds without blacklisting either side`: REQ-SYNC-1-T2589H.T3.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P91
- `H11 (adoption after the slashed handshake, mirror lagging): a fresh spectator skips a first-handshake peer its mirror still lists but the chain has slashed, then syncs from an honest participant after the successor adoption lands`: REQ-AUTH-5-BQG9AG.T3.P1, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P14
- `H11 (reduce landed, adoption failed): a fresh spectator whose first handshake is with a peer the chain snapshot still lists but the chain has slashed skips it and syncs from an honest participant`: REQ-AUTH-5-BQG9AG.T3.P2, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P15
- `H11 (same fork): a fresh spectator whose first handshake is with a slashed peer that reduced onto the same successor skips it and syncs from an honest participant`: REQ-AUTH-5-BQG9AG.T3.P3, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P16
- `H11 (not a member): a fresh spectator whose first handshake is with a synced spectator that is not slashed and not a member skips it and syncs from a participant`: REQ-AUTH-5-BQG9AG.T3.P4, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P17
- `H11 (responder still syncing): a fresh observer whose first chain-eligible handshake is a participant with its own initial sync in flight gets its answer once that sync succeeds and syncs from it`: REQ-SPC-3-AZBKR1.T1.P2, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P4
- `H11 (responder sync fails): a fresh observer whose first chain-eligible handshake is a participant with its own initial sync in flight aborts when that sync fails, adopting nothing`: REQ-SPC-3-AZBKR1.T1.P3, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P5
- `H11 (requester times out): a probe to a participant whose own initial sync is still in flight times out after one window with only a retry-tier close, neither side blacklists the other, and the late answer changes nothing on the requester`: UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P6
- `H11 (responder sync already failed): a spectate request that enters the endpoint after the responder's own initial sync failed is refused at once with the own-sync failure`: UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P7
- `H11 (no participant handshake): a probe to an opened runtime whose only handshake is a non-participant waits until that runtime's initial-sync deadline fires and is then refused with only a retry-tier close`: UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P8
- `E27: a joiner whose join no block includes, while writers produce no blocks, forces it by dispute once its time bound passes`: INV-TJOIN-2-H7JSQM.T3.P1, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P43
- `E28 (delayed observation): the force-join timeout window starts on observing the own join, without grace, while block counting waits agreementTime`: INV-TJOIN-2-H7JSQM.T3.P2, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P44
- `E28 (expired authorization): a pending joiner whose join never lands walks away once the join authorization expires`: REQ-LIF-10-QR8NQ9.T3.P3, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P28
- `E29: a fast table that authors the block bound inside the join's grace is not disputed; once counting starts the omitted join forces a dispute that seats the joiner`: INV-TJOIN-2-H7JSQM.T3.P3, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P45
