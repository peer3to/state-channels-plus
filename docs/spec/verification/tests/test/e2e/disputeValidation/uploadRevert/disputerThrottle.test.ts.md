# disputerThrottle.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts)

## Overview

Three cases around the per-address upload throttle, driven with junk-fork self-removal
disputes so each `postDispute` opens (or joins) a window without needing a real fault. The
first shows enforcement: two window-opening uploads from the same disputer within
`evidenceTime`, where the second reverts with the decoded custom error
`ErrorDisputeThrottled` — whose arguments name the throttled disputer and show the recorded
expiry still ahead of the block timestamp. The second shows the bound is temporal: after sleeping past
`evidenceTime`, the same disputer's next upload succeeds. The third pins the join branch: a
disputer already throttled by opening window B must also be blocked when posting into another
peer's open window A (the pre-fix behavior skipped the throttle check on that branch).
Throttle interaction with real dispute content, the one-post-per-window rule, and eligibility
gating are out of scope. The facet's throttle-boundary permutation
(`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P6`) needs both the enforced and the expired side of the
boundary, which no single test here shows alone, so it stays unassigned.

## Tests

- `second postDispute from same disputer within evidenceTime → dispute upload fails → ErrorDisputeThrottled`: REQ-ENFDIS-2-VV9FPR.T1.P1
- `second postDispute from same disputer after evidenceTime → dispute upload succeeds`: none
- `postDispute reuses dispute.input.forkId from another peer's open window within evidenceTime → dispute upload fails → ErrorDisputeThrottled`: none
