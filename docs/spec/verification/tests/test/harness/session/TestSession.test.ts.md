# TestSession.test.ts

Test file: [test/harness/session/TestSession.test.ts](../../../../../../../test/harness/session/TestSession.test.ts)

## Overview

The tests prove explicit host/orchestrator settlement, ordered detached-error retention, and isolation of one
claimed expected error from an unrelated later rejection. Teardown remains a leak detector and does not cancel,
dispose, or otherwise finish production feature work.

These are harness self-tests of detached settlement; they exercise no connect failure phase, so they assign
no permutation. The related requirement is `REQ-TJOIN-5-Q795M7`.

## Tests

- `retains detached errors in arrival order`: none
- `claiming one expected detached error preserves unrelated failures`: none
- `explicit settlement drains host and orchestrator work without terminating it`: none
- `teardown leak check fails on unresolved work without cancelling it`: none
