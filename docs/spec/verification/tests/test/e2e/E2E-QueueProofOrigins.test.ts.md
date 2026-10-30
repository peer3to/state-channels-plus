# E2E-QueueProofOrigins.test.ts

Test file: [test/e2e/E2E-QueueProofOrigins.test.ts](../../../../../../test/e2e/E2E-QueueProofOrigins.test.ts)

## Overview

Real sessions and domain objects exercise the public component or network boundary. The assertions check the state, counts, side effects and failure outcomes named below. Supporting fixtures trigger production methods; they do not replace protocol logic.

The historical replay case observes entries at the dispute-validation boundary, checks the exact set of replayed block hashes, and checks origin, zero network sources and historical participants on each entry. Concurrent calldata is outside that observation.

## Tests

- `historical dispute replay retains its full participant union after a signer is slashed`: REQ-GOSSIP-4-J5Z4DF.T1.P22
- `malformed required evidence reaches the objective verifier and kills the dispute`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P16
