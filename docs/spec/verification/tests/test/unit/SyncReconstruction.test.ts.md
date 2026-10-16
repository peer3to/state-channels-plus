# SyncReconstruction.test.ts

Test file: [test/unit/SyncReconstruction.test.ts](../../../../../../test/unit/SyncReconstruction.test.ts)

## Overview

Installs real sync responses and inspects reconstructed blocks, retained evidence, snapshots, states and proofs. Cases cover compact history, overlapping milestones, confirmation merging, unfinalized tails, and support kept out of history: forged blocks in earlier milestones, a forged branch between hops, support above the proven endpoint, and a poisoned payload followed by an honest one from another responder.

The separated-evidence fixture uses a 10-second `p2pTime` to allow spectator
setup before live authoring resumes. Agreement-time validation and the proof
assertions are unchanged; this fixture timing is not a protocol default.
Runtime verification of this timing adjustment is pending.

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
- `U82: a milestone whose threshold needs a signature on its later linked block → the support block is retained as evidence with that signature, outside the history, the gap block is never stored, the proof rebuilt through the support block proves that hop with it and verifies`: REQ-SP-10-JMVHTB.T5.P11, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P81
- `U82: verified support blocks are retained at once without their own replay → neither their resulting snapshot nor their state is stored`: REQ-SP-10-JMVHTB.T5.P12, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P82
- `U83: two occurrences of one block carry different signatures the threshold needs → stored merged, the tail replays, the proof rebuilt through that block proves it final on its own merged signatures and verifies`: REQ-SP-10-JMVHTB.T5.P13, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P83
- `U123: the second occurrence of the overlapping block carries other contents under the same height and author → not the same authenticated block: rejected, milestones invalid, nothing of the proof stored`: REQ-SP-7-70EMAT.T4.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P88
- `U84: a threshold hop above the anchor with no run back to it → accepted, the gap history is never stored, the rebuilt proof verifies from the anchor`: REQ-SP-10-JMVHTB.T5.P14, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P84
- `U85: a synced spectator follows two more final blocks → its rebuilt proof reaches the new head and verifies, the synced history and evidence are still held`: REQ-SP-10-JMVHTB.T5.P15, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P85
- `U85: the chain adopts a newer anchor after the sync and local progress → the rebuilt proof starts at it and needs none of the older evidence, which stays held`: REQ-SP-10-JMVHTB.T5.P16, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P86
- `U131: an earlier milestone holds a forged block at the height of a later hop → accepted, history holds the real hop block, the forged block is retained as evidence only`: REQ-SP-11-535J0R.T1.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P110, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P66
- `U132: a forged branch between two hops whose later hop's ancestry the proof does not hold → accepted, neither forged block enters history, both are retained as evidence`: REQ-SP-11-535J0R.T1.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P111, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P67
- `U133: an earlier milestone reaching above the proven endpoint → the head stays at the endpoint, the blocks above it are retained as evidence only and still rebuild the latest proof`: REQ-SP-11-535J0R.T1.P3, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P112, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P68
- `U134: a poisoned proof with forged support is applied, then an honest proof from another responder holding the real block there → both accepted, the honest responder is not blacklisted, history holds the real block`: REQ-SP-11-535J0R.T1.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P113
- `U136: a proof carrying as support a block already in history with another confirmation → the history block gains that signer, nothing is retained at its height`: REQ-SP-11-535J0R.T1.P14, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P69
- `U137: forged support signed by the real block's own author, then an honest proof whose tail replays the real block → the replay stops on the double sign, neither block becomes history, the forged one stays evidence`: REQ-SP-11-535J0R.T1.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P115
- `U138: a proof whose tail fails its replay after its final history is persisted → rejected, the final history stays and the head stays at the proven endpoint`: REQ-SP-11-535J0R.T1.P11, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P114
- `U139: support directly above the anchor block whose own signers are complete → no milestone is built from support alone, the rebuilt proof runs from the anchor block and verifies`: REQ-SP-11-535J0R.T1.P16, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P71
- `U140: retained support above a history block whose snapshot is missing → construction still throws the missing snapshot`: REQ-SP-11-535J0R.T1.P17, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P72
- `U141: blocks retained with a confirmation, then replayed into history without it → the rebuilt proof still counts the retained confirmation and proves the earlier block final`: REQ-SP-11-535J0R.T1.P15, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P70
