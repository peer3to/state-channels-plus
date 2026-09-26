# E2E-QueueProofOrigins.test.ts — Test Report

> **Test file:** [test/e2e/E2E-QueueProofOrigins.test.ts](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Real sessions and domain objects exercise the public component or network boundary. The assertions check the state, counts, side effects and failure outcomes named below. Supporting fixtures trigger production methods; they do not replace protocol logic.

The historical replay case observes entries at the dispute-validation boundary, checks the exact set of replayed block hashes, and checks origin, zero network sources and historical participants on each entry. Concurrent calldata is outside that observation.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                            | Covers                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Queue proof origins > historical dispute replay retains its full participant union after a signer is slashed`](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts#L7) (line 7) | [`REQ-GOSSIP-4-J5Z4DF.T1.P22`](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df.t1.p22)                                                |
| [`E2E: Queue proof origins > malformed required evidence reaches the objective verifier and kills the dispute`](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts#L10) (line 10)     | [`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P16`](../../../../implementation/source/src/stateManager/ingest/README.md#integration-test-ingest-admission-1-ea0c8h.p16) |
