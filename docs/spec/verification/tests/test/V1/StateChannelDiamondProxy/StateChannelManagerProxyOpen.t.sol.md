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

Five cases cover the off-chain agreed genesis. The harness signs terms whose `genesisStateHash` it
computes with its own never-etched `MathConsumerFacet`, so etching the shared
`SelectiveDepositConsumerFacet` (which rejects a zero-amount deposit and whose genesis hook reverts)
over the deployed consumer leaves the signed hash real. One open warps to a known time and reads the
stored snapshot: its state hash is the signed hash, its participants are the terms', its inbound tip
is the hash of the `InboundMessagesProcessed` block at height 1, its timestamp is the warp time, and
its fork id hashes its data. One open runs with the reverting hook etched and still succeeds with the
signed hash, so `open` never calls the hook. One open signs non-empty opening data and decodes the
`ChannelOpened` log: the data is the signed data and the snapshot equals storage. A one-participant
open with a zero amount reverts with `ErrorAtLeastTwoParticipantsRequired(1)`, not the deposit
failure the etched consumer would raise, so the count check runs before any deposit. A two-party open
whose second amount is zero reverts with `ErrorJoinChannelAtomicFailure(1, bob)`.

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

The duplicate-participant, participant-count, deposit-failure, genesis-commitment and deadline gates are exercised here. The other `open()`
gates — zero channel id, threshold shortfall, deposit composition — are covered by the Hardhat suite
[OpenChannel.test.ts](../DiamondProxy/StateChannelManager/OpenChannel.test.ts.md). The
`DEF-1-92NTAG` short-balances and zero-address reverts are planned but not yet tested.

A genesis-record case opens the same two-party channel, decodes the emitted genesis inbound block and
asserts the chain finds it under the hash of that full block, the snapshot's inbound head is that
hash at height 1 with total deposits `500`, no participant is pending, and the block does not read
as uncommitted. Two cases record a state diff of a valid two-seat open: it writes exactly 17 fresh manager
slots (the snapshot, the balance tracker and the genesis inbound record), and it touches none of the manager's
configuration storage words 5, 6, 14 and 15 while the channel opens with its deposits; that case first reads
those words and requires the configured participant maximum, state machine, consumer and utility facet there.

## Tests

- `test_open_duplicateParticipants_reverts`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12
- `test_open_inboundJoinMessageDataIsCanonicalJoinEncoding`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P24, REQ-DATA-1-1KNRQS.T1.P15
- `test_open_oneParticipant_revertsBeforeAnyDeposit`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P26, REQ-LIF-11-KEEN0N.T1.P4
- `test_open_failingDeposit_revertsTheWholeOpen`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P4, REQ-LIF-11-KEEN0N.T1.P5
- `test_open_recordsTheSignedGenesisCommitment`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P27, REQ-LIF-11-KEEN0N.T1.P1
- `test_open_neverCallsTheGenesisHook`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P28, REQ-LIF-11-KEEN0N.T1.P2
- `test_open_emitsTheSnapshotAndTheOpeningData`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P29, REQ-LIF-11-KEEN0N.T1.P3
- `test_open_participantsAboveMaximum_reverts`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P16
- `test_open_participantsAtMaximum_passesTheBoundCheck`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P17
- `test_open_beforeDeadline_opensChannel`: REQ-ENFADM-4-2NN96F.T1.P1
- `test_open_atDeadline_opensChannel`: REQ-ENFADM-4-2NN96F.T1.P2, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P18
- `test_open_afterDeadline_revertsWithOpenChannelExpired`: REQ-ENFADM-4-2NN96F.T1.P3, UNIT-TEST-MANAGER-PROXY-1-NTYR71.P19
- `test_open_alreadyOpenAfterDeadline_revertsWithChannelAlreadyOpen`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P20
- `test_open_storesTheGenesisRecordUnderTheFullBlockHash`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P25
- `test_open_twoSeats_writesSeventeenFreshSlots`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P31
- `test_open_readsNoConfigurationWordFromStorage`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P32
- `test_freeLaneSlots_holdEvidenceTimeSnapshotParticipantsAndWindowTimestamps`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P33
