# StateChannelManagerProxy.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-CONTRACT-ARCH-1-TWQHTM` (Single logical state)](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm)
- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
- [`REQ-CONTRACT-ARCH-3-GEGD78` (Internal-call confinement)](../../../../../specification/enforcement/contracts.md#req-contract-arch-3-gegd78)
- [`REQ-CONTRACT-ARCH-4-FZ3CJE` (Upgrade and deployment integrity)](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje)
  Partial: the constructor rejects only a codeless route target in `_registerRoute`; an incompatible code-bearing module is accepted ([`FIND-DEPLOY-1-T2XFRK`](../../../../../audit/open-findings.md#find-deploy-1-t2xfrk)).
- [`REQ-CONTRACT-ARCH-5-QT17P1` (Complete operation ownership)](../../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1)
  Partial: `_facetForSelector` sends every unregistered selector to the consumer facet by delegatecall, so keeping unowned operations off channel state is integrator-owned and not enforced ([`OQ-17-6Z5Q0J` (Consumer-facet functions are externally reachable)](../../../../open-questions.md#oq-17-6z5q0j)).
- [`REQ-ENFADM-1-V926CA` (Self-submission with pinned state)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca)
- [`REQ-ENFADM-3-6A3BEB` (Custody through the adapter only)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb)
- [`REQ-ENFADM-4-2NN96F` (Opening terms expire at their deadline)](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-4-2nn96f)
- [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`INV-HIST-4-DSMGGT` (forkId = keccak256)](../../../../../specification/protocol-model/history-and-commitments.md#inv-hist-4-dsmggt)
- [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- [`REQ-SM-4-Z32M0W` (Ordering/encoding/round-trip defined explicitly)](../../../../../specification/protocol-model/state-machines.md#req-sm-4-z32m0w)
- [`REQ-LIF-1-A5BN02` (The best-case complete lifecycle needs at least two base-layer transactions)](../../../../../specification/settlement/lifecycle.md#req-lif-1-a5bn02)
- [`REQ-LIF-6-VG861M` (Four protocol windows are configured on the manager at deployment and mirrored…)](../../../../../specification/settlement/lifecycle.md#req-lif-6-vg861m)
- [`REQ-TIME-3-MT1MMF` (Window values and skew bound are explicit configuration trade-offs)](../../../../../specification/protocol-model/time.md#req-time-3-mt1mmf)
- [`INV-DA-1-TS7HX2` (A posted block-calldata commitment MUST be immutable for its key and binding)](../../../../../specification/security/data-availability.md#inv-da-1-ts7hx2)

## UNIT-TEST-MANAGER-PROXY-1-NTYR71

Opening and calldata posting

- Setup: Open with valid/dup/zero ids, unanimous and short signatures, atomic and partial deposits, terms at and past their opening deadline, a duplicate open after the deadline; post calldata within/after the window, as non-author, and twice
- Oracle: Only valid unanimous opens within their deadline store genesis; posting guards enforce author/no-overwrite/deadline; [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) cases documented

- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P1` — valid open
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P2` — duplicate channel id
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P3` — short threshold
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P4` — atomic deposits open
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P5` — non-author post revert
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P6` — [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) length mismatch (documents finding)
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P7` — zero channel id
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P8` — partial-deposit open
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P9` — overwrite post revert
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P10` — post-deadline post revert
- [ ] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P11` — [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) zero-address (documents finding)
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12` — duplicate participants rejected
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P13` — partial-deposit open revert carries the count of SUCCESSFUL joins, not the submitted participant count
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P14` — overwrite post revert carries the fork id, transaction count, posting participant and the stored commitment
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P15` — non-author post revert carries the block author and the actual sender
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P16` — a participant list larger than the channel's configured participant maximum is rejected, naming the requested and permitted sizes
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P17` — a list at exactly the maximum passes the bound and fails later, so the check rejects above the limit rather than at it
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P18` — terms submitted at exactly their opening deadline open, so the deadline gate is inclusive like join
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P19` — terms submitted after their opening deadline revert with `RaceConditionOpenChannelExpired` carrying the deadline and chain time
- [x] `UNIT-TEST-MANAGER-PROXY-1-NTYR71.P20` — an already-open channel whose terms are past their deadline reports `RaceConditionChannelAlreadyOpen` first, not `RaceConditionOpenChannelExpired`

## UNIT-TEST-MANAGER-PROXY-2-KJRMB8

Selector routing, interface agreement and confinement

- Setup: Resolve every function of each facet's compiled ABI through `facetAddressForSelector` on a deployed diamond; reconcile the proxy ABI, the routed facet ABIs and the `StateChannelManagerInterface` ABI against each other; call routed operations, each `onlySelf` op directly and via composition, and multicall compositions with a failing leg
- Oracle: Each facet's routed selectors resolve to that facet's deployed address and nowhere else; deliberately excluded facet functions and unknown selectors resolve to the consumer facet; no routed selector is shadowed by a proxy-implemented function; the interface declares exactly the callable surface, with the implementor's mutability and signature; routed calls execute against one state; direct internal calls revert; multicall is all-or-nothing

- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P1` — every routed dispute-manager selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P2` — depositAssetsComposable direct revert
- [ ] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P3` — multicall bubbling
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P4` — every routed dispute-verification selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P5` — every routed fraud-proof selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P6` — every routed dispute-fraud-proof selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P7` — every routed state-snapshot selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P8` — every routed join-channel selector resolves to that facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P9` — every routed state-proof selector resolves to that facet
- [ ] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P10` — a consumer-facet call reaches the consumer facet through the fallback
- [ ] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P11` — withdrawAssetsComposable direct revert
- [ ] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P12` — executeStateTransition direct revert
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P13` — atomic deposit failure rolls back prior adapter effects
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P14` — non-atomic deposit filters failures and appends only successful deposits
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P15` — all-failed deposit batch reverts without an inbound block
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P16` — empty deposit batch reverts before adapter execution
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P17` — every routed utility-view selector resolves to the utility facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P18` — the utility facet's stateless helpers are absent from the routing table
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P19` — the dispute-verification facet's internal steps are absent from the routing table
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P20` — the fraud-proof facet's internal step is absent from the routing table
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P21` — no selector is defined by two facet ABIs
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P22` — an unknown selector resolves to the consumer facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P23` — the proxy's own selectors are absent from the routing table
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P24` — no routed facet selector is shadowed by a proxy-implemented function
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25` — every proxy-implemented and routed function is declared on the interface
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26` — the interface declares nothing the proxy neither implements nor routes
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P27` — every interface declaration repeats the implementing function's state mutability
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P28` — every interface declaration repeats the implementing function's full signature
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P29` — constructor duplicate selector registration reverts with the exact selector
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P30` — deployed facet inventory equals the canonical routed-facet owner
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P32` — constructor rejects a codeless routed target with the exact selector and address
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P33` — a registered selector executes on a deployed facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P34` — routed open-channel count and page selectors resolve through the utility facet
- [x] `UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P35` — an atomic deposit failure reached through `joinChannel` names the failing batch index and that join’s participant

## UNIT-TEST-MANAGER-PROXY-3-C3NY4X

Funded replay or no verdict

- Setup: Open a channel and submit `applyFraudProofs` invalid-transition proofs over an honest `add` block, a never-finishing `burn` block, and an honest block whose transition catches an inner out-of-gas (16M budget), each below the machine requirement, with ample gas, with fuzzed gas, and with the measured cost with and without `getStateTransitionReplayGas()`; call `executeStateTransition` as the diamond across a sweep of small gas amounts
- Oracle: Below the requirement every replay reverts with `ErrorInsufficientGasForStateTransition` and nobody is slashed; funded, the honest blocks keep their author standing and the `burn` block slashes it; for any attached gas an honest author is never slashed and the `burn` author is slashed exactly when the call succeeded; cost plus replay gas always funds the replay; a starved machine frame yields `ErrorStateTransitionFrameOutOfGas`, never a verdict

- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P1` — an under-funded replay of a never-finishing transition reverts with the machine's refusal and slashes nobody
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P2` — an under-funded replay of a cheap honest transition reverts with the machine's refusal and slashes nobody
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P3` — fuzzed attached gas never slashes the author of an honest cheap block
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P4` — a funded replay of a never-finishing transition slashes the author
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P5` — fuzzed attached gas never acquits a never-finishing transition: the author is slashed exactly when the call succeeds
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P6` — a funded replay of a cheap honest block fails the proof and keeps the author standing
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P7` — an under-funded replay of a transition that catches an inner out-of-gas reverts with the machine's refusal and slashes nobody
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P8` — a funded replay of a transition that catches an inner out-of-gas fails the proof and keeps the author standing
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P9` — fuzzed attached gas never slashes the author of a block whose transition catches an inner out-of-gas
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P10` — a call carrying only its measured funded cost is refused, and the same call carrying that cost plus `getStateTransitionReplayGas()` is judged
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P11` — a machine frame left too little gas to reach its own check fails with empty returndata and `executeStateTransition` reverts with `ErrorStateTransitionFrameOutOfGas`
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P12` — fuzzing both the attached gas and the size of the replayed transition's input (up to 128 KiB) never slashes the author of an honest transition that catches an inner out-of-gas
- [x] `UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P13` — with many outbound messages left in the machine's storage by an earlier transition, fuzzed attached gas never slashes the author of an honest transition that catches an inner out-of-gas: the deletion either fits beside the full budget or the replay is refused

## UNIT-TEST-SM-MANAGER-PROXY-1-8GBCH7

Replay execution

- Setup: Call `executeStateTransition(channelId, encodedState, tx)` from the diamond itself (`onlySelf`) with a pre-state and a transaction the configured `stateMachineImplementation` accepts, leaving zero, one or many outbound messages.
- Oracle: It returns `(true, state, messages)` where `state` and the ordered `messages` equal a direct `setState` plus `stateTransition` on the same implementation.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-MANAGER-PROXY-1-8GBCH7.P1` — Restore the supplied pre-state, call the configured implementation, and return the exact success classification, state bytes, and ordered messages

## UNIT-TEST-SM-MANAGER-PROXY-2-579ESN

Replay failure

- Setup: Call `executeStateTransition` with a transition that reverts with a reason, one that reverts bare (surfacing as "AStateMachine - Call failed - result length 0"), and a machine frame that runs out of gas with empty returndata.
- Oracle: A transition revert returns `success == false`, the restored pre-state bytes and no outbound messages; empty returndata reverts with `ErrorStateTransitionFrameOutOfGas` and an `ErrorInsufficientGasForStateTransition` refusal is re-raised, so no verdict is returned.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-MANAGER-PROXY-2-579ESN.P1` — A revert with data produces the expected rejection without accepting partial replay output
- [ ] `UNIT-TEST-SM-MANAGER-PROXY-2-579ESN.P2` — a revert without data produces the same rejection
- [ ] `UNIT-TEST-SM-MANAGER-PROXY-2-579ESN.P3` — a failed low-level call produces the same rejection

## UNIT-TEST-SM-MANAGER-PROXY-3-XKZ0BK

State restoration

- Setup: Call `executeStateTransition` with a valid `encodedState`, with truncated bytes and with a differently shaped encoding, then again with a valid state.
- Oracle: A valid state is restored through `stateMachineImplementation.setState`, so the result matches a direct run from those bytes; a malformed or incompatible encoding reverts in `setState`, and the next valid call returns the same result as on a fresh machine.
- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-MANAGER-PROXY-3-XKZ0BK.P1` — Valid encodings restore exactly
- [ ] `UNIT-TEST-SM-MANAGER-PROXY-3-XKZ0BK.P2` — malformed encodings reject and do not contaminate later calls
- [ ] `UNIT-TEST-SM-MANAGER-PROXY-3-XKZ0BK.P3` — incompatible encodings reject and do not contaminate later calls

## UNIT-TEST-SM-MANAGER-PROXY-4-C2TN34

Forwarded interface semantics

- Setup: Compare `executeStateTransition` outputs with direct `setState`, `stateTransition` and `getState` calls on `stateMachineImplementation` for the same inputs and for different `channelId` values.
- Oracle: The proxy returns the implementation's success flag, state bytes and `Message[]` unchanged, and `channelId` does not affect the result because every channel shares one implementation.
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-MANAGER-PROXY-4-C2TN34.P1` — The proxy forwards canonical inputs/outputs to the configured implementation without introducing a second state-machine meaning
