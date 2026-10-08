# SpectateServiceReplayBase.test.ts

Test file: [test/unit/SpectateServiceReplayBase.test.ts](../../../../../../test/unit/SpectateServiceReplayBase.test.ts)

## Overview

Exercises sync replay from the verified predecessor, including a compact proof with unavailable older coordinate history. The spectator is created and synced at genesis before the two initial blocks, so runtime startup cannot consume an active authoring window. The subsequent cutoff and final-block count preserve the equal-base and one-below-base premises.

## Tests

- `requester's latest height equals the served base height → it keeps its own state as the replay base and syncs to the tip`: REQ-SP-10-JMVHTB.T5.P17, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P89
- `requester's latest height one below the served base height → the base is installed, then the sync reaches the tip`: REQ-SP-10-JMVHTB.T5.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P90
