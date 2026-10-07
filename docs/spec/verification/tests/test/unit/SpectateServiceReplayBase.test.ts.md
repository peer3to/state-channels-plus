# SpectateServiceReplayBase.test.ts — Test report

> **Test file:** [test/unit/SpectateServiceReplayBase.test.ts](../../../../../../test/unit/SpectateServiceReplayBase.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Exercises sync replay from the verified predecessor, including a compact proof with unavailable older coordinate history. The spectator is created and synced at genesis before the two initial blocks, so runtime startup cannot consume an active authoring window. The subsequent cutoff and final-block count preserve the equal-base and one-below-base premises.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: SpectateService replay base > requester's latest height equals the served base height → it keeps its own state as the replay base and syncs to the tip`](../../../../../../test/unit/SpectateServiceReplayBase.test.ts#L16) (line 16) | [`REQ-SP-10-JMVHTB.T5.P17`](../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb.t5.p17), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P89`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p89) |
| [`Unit: SpectateService replay base > requester's latest height one below the served base height → the base is installed, then the sync reaches the tip`](../../../../../../test/unit/SpectateServiceReplayBase.test.ts#L61) (line 61)        | [`REQ-SP-10-JMVHTB.T5.P18`](../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb.t5.p18), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P90`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p90) |
