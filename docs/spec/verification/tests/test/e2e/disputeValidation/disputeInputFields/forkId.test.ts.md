# forkId.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/forkId.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/forkId.test.ts)

## Overview

The single test checks fork-identity binding from the auditor side: a committed dispute that
targets a forkId honest peers do not track must be left alone. From a genesis channel
(`timeoutSetup(3, 0)`), peer 1 posts a tampered self-removal dispute whose `input.forkId` is a
random hash (timeout and onChainSlashes zeroed so selfRemoval is the only claim). The oracles
assert honest peers observe exactly one `disputeCommitted` event (the junk dispute does land
on-chain), fire no `onDisputeKilled` during a 6-second quiet window since they never audit a fork
they do not track, and each still reports the original genesis forkId afterwards — no peer
switched onto the junk fork. Kill, slashing, and resolution behavior for the junk fork are out of
scope. After the permutation atomization, the wrong-identity permutation is split per identity
field, and this test covers the wrong-fork scenario in full.

## Tests

- `current fork == genesis; dispute.input.forkId = random; honest peers stay on genesis`: REQ-DISPUTE-PIPE-1-HRBFP7.T1.P6
