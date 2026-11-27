# E2E-SyncInstallDecision.test.ts

Test file: [test/e2e/E2E-SyncInstallDecision.test.ts](../../../../../../test/e2e/E2E-SyncInstallDecision.test.ts)

## Overview

Two workflows run the real sync request between live peers. In the first, three participants
post an anchor and finalize two blocks; peer 0 then answers a participant's pinned request with a
crafted side chain whose tail block conflicts with that participant's final point. The request
fails, the participant's head and final point stay, the side chain is kept as its sync evidence,
and peer 0 stays connected and unblacklisted. In the second, an observer present at the opening
follows three final blocks, then its gossip is dropped and its local diamond misses a consumed
top-up; its first request to peer 0 installs nothing and records no rejection or blacklist, and
after the missed log is released its next request to the same peer installs peer 0's head.

## Tests

- `a participant asks a peer that serves a side chain conflicting with its own final point → the sync request fails, nothing is installed, the side chain is kept as sync evidence and the relaying peer stays connected and unblacklisted`: REQ-SYNC-5-M7W6JX.T1.P7
- `an observer asks for an honest continuation it cannot check from its own final point (its local diamond missed a consumed top-up) → the first request installs nothing and blames nobody; once its local diamond holds the run the next request to the same peer installs the served head`: REQ-SYNC-5-M7W6JX.T1.P8
