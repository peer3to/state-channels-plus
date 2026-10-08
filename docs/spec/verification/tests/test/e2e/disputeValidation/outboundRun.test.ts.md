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

## Tests

- `a committed dispute posts auditing data whose outbound run misses the block above the chain anchor -> an auditing remaining peer kills it with DisputeInvalidOutboundRun`: REQ-DIS-12-AXY60R.T1.P17
- `a committed dispute posts auditing data whose outbound block above the chain anchor (which holds the first leave's withdrawal) carries a message balance of MaxUint256 -> every auditing remaining peer's audit returns false without an error, a DisputeInvalidOutboundRun kill is accepted by the chain, and no event pipeline fails`: REQ-DIS-12-AXY60R.T1.P21
