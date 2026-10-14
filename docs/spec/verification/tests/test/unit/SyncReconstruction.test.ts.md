# SyncReconstruction.test.ts

Test file: [test/unit/SyncReconstruction.test.ts](../../../../../../test/unit/SyncReconstruction.test.ts)

## Overview

Installs real sync responses and inspects reconstructed blocks, snapshots, states and proofs. Cases cover compact history, overlapping milestones, confirmation merging and unfinalized tails.

The separated-evidence fixture uses a 10-second `p2pTime` to allow spectator
setup before live authoring resumes. Agreement-time validation and the proof
assertions are unchanged; this fixture timing is not a protocol default.
Runtime verification of this timing adjustment is pending.

The first two genesis-index cases run on three participants after one final block, and a
record-only stub counts the requester's genesis refusal warnings across its applies. In the first, peer 0's payload
is rewritten to prove block 0, one second after the genesis, committing the genesis data at its
timestamp, re-signed by its author and both confirmers, with the genesis state as the finalized
state; a fresh requester with no genesis of its own (checked before the apply) accepts it and
installs that result as its replay base. It stores the result by hash, its genesis index holds the
served genesis and no refusal is logged. In the second, a fresh requester applies peer 0's real
payload twice: both applies are accepted, the served genesis stays registered and no refusal is
logged.

The third genesis-index case opens a channel of three participants with no block, with every
participant's timeout check suppressed. Peer 0's real payload for the latest state (no pinned
height) is the empty proof, and its genesis equals the chain's on-chain genesis; the test moves
that genesis one second later and nothing else. A fresh requester applies it: the sync is
rejected as `genesis snapshot invalid`, peer 0 is blacklisted, the requester registers no
genesis for the fork, the shifted genesis is not stored by hash and no refusal is logged.

The fourth and fifth genesis-index cases open a channel of three participants with no block and
suppress every timeout check. One peer that does not write block 0 (never peer 0) is cut off and
the other two do not post on chain, so block 0 stays unfinal and peer 0's payload is the genesis
run [0], served from the genesis state, with the chain's genesis. In the fourth, that genesis is
moved one second later: the sync is rejected as `genesis snapshot invalid`, peer 0 is
blacklisted, no genesis is registered, the shifted genesis and block 0 are not stored and no
refusal is logged. In the fifth, the honest payload is accepted with head 0, block 0 is stored
with peer 0's hash, the chain's genesis is registered, peer 0 is not blacklisted and no refusal
is logged.

## Tests

- `U54/U56: a proof from the anchor reaching the receiver's own finalized head → accepted again without installing its state again or re-running a block, stored blocks, signers and state unchanged`: REQ-SP-10-JMVHTB.T5.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P71
- `U54/U56: a proof from the anchor reaching past the receiver's finalized head → accepted, the newer state installed and blocks persisted, the earlier blocks and signers unchanged`: REQ-SP-10-JMVHTB.T5.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P72
- `U56/E08: an honest responder's valid proof ending below the receiver's finalized state → rejected, proof ends below the finalized state, responder blacklisted, receiver head unchanged`: INV-SYNC-2-AT3RXE.T2.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P87
- `U55: a receiver holding the anchor state is served an earlier genuine state with the run through the tip → its own state replays the run, accepted, not blacklisted`: REQ-SP-10-JMVHTB.T5.P3, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P73
- `U57: a run served from an older anchor while the chain anchor moved into it → accepted, the material from the new anchor on is kept, the rebuilt proof starts at the new anchor and verifies on chain`: REQ-SP-10-JMVHTB.T5.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P74
- `U58: a proof carrying a finalized participant change above the construction anchor → the change point is stored and the rebuilt proof proves that hop and verifies on chain`: REQ-SP-10-JMVHTB.T5.P5, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P75
- `U59: a second proof verified from the receiver's local finalized state, ahead of the chain anchor → the rebuilt proof still starts at the local diamond anchor and verifies on chain`: REQ-SP-10-JMVHTB.T5.P6, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P76
- `U60: already-known verified data applied again, then a proof adding later data → the view is kept without a state install or block re-run, then the additions persist without changing earlier blocks or signers`: REQ-SP-10-JMVHTB.T5.P7, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P77
- `U61: a valid unfinal replay tail at the spectating entry → its blocks, snapshots and states persist and the view advances to the tail end`: REQ-SP-10-JMVHTB.T5.P8, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P78
- `U81: a milestone wholly below the anchor whose snapshot drops a participant → accepted, its block, snapshot and change point are not stored, the rebuilt proof verifies from the anchor`: REQ-SP-10-JMVHTB.T5.P9, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P79
- `U81: a forged block before the anchor inside the run holding the anchor, its snapshot dropping a participant → accepted from the anchor, its block, snapshot and change point are not stored, the rebuilt proof verifies`: REQ-SP-10-JMVHTB.T5.P10, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P80
- `U82: a milestone whose threshold needs a signature on its later linked block → the support block keeps that signature, the gap block is never stored, the proof rebuilt through the support block proves that hop with it and verifies`: REQ-SP-10-JMVHTB.T5.P11, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P81
- `U82: verified support blocks are stored at once without their own replay → neither their resulting snapshot nor their state is stored`: REQ-SP-10-JMVHTB.T5.P12, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P82
- `U83: two occurrences of one block carry different signatures the threshold needs → stored merged, the tail replays, the proof rebuilt through that block proves it final on its own merged signatures and verifies`: REQ-SP-10-JMVHTB.T5.P13, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P83
- `U123: the second occurrence of the overlapping block carries other contents under the same height and author → not the same authenticated block: rejected, milestones invalid, nothing of the proof stored`: REQ-SP-7-70EMAT.T4.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P88
- `U84: a threshold hop above the anchor with no run back to it → accepted, the gap history is never stored, the rebuilt proof verifies from the anchor`: REQ-SP-10-JMVHTB.T5.P14, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P84
- `U85: a synced spectator follows two more final blocks → its rebuilt proof reaches the new head and verifies, the synced evidence is still stored`: REQ-SP-10-JMVHTB.T5.P15, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P85
- `U85: the chain adopts a newer anchor after the sync and local progress → the rebuilt proof starts at it and needs none of the older evidence, which stays stored`: REQ-SP-10-JMVHTB.T5.P16, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P86
- `a proof finalizing a block 0 that changes no state → accepted, its result stored by hash, the served fork genesis is the registered genesis and no refusal is logged`: REQ-SNAPSTORE-1-AJW0HJ.T2.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P66
- `the same served sync response applied twice → the served fork genesis stays registered and no refusal is logged`: REQ-SNAPSTORE-1-AJW0HJ.T2.P3, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P110
- `a fork with no block served with its genesis one second later than the chain's → rejected as an invalid genesis, responder blacklisted, no genesis registered or stored and no refusal logged`: INV-SYNC-1-XCQZ28.T1.P12, REQ-SNAPSTORE-1-AJW0HJ.T2.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P111
- `an unfinal block 0 served with its fork genesis one second later than the chain's → rejected as an invalid genesis, responder blacklisted, no genesis registered or stored and block 0 not stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P113
- `an unfinal block 0 served with the chain's fork genesis → accepted, block 0 replayed from the genesis, the chain's genesis registered and no refusal logged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P114
