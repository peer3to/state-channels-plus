# E2E-QueueProofOrigins.test.ts — Test Report

> **Test file:** [test/e2e/E2E-QueueProofOrigins.test.ts](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Real sessions and domain objects exercise the public component or network boundary. The assertions check the state, counts, side effects and failure outcomes named below. Supporting fixtures trigger production methods; they do not replace protocol logic.

Peer 2 never signs, so the dispute posts auditing data and its state proof is one unfinal milestone run from block 0 that is fully replayed. The historical replay case observes entries at the dispute-validation boundary, checks that the replayed block hashes are exactly the blocks of that milestone, and checks origin, zero network sources and historical participants on each entry. Concurrent calldata is outside that observation.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                            | Covers                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Queue proof origins > historical dispute replay retains its full participant union after a signer is slashed`](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts#L4) (line 4) | [`REQ-GOSSIP-4-J5Z4DF.T1.P22`](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df.t1.p22) |
