# outboundRun.test.ts

Test file: [test/e2e/disputeValidation/outboundRun.test.ts](../../../../../../../test/e2e/disputeValidation/outboundRun.test.ts)

## Overview

On `stageOutboundAroundAnchor` history the disputer (self-removal as its reason) uploads a dispute whose posted
auditing data drops the one outbound block above the chain anchor, with the hash recommitted. The oracle waits
for the chain's `DisputeKilled` event for that disputer, then decodes the kill transaction: its killer is a
remaining peer and its applied proofs are exactly `[DisputeInvalidOutboundRun]`. The window then resolves with the
other remaining peer honest, and the held exit post is released so every node settles.

The second case posts the one block above the anchor with its first message balance set to `MaxUint256`,
with the hash recommitted. The kill oracle is the same (`[DisputeInvalidOutboundRun]` by a remaining
peer). After the window resolves, each remaining peer's dispute mutex goes idle and its event pipeline
reports no failed block and no disposal, so no audit of the forged run failed.

The third case has the disputer sign a new last block above its head that commits a forged latest
snapshot. That snapshot's outbound head is the block above the anchor with its first message balance
set to `MaxUint256`, so the links and the height hold and only the sum overflows. The kill comes from a
remaining peer with exactly `[DisputeInvalidBlockInStateProofApplyFraudProof]`: the replay counters the
forged latest state before the run is judged. After the window resolves, each remaining peer's event
pipeline reports no failed block and no disposal.

## Tests

- `a committed dispute posts auditing data whose outbound run misses the block above the chain anchor -> an auditing participant kills it with DisputeInvalidOutboundRun`: REQ-DIS-12-AXY60R.T1.P17
- `a committed dispute posts auditing data whose outbound block above the chain anchor (which holds the first leave's withdrawal) carries a message balance of MaxUint256 -> every auditing remaining peer's audit returns false without an error, a DisputeInvalidOutboundRun kill is accepted by the chain, and no event pipeline fails`: REQ-DIS-12-AXY60R.T1.P21
- `the disputer signs a last block above its head that commits a forged latest snapshot whose outbound head is an overflowing block (message balance MaxUint256) right above the chain anchor -> the replay rejects the forged latest state before the outbound run is judged: a DisputeInvalidBlockInStateProofApplyFraudProof kill is accepted by the chain and no event pipeline fails`: REQ-DIS-12-AXY60R.T1.P24
