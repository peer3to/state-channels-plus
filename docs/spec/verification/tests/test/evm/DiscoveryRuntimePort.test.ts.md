# DiscoveryRuntimePort.test.ts

Test file: [test/evm/DiscoveryRuntimePort.test.ts](../../../../../../test/evm/DiscoveryRuntimePort.test.ts)
Exercises: [P2pRuntimeHostRoot.ts](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Overview

These cases drive the public signer/runtime boundary. They prove input validation occurs before lifecycle mutation, the exact serializable topic and options reach the host, matching-phase leave returns true and settles the pending join, post-handoff leave returns false without cancelling negotiation, optional timeout semantics cross the port, a selected channel cannot overlap discovery, and matching chains into negotiation without a client-side internal call.
The worker direct-join case fails the join receipt through the worker API and asserts the `false` result,
restored `SYNCED` status, and a live runtime; it injects no pending fault, so the fault-interleaving
permutation stays with the end-to-end participant lifecycle suite. The lobby leave and timeout cases prove
port forwarding; the service-level leave and timeout permutations are owned by the `LobbyMatchingService`
suite, which asserts them on the service directly.
The pending-participant leave case authors through `keepAuthoringUntil` until the joiner is promoted, since the
block that carries the join is the first one whose author has already received the join's inbound event.

## Tests

- `invalid channel ID rejects before state mutation`: none
- `non-boolean autoOpen rejects before state mutation`: none
- `balance missing amount rejects before port dispatch`: none
- `balance missing data rejects before port dispatch`: none
- `negative balance amount rejects before port dispatch`: none
- `fractional numeric balance amount rejects before port dispatch`: none
- `unsafe numeric balance amount rejects before port dispatch`: none
- `uint256-overflow balance amount rejects before port dispatch`: none
- `invalid balance data rejects before port dispatch`: none
- `zero timeout rejects before matching`: none
- `negative timeout rejects before matching`: none
- `fractional timeout rejects before matching`: none
- `non-finite timeout rejects before matching`: none
- `omitted matchmaking timeout behaves as null`: none
- `null timeout is accepted as unbounded matching`: none
- `same-channel connect remains available for a participating runtime`: REQ-TJOIN-6-0HEVYH.T1.P1
- `harness channel staging selects the external ID without opening or discovery`: UNIT-TEST-STATE-MANAGER-6-EBJNRX.P1
- `cross-channel connect preserves a synced observer runtime`: none
- `cross-channel connect preserves a pending participant runtime`: REQ-TJOIN-6-0HEVYH.T1.P3
- `cross-channel connect preserves a participating runtime`: REQ-TJOIN-6-0HEVYH.T1.P4
- `worker ports round-trip the full balance for joinLobby and connectToChannel`: none
- `worker direct joinChannel receipt failure restores SYNCED`: INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P7
- `already-open target with balance but no shouldJoin syncs without membership`: none
- `autoOpen without shouldJoin opens and syncs without membership`: REQ-TJOIN-1-5VGR1F.T1.P2
- `shouldJoin on an already-open target uses the default balance when omitted`: none
- `shouldJoin on an already-open target preserves supplied amount and data`: none
- `autoOpen with shouldJoin uses the default balance when omitted`: none
- `autoOpen with shouldJoin preserves supplied amount and data`: none
- `cancelConnectToChannel uses its own worker request and channel ID`: none
- `matching cancellation returns true and settles false before acceptance`: none
- `matching cancellation returns false after acceptance`: none
- `targeted connect starts fixed-ID negotiation from the returned match`: none
- `targeted cancellation and leaveLobby do not cross-cancel`: none
- `manifest-loaded custom RPC filter rejects an authenticated peer before matching`: none
- `internal leave route completes without disposing the host runtime`: REQ-TJOIN-6-0HEVYH.T1.P5
- `public leave immediately disposes an attached NOT_OPENED runtime`: REQ-TJOIN-7-NNGTAY.T1.P2, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P1
- `public leave immediately disposes a synced observer runtime`: REQ-TJOIN-7-NNGTAY.T1.P1, REQ-LIF-10-QR8NQ9.T1.P3
- `participating public leave emits leave turn, settles removal, and disposes once`: REQ-TJOIN-7-NNGTAY.T1.P3, REQ-TJOIN-7-NNGTAY.T1.P7, REQ-LIF-10-QR8NQ9.T1.P1, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P2
- `outer disposal failure rejects leave after the settled runtime becomes terminal`: none
- `a reduction that drops the leaver keeps its status until the chain records the removal`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P9, REQ-LIF-10-QR8NQ9.T1.P6
- `failed fast snapshot post falls back to a settled self-removal dispute`: REQ-LIF-10-QR8NQ9.T1.P2
- `leave watchdog starts a dispute carrying self-removal with no new blocks`: REQ-TJOIN-7-NNGTAY.T1.P6, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P5
- `authored exit cancels the recorded watchdog and enters exit-authored`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P7
- `pending leave with the signer still local makes no chain membership read`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P8
- `pending terminal leave rejects joinLobby`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P9
- `pending terminal leave rejects joinChannel`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P10
- `pending terminal leave rejects topUpBalance`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P11
- `pending terminal leave rejects collectJoinChannelConfirmation`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P12
- `leave watchdog rejects without a dispute marker`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P13, REQ-TJOIN-7-NNGTAY.T1.P9
- `leave watchdog rejects after the evidence period expires`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P14, REQ-TJOIN-7-NNGTAY.T1.P10
- `fixed N plus one block bound starts the same self-removal dispute`: REQ-TJOIN-7-NNGTAY.T1.P5, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P4
- `pending participant keeps one leave operation through promotion and exit`: REQ-TJOIN-7-NNGTAY.T1.P4, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P3
- `rejects invalid join input before changing lifecycle state`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P1, REQ-LOBBY-1-PZTPKD.T1.P3
- `forwards the caller topic and resolves pending discovery on explicit leave`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P2
- `rejects discovery while a concrete channel ID is selected`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P3, REQ-LOBBY-2-TSWRV6.T1.P4
- `targeted connect leaves an unmatched ordinary lobby to its owner`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P10
- `settles and cleans the previous lobby before replacement entry`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P4, REQ-LOBBY-9-N894C0.T1.P4
- `forwards an explicit match timeout while the default remains caller-controlled`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P7
- `does not let leaveLobby cancel negotiation after matching handoff`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P8, REQ-LOBBY-9-N894C0.T1.P10, REQ-NEG-4-ZQ0985.T1.P9
- `joinLobby starts ordinary negotiation from the returned match`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P6
- `settles joinLobby when the runtime is disposed after local signing`: UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P9, REQ-NEG-4-ZQ0985.T1.P11
- `disposal rejects leave while a watchdog upload is held and its late completion cannot resettle leave`: REQ-TJOIN-7-NNGTAY.T1.P11, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P15
- `authored leave fast fallback rejects on missing-marker`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P16, REQ-LIF-10-QR8NQ9.T1.P7, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P22
- `authored leave fast fallback on evidence-expired awaits settlement and resolves on the reduced fork`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P17, REQ-LIF-10-QR8NQ9.T1.P8
- `authored leave slow fallback rejects on missing-marker`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P18, REQ-LIF-10-QR8NQ9.T1.P9
- `authored leave slow fallback on evidence-expired awaits settlement instead of rejecting`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P19, REQ-LIF-10-QR8NQ9.T1.P10
- `authored leave slow fallback settles through one dispute`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P20, REQ-LIF-10-QR8NQ9.T1.P11
- `exit fallback failure ignores absent and awaiting-exit operations`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P21

The held-watchdog disposal case retains the actual inline test endpoint before disposal. After disposal it reads and releases that recorder through the retained endpoint, without sending new network RPCs through the disposed P2PManager. The pending leave still rejects once, and late completion cannot resettle it.
