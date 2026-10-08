# disputer.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/disputer.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputer.test.ts)

## Overview

A single upload-gate case for disputer identity: `postTamperedDispute` sets
`dispute.input.disputer = ZeroAddress`, so the claimed disputer no longer equals
`msg.sender`, and the harness asserts the upload reverts with the decoded custom error
`ErrorDisputerNotMsgSender`, whose arguments carry the claimed disputer and the actual
sender side by side. This pins the `disputer == msg.sender` binding of the upload
eligibility rules at the contract boundary; audit-side behavior is out of scope because the
dispute never lands on-chain. After the permutation atomization the case carries the
per-gate disputer-not-sender revert and the `REQ-DIS-2-PKVZ7E` wrong-identity split.

## Tests

- `dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P8, REQ-DIS-2-PKVZ7E.T1.P6
