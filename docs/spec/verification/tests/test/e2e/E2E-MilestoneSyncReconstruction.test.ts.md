# E2E-MilestoneSyncReconstruction.test.ts

Test file: [test/e2e/E2E-MilestoneSyncReconstruction.test.ts](../../../../../../test/e2e/E2E-MilestoneSyncReconstruction.test.ts)

## Overview

Synchronizes real peers from compact and overlapping milestone proofs. Checks persisted final state, rebuilt proof validity, replay progress, stale response rejection and honest-source retention after compact sync.

The E37 pruned-history case keeps the participants authoring while it prunes below the fixed chain anchor and verifies reconstruction. The exact pruning, anchor-start, served-payload, later snapshot, and constructed-dispute assertions remain intact; observer setup no longer resumes a writer window idled by proof checks.

The shared E37 fixture also continues ordinary authoring while the snapshot publication reaches every mirror, then explicitly finalizes a block after publication. The earlier participating-to-progressed two-block assertion and reconstructed-anchor assertions remain unchanged.

## Tests

- `E01: a participant that missed the unfinalized genesis-linked block-0 run syncs it, replays block 0 from genesis and authors the next block`: REQ-SP-10-JMVHTB.T4.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P62
- `E03: a later joiner that synced past a finalized join reconstructs the join hop and constructs a dispute the chain verifies`: REQ-SP-10-JMVHTB.T4.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P46
- `E04: a peer synced across a departure and a join serves its reconstructed proof to a participant and posts a snapshot through the union hops`: REQ-SP-10-JMVHTB.T4.P3, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P47
- `E05: participant changes inside an unfinalized tail stay in the last milestone and a sync-only observer replays them`: REQ-SP-10-JMVHTB.T4.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P63
- `E06: a builder whose mirror lags a newer chain anchor builds a larger proof from the genesis that the chain and a peer accept, and rebuilds from the anchor once the mirror catches up`: REQ-SP-8-9ZCCEJ.T3.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P48
- `E07: a lagging spectator accepts a proof that starts below its final point, keeps its own state and replays the newer tail without blacklisting`: REQ-SP-9-RNXP56.T4.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P64
- `E08: a spectator blacklists a responder whose valid proof ends below its finalized point and keeps its state`: REQ-SP-9-RNXP56.T4.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P65
- `E08 (honest lagging responder): a spectator blacklists an honest isolated spectator whose own valid proof ends below the requester's finalized point`: REQ-SP-9-RNXP56.T4.P3, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P66
- `E08 (honest restarted responder): a spectator blacklists an honest spectator that restarted, came back older than the requester's finalized point and serves its own valid proof; the requester keeps its newer state`: REQ-SP-9-RNXP56.T4.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P67
- `E09: the chain anchor moves into a received proof's range before the receiver verifies it; the sync-only observer persists from that anchor (the anchor block included) and a fresh spectator syncs from its reconstructed proof`: REQ-SP-10-JMVHTB.T4.P5, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P68
- `E30: a spectator synced after an unposted leave keeps the departure hop and reconstructs chain-valid proofs before and after progress and after adopting the exit snapshot`: REQ-SP-10-JMVHTB.T4.P6, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P49
- `E30 (pruned): after adopting the exit snapshot the synced spectator prunes history below it and still reconstructs, serves, posts a snapshot and constructs a dispute the chain verifies`: REQ-SP-10-JMVHTB.T4.P7, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P50
- `E31: a sync-only observer stores only the separated milestone runs whose virtual-voting evidence spans several blocks, and constructs a dispute the chain verifies without the gap history`: REQ-SP-10-JMVHTB.T4.P8, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P51
- `E31 (overlapping proof): the chain verifies an overlapping compact proof; a sync-only observer persists each shared block once with its evidence, stores no gap history, and reconstructs a proof and dispute the chain verifies`: REQ-SP-10-JMVHTB.T4.P9, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P52
- `a spectator first served an older valid answer, then a future gossip block: the queue-timeout probe installs a compact proof above that block, keeps every honest source, and the spectator follows later blocks`: REQ-BLOCK-PIPE-4-CF52J6.T2.P1, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P41
- `E34 (valid repeated tail): a tail block that also supports the earlier change hop is still replayed and its state reaches the observer`: REQ-SP-10-JMVHTB.T4.P10, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P69
- `E34 (invalid repeated tail): a forged transition in a tail block that also supports the change hop is replayed, not pre-stored, and stops a fresh spectator`: REQ-SP-10-JMVHTB.T4.P11, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P70
- `E37: a spectator reconstructs chain-valid proofs when synced, pending, participating, after progress and after the anchor moves`: REQ-SP-10-JMVHTB.T4.P12, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P53
- `E37 (pruned): after the anchor moves the participant prunes history below it and still reconstructs, serves, posts a snapshot and constructs a dispute the chain verifies`: REQ-SP-10-JMVHTB.T4.P13, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P54
- `E39: before the chain adopts the successor the proof starts at the successor genesis, a fresh spectator syncs and rebuilds it, and after adoption reconstruction starts at the successor anchor`: REQ-SP-8-9ZCCEJ.T3.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P55

The restarted-responder case keeps ordinary participant authoring active during runtime disposal and recreation, excluding only the unavailable runtime from harness queries until it is recreated. Its later partition, honest older proof, finalized-state rejection and unchanged requester-state assertions remain.
