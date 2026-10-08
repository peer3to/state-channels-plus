# StateChannelManagerProxyOpen.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol)
Exercises: [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

<a id="oq-ver-discovery-1-9jwtrh"></a>

### OQ-VER-DISCOVERY-1-9JWTRH — Resolved Foundry filename discovery decision

The 2026-08-28 engineer decision addressed Foundry filename
discovery. The original `*.test.sol` spelling ran in Forge but was invisible to the repository's
test inventory, verification reports, coverage, impact analysis, and parallel-runner mapping. The
file was renamed to `.t.sol`, the one repository spelling. Widening `TEST_FILE_RE` was rejected
because it would preserve two spellings for the same test kind. The tooling pattern remains
unchanged.

Two direct Foundry cases on the opening path. `setUp` deploys the full diamond through
`DiamondHarness` and binds it as `StateChannelManagerInterface`. The first case builds an
`OpenChannel` whose two participant entries are the same address, signs the encoding once with that
participant's key, and submits both signature slots filled with that one signature — a set that
satisfies the per-slot signature check while naming the same participant twice. The oracle is the
revert: `open()` must fail with `ErrorDuplicateParticipant` and no channel may be created.

The second case covers the successful-join count guard. It etches the shared harness
`SelectiveDepositConsumerFacet` over the deployed consumer facet, so the real deposit loop rejects
a zero-amount join, and submits a unanimously signed non-atomic open for three participants whose
balances are `500`, `0` and `0`. Only one deposit succeeds. The oracle is the full revert payload:
`ErrorAtLeastTwoParticipantsRequired(1)` — the count of SUCCESSFUL joins, which cannot be confused
with the submitted participant count of three — and the channel must stay closed. Non-atomic is
required; an atomic batch reverts on the first failing deposit and never reaches the guard.

The file was named `StateChannelManagerProxyOpen.test.sol` until this change. Forge ran it either
way, but specification test discovery matches `*.t.sol`, so the case produced no discoverable
declaration and its evidence could not be assigned. The rename restores the convention every
sibling in the directory already follows and makes the case inventoriable; it changes no behaviour.

Three cases cover the opening deadline. Each submits the same unanimously signed two-party opening
(balances `300` and `200`) whose terms carry a fixed deadline, after `vm.warp` sets the block time on
this test's own EVM. One second before the deadline and exactly at it, `open` succeeds: the oracle
is an open channel whose recorded total deposits are `500`, the sum of the signed balances. One
second after the deadline, the oracle is the full revert payload
`RaceConditionOpenChannelExpired(deadline, deadline + 1)`. The revert rolls back every write, so
no channel state or deposit can remain; the case asserts no state after the reverted call, because
such an assertion could not fail.

A fourth case pins the order of the two race checks. It opens the channel exactly at its deadline,
moves block time one second past it, and submits the same confirmation again. The terms are now
both already used and expired; the oracle is the full revert payload
`RaceConditionChannelAlreadyOpen(channelId)`, so the already-open check must run before the
deadline check.

The duplicate-participant, successful-join-count and deadline gates are exercised here. The other `open()`
gates — zero channel id, threshold shortfall, deposit composition — are covered by the Hardhat suite
[OpenChannel.test.ts](../DiamondProxy/StateChannelManager/OpenChannel.test.ts.md), and the
`DEF-1-92NTAG` length and zero-address gaps
remain open there.

## Tests

- `test_open_duplicateParticipants_reverts`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12
- `test_open_fewerThanTwoSuccessfulJoins_revertsWithSuccessfulJoinCount`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P13
- `test_open_participantsAboveMaximum_reverts`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P16
- `test_open_participantsAtMaximum_passesTheBoundCheck`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P17
- `test_open_beforeDeadline_opensChannel`: REQ-ENFADM-4-2NN96F.T1.P1
- `test_open_atDeadline_opensChannel`: REQ-ENFADM-4-2NN96F.T1.P2, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P18, REQ-CON-11-VDGJYA.T1.P27
- `test_open_afterDeadline_revertsWithOpenChannelExpired`: REQ-ENFADM-4-2NN96F.T1.P3, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P19, REQ-CON-11-VDGJYA.T1.P28
- `test_open_alreadyOpenAfterDeadline_revertsWithChannelAlreadyOpen`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P20
