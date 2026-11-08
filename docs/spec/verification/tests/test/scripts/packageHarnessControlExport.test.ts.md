# packageHarnessControlExport.test.ts

Test file: [test/scripts/packageHarnessControlExport.test.ts](../../../../../../test/scripts/packageHarnessControlExport.test.ts)

## Overview

The suite checks the `test-harness/control` package subpath through the package self-reference:
where it resolves, that its runtime exports are exactly the harness controls
(`HarnessControlRpc`, `withHarnessControl`, `RuntimeRpcControl`, `RootCreationControl`) and the
same values as the `test-harness` entry's, and, in a fresh node process each, whether the entry and
the `test-harness` entry load the peer harness (`PeerTestHarness`) and the test session
(`TestSession`). The control entry must load neither; the `test-harness` entry must load both,
which shows the probe sees them. The entry is test support outside `src/`, so no file report owns
a family for these cases.

## Tests

- `resolves the test-harness/control subpath to the built entry`: none
- `exports the harness controls, as the same values as the test-harness entry`: none
- `loads neither the peer harness nor a test session`: none
- `loads the peer harness and the test session through the test-harness entry`: none
