# E2E-BotConnectionFixes.test.ts

Test file: [test/e2e/E2E-BotConnectionFixes.test.ts](../../../../../../test/e2e/E2E-BotConnectionFixes.test.ts)

## Overview

Exercises founder discovery, leave completion, successor-fork synchronization, initial-peer eligibility and force-join timing across real peers and chain state.

The uninstalled-successor sync scenario delegates to the same staging owner as the component case.

The syncing-responder cases restart a participant whose own initial sync is held at its application step, so it stays OPENED. One probes it from the other participant and checks the raw still-syncing answer, that it came well within one window, and that the probe left no close, strike or blacklist and no state change. Three let a fresh observer reach only that participant and release the held sync as a success, as a failure, or only after the observer's connect settled; they check the observer's recorded sync results and targets, its re-ask, its abort or SYNCED status, and that the syncing participant is not cut. One restores the observer's pair with the other participant while the first request is held, then checks that the observer syncs from it at once, before the re-ask. A last one probes a fresh runtime whose only handshake is a spectator: the probe gets the still-syncing answer before that runtime aborts at its own initial-sync deadline.

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
- `H11 (responder still syncing): a fresh observer whose only chain-eligible handshake is a participant with its own initial sync in flight gets a still-syncing answer, keeps the connection, asks again after half a window and syncs from it once that sync succeeds`: REQ-SPC-3-AZBKR1.T1.P5, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P11, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P43
- `H11 (another participant serves): a fresh observer whose initial sync first asks a participant with its own initial sync in flight does not abort or cut that participant and syncs at once from another connected participant`: REQ-AUTH-5-BQG9AG.T3.P5, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P44
- `H11 (responder sync fails): a fresh observer whose only chain-eligible handshake is a participant with its own initial sync in flight gets a still-syncing answer and aborts once that sync fails, adopting nothing`: REQ-SPC-3-AZBKR1.T1.P6, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P46
- `H11 (no participant serves in time): a fresh observer whose only chain-eligible participant stays in its own initial sync aborts at its initial-sync deadline without cutting that participant, adopting nothing`: REQ-AUTH-5-BQG9AG.T3.P6, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P45
- `H11 (responder answers at once): a participant with its own initial sync in flight answers a spectate request at once that it is still syncing, and the requester's sync returns false with no close, strike or blacklist`: REQ-SPC-3-AZBKR1.T1.P4, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P9, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P115
- `H11 (no participant handshake): a probe to an opened runtime whose only handshake is a non-participant gets a still-syncing answer at once with no close or strike, and that runtime later aborts at its own initial-sync deadline`: UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P10
- `E27: a joiner whose join no block includes, while writers produce no blocks, forces it by dispute once its time bound passes`: INV-TJOIN-2-H7JSQM.T3.P1, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P43
- `E28 (delayed observation): the force-join timeout window starts on observing the own join, without grace, while block counting waits agreementTime`: INV-TJOIN-2-H7JSQM.T3.P2, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P44
- `E28 (expired authorization): a pending joiner whose join never lands walks away once the join authorization expires`: REQ-LIF-10-QR8NQ9.T3.P3, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P28
- `E29: a fast table that authors the block bound inside the join's grace is not disputed; once counting starts the omitted join forces a dispute that seats the joiner`: INV-TJOIN-2-H7JSQM.T3.P3, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P45
