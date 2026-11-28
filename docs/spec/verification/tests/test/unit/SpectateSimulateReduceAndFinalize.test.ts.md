# SpectateSimulateReduceAndFinalize.test.ts

Test file: [test/unit/SpectateSimulateReduceAndFinalize.test.ts](../../../../../../test/unit/SpectateSimulateReduceAndFinalize.test.ts)
Exercises: [SpectateService.ts](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md)

## Overview

Seven cases drive participant 2's real `simulateReduceAndFinalize`, an `eth_call` of the chain's
`reduceAndFinalize`. Each teleports a session to a reducible disputed fork whose reduce applies a
top-up of peer 0, with every peer's reduction tasks held, and fetches peer 0's sync payload for it;
the premise check reads the chain window as unreduced. A harness endpoint decodes the payload's
window and passes its disputes, snapshot, encoded state, inbound list and claimed reduced fork to
the method.

With the served inputs on the expired window the call returns true and the chain window stays
unreduced, since an `eth_call` commits nothing. After peer 0 reduces the window on chain, a call
expecting that fork returns false, and a call expecting another fork throws
`RaceConditionReductionExpectationDoesntMatch` while the chain keeps its fork. Disputes that name a
fork or a channel with no dispute window return false, which is why sync checks the disputes'
window before the call. An inbound list with an extra fabricated successor throws
`ErrorDisputeInboundMessageBlocksInvalid`. A window still in its kill period throws
`RaceConditionDisputeKillPeriodNotExpired`.

The call runs the chain's own reduction, so the first three cases are also the commitment-exact
reduction evidence: the window's committed dispute set reduces to the claimed fork, a matching
re-finalize is an idempotent no-op, and a mismatched expectation is rejected without replacing the
committed result.

## Tests

- `expired unreduced window with its served inputs → true, the chain window stays unreduced`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P1, INV-ENFDIS-1-1K65DT.T1.P1
- `window the chain reduced to the expected fork → false`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P2, INV-ENFDIS-1-1K65DT.T1.P4
- `window the chain reduced to another fork than expected → throws the expectation mismatch, the chain keeps its fork`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P3, INV-ENFDIS-1-1K65DT.T1.P7
- `disputes naming a fork without a dispute window → false, the chain window stays unreduced`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P4
- `disputes naming a channel without a dispute window → false, the chain window stays unreduced`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P5
- `inbound list with a fabricated successor → throws the inbound validation revert`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P6
- `unreduced window in its kill period → throws the kill period revert, the chain window stays unreduced`: UNIT-TEST-SPECTATE-SERVICE-3-2QP6RF.P7
