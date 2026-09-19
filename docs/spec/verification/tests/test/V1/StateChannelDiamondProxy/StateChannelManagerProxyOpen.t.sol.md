# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

The duplicate-participant and successful-join-count gates are exercised here. The other `open()`
gates — zero channel id, threshold shortfall, deposit composition — are covered by the Hardhat suite
[OpenChannel.test.ts](../DiamondProxy/StateChannelManager/OpenChannel.test.ts.md), and the
[`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) length and zero-address gaps
remain open there.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_open_duplicateParticipants_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L28) (line 28)                              | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p12) |
| [`test_open_fewerThanTwoSuccessfulJoins_revertsWithSuccessfulJoinCount`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L46) (line 46) | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p13) |
| [`test_open_participantsAboveMaximum_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L79) (line 79)                           | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P16`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p16) |
| [`test_open_participantsAtMaximum_passesTheBoundCheck`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L95) (line 95)                  | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P17`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p17) |
