# SpectateServiceReplayBase.test.ts

Test file: [test/unit/SpectateServiceReplayBase.test.ts](../../../../../../test/unit/SpectateServiceReplayBase.test.ts)

## Overview

Exercises sync replay from the verified predecessor, including a compact proof with unavailable older coordinate history. The spectator is created and synced at genesis before the two initial blocks, so runtime startup cannot consume an active authoring window. The subsequent cutoff and final-block count preserve the equal-base and one-below-base premises.

The `staged install` cases (staging in `test/fixtures/SyncInstallStaging.ts`) hold the requester's sync
install after the proof is staged. With a conflicting block stored at the base height in that window (as
a dispute audit stores verified blocks outside the state mutex), the sync aborts with
"payload persistence aborted" and blacklists the responder; the install state (VM, state hash, latest
height, fork, status) equals the state before the sync and the stored block stays the conflicting one.
Without the conflict the held install commits and the sync reaches the tip with no blacklist. A requester
that already holds the base, with its stored base block replaced by a conflicting one, aborts before any
install (the install entry is recorded as never called) and keeps its state. A runtime stopped while the
install is held returns false, keeps its state and does not blacklist the responder. When the install's
commit callback throws after the VM write, the VM is written back to the pre-install state, the install
state equals the state before the sync, the sync rejects with that same error and the responder is not
blacklisted.

## Tests

- `requester's latest height equals the served base height → it keeps its own state as the replay base and syncs to the tip`: REQ-SP-10-JMVHTB.T5.P17, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P89
- `requester's latest height one below the served base height → the base is installed, then the sync reaches the tip`: REQ-SP-10-JMVHTB.T5.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P90
- `a block conflicting with the served history lands between staging and commit → VM restored, nothing published, fork and status unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P105
- `no conflict between staging and commit → the held install commits and the sync reaches the tip`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P106
- `requester holds the base and a stored block conflicts with the served history → aborted, local state kept`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P107
- `runtime stops while the install is held → nothing installed, no verdict on the responder`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P101
- `the install's commit callback throws after the VM write → VM restored to the pre-install state, fork unchanged, the sync rejects with that error and no verdict on the responder`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P18
