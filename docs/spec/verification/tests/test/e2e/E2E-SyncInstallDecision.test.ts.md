# E2E-SyncInstallDecision.test.ts

Test file: [test/e2e/E2E-SyncInstallDecision.test.ts](../../../../../../test/e2e/E2E-SyncInstallDecision.test.ts)

## Overview

Four workflows run the real sync request between live peers. In the first, three participants
post an anchor and finalize two blocks; peer 0 then answers a participant's pinned request with a
crafted side chain whose tail block conflicts with that participant's final point. The request
fails, the participant's head and final point stay, the side chain is kept as its sync evidence,
and peer 0 stays connected and unblacklisted. In the second, an observer present at the opening
follows three final blocks, then its gossip is dropped and its local diamond misses a consumed
top-up; its first request to peer 0 installs nothing and records no rejection or blacklist, and
after the missed log is released its next request to the same peer installs peer 0's head. In the
third, with timeout checks off, a spectator's JOIN is posted and observed but not consumed, and peer 0
answers participant 2's request with a threshold-final block at participant 2's final height that
consumes that JOIN, signed by all four keys. The request fails with no rejection or blacklist, the
participant's final point stays, the proof is kept as sync evidence, no dispute marker is set, peer 0
stays connected, and when participant 2 then submits on its own writer turn no peer's height moves.
In the fourth, the same history is served with that threshold-final block one below participant
2's final point: the proof ends below the final point, is walked from the anchor, and only the
reverse regression kill holds. The request fails with no rejection or blacklist, the proof is kept as
sync evidence, no dispute marker is set, peer 0 stays connected, and on participant 2's writer turn no
peer's height moves.

## Tests

- `a participant asks a peer that serves a side chain conflicting with its own final point → the sync request fails, nothing is installed, the side chain is kept as sync evidence and the relaying peer stays connected and unblacklisted`: REQ-SYNC-5-M7W6JX.T1.P7
- `an observer asks for an honest continuation it cannot check from its own final point (its local diamond missed a consumed top-up) → the first request installs nothing and blames nobody; once its local diamond holds the run the next request to the same peer installs the served head`: REQ-SYNC-5-M7W6JX.T1.P8
- `a participant asks a peer that serves the history its own final point loses to (a joiner's JOIN more consumed at that height) → the request fails and blames nobody, nothing is installed, the proof is kept as sync evidence, no dispute is opened, and on its next turn the participant authors no block on the fork`: REQ-SYNC-5-M7W6JX.T2.P6
- `a participant asks a peer that serves a proof ending one below its own final point, whose final block there has consumed a joiner's JOIN its own final point lacks → the request fails and blames nobody, nothing is installed, the proof is kept as sync evidence, no dispute is opened, and on its next turn the participant authors no block on the fork`: REQ-SYNC-5-M7W6JX.T2.P8
