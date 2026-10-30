# E2E-CrashLogUpload.test.ts

Test file: [test/e2e/E2E-CrashLogUpload.test.ts](../../../../../../test/e2e/E2E-CrashLogUpload.test.ts)

## Overview

The suite runs two-peer harness sessions against a real HTTP log receiver, in the fully threaded
topology (main, sdk worker, vm worker per peer) and inline. Every oracle is what the receiver
decoded: which thread streams arrived for which peer, which markers they carry, the sequence ranges
on consecutive rounds, and the stored record of what a round reached. It covers a collection started
from the app's thread reaching the sdk realm's own store; one stream per thread for every peer, all
filed under the channel; a crash inside an sdk worker uploading the sibling peer's realms as well; a
second round carrying only what happened since the first; the stored round record matching the
answer the caller got; and the inline topology filing the same threads with no worker at all.

## Tests

- `uploads the host thread's own logs, which today never leave it`: none
- `uploads one stream per thread for every peer`: REQ-LOG-6-Q8KY4N.T1.P2, REQ-LOG-8-B7VN3J.T1.P3
- `a crash inside the SDK thread uploads its connected client and executor roots`: INV-LOG-1-P4WT6R.T1.P4
- `a second flush uploads only what happened since the first`: none
- `returns a local report result without claiming remote completion`: none
- `inline mode files the same threads without a worker`: REQ-LOG-8-B7VN3J.T1.P1
