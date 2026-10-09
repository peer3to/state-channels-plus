# AgreementManagerProofConstruction.test.ts

Test file: [test/unit/AgreementManagerProofConstruction.test.ts](../../../../../../test/unit/AgreementManagerProofConstruction.test.ts)

## Overview

Builds milestone proofs through AgreementManager using real blocks, membership changes and confirmation sets. Cases check final targets, overlapping support, pruning, consumed joiners and reconstruction after compact sync.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

## Tests

- `a threshold-final block an audit verified above the view → the final proof at its height proves it on chain; the view-bounded construction still ends at the view's final point`: REQ-SP-8-9ZCCEJ.T2.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P12
- `U22: backward construction finds the latest final point and appends the unfinalized tail to its milestone`: REQ-SP-8-9ZCCEJ.T2.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P13
- `U23: a later final starting block whose run overlaps the join milestone stays a separate last milestone`: REQ-SP-8-9ZCCEJ.T2.P3, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P14
- `D6: a hop whose JOIN is consumed and whose joiner exits within it, to the block after the exit → without the joiner's signature neither the SDK nor the walk proves it final; with it both do, and the SDK's set keeps that signature`: REQ-SP-3-SP1JG4.T3.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P31
- `D6 control: an ordinary join hop → the SDK's set is the previous and resulting participants (the joiner is resulting), and the proof is unchanged`: REQ-SP-3-SP1JG4.T3.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P32
- `U104: two joins → each join milestone is the minimum forward run proving its hop, the last milestone is found backward from the latest block`: REQ-SP-8-9ZCCEJ.T2.P4, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P15
- `U105: no later final point above the join milestone → the join milestone extends to the latest block, no second milestone at its start`: REQ-SP-8-9ZCCEJ.T2.P5, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P16
- `U103: block n+1 supplies the finality evidence of n → the proof ends at n+1 and its final point is n`: REQ-SP-8-9ZCCEJ.T2.P6, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P17
- `U24: a current local diamond → construction starts at its anchor, the chain anchor`: REQ-SP-8-9ZCCEJ.T2.P7, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P18
- `U24: a local diamond lagging a newer chain anchor → construction starts at the fork genesis, the chain walk still accepts the proof`: REQ-SP-8-9ZCCEJ.T2.P8, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P19
- `U25: a local finalized state ahead of the local diamond anchor → verification starts there, construction still starts at the anchor`: REQ-SP-8-9ZCCEJ.T2.P9, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P20
- `U93: verifying from local finalized height 3 while the mirror and chain hold anchor 1 → neither moves; construction still starts at anchor 1 and the chain accepts it`: REQ-SP-8-9ZCCEJ.T1.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P21
- `U101: successor fork while the chain anchor is on its ancestor → the empty proof starts at the successor genesis; every tier walks from that genesis`: REQ-SP-4-NCSEX4.T3.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P33
- `U101: successor fork while the chain anchor is on its ancestor → a genesis-linked unfinalized block 0 proof starts at the successor genesis; every tier walks from that genesis`: REQ-SP-4-NCSEX4.T3.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P34
- `U102: the ancestor fork's genesis data supplied for the successor fork → no tier establishes the successor genesis`: REQ-SP-4-NCSEX4.T3.P3, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P35
- `U102: the successor genesis data with a substituted origin fork → no tier establishes the successor genesis`: REQ-SP-4-NCSEX4.T3.P4, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P36
- `U97: a pruned required anchor-run block → construction throws; after the genuine blocks are restored a new attempt builds the proof`: REQ-SP-8-9ZCCEJ.T2.P10, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P22
- `U97: a pruned participant-change block above the anchor → construction throws instead of skipping the hop`: REQ-SP-8-9ZCCEJ.T2.P11, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P23
- `U97: the join hop's confirmation by a required signer is lost above the anchor → construction proves the block before the hop final and carries the hop in the unfinalized tail`: REQ-SP-8-9ZCCEJ.T2.P12, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P24
- `U97: the pruned snapshot of a join block above the anchor → construction throws instead of skipping the hop`: REQ-SP-8-9ZCCEJ.T2.P13, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P25
- `U117: history pruned below the observed anchor, a join hop and virtual-voting evidence above it → the latest proof, the anchor proof and the replay state all remain`: REQ-SP-10-JMVHTB.T1.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P7
- `U117: a spectator synced at the anchor as its latest finalized state → the anchor block, snapshot and full state are stored and its anchor proof verifies`: REQ-SP-10-JMVHTB.T1.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P8
- `U117: a spectator synced from a proof with a join hop and virtual-voting evidence above the anchor holds no history below the join → its latest proof rebuilds from the anchor, verifies, and its replay state is held`: REQ-SP-10-JMVHTB.T1.P3, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P9
- `U98: dispute construction over a pruned required block → dispute() rejects and no dispute reaches the chain`: REQ-SP-8-9ZCCEJ.T2.P14, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P26
- `U98: sync serving over a pruned required block → generateSyncPayload rejects instead of serving a shorter proof`: REQ-SP-8-9ZCCEJ.T2.P15, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P27
- `U98: snapshot posting over a pruned participant-change block above the anchor → the post rejects with the missing-block error, no transaction is sent and the chain snapshot stays`: REQ-SP-8-9ZCCEJ.T2.P16, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P28
- `U98 (control): snapshot posting with every required block held → the update is sent and the chain adopts the last milestone's first block`: REQ-SP-8-9ZCCEJ.T2.P17, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P29
- `U98: snapshot posting whose proof construction fails on its chain walk → the post rejects and the chain snapshot stays`: REQ-SP-8-9ZCCEJ.T2.P18, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P30
- `FR1: an exact final proof keeps later virtual votes and rejects the unfinalized support height`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P59
- `TO1: exact join finality retains the later union vote and disappears when that sole vote is removed`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P62
- `TO1: exact exit finality retains the old and new union and needs its sole later confirmation`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P63
- `TO1: an exact join point above the frozen view keeps later audit votes without advancing the view`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P64
- `TO1: an exact point after an earlier join builds both overlapping hops above the frozen view`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P65
