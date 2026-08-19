# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Foundry suite over `open()`, deployed through the full `DiamondHarness` diamond (real facets, real
storage) so the assertions run against the production entry point rather than an isolated helper.

Its subject is the decision recorded in [admission-and-funds.md](../../../../../specification/enforcement/admission-and-funds.md)
and [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag): the participants/balances
parallel-array correspondence is deliberately **not** validated on-chain. That decision rests on two
properties, and the point of this suite is to hold them to evidence rather than to prose, so the
decision can be falsified if either stops holding.

**One honest participant is sufficient.** A malformed term needs the full signature set. With one
listed participant abstaining the threshold is not met, and a colluding participant cannot substitute
its own signature for the missing one — both attempts revert and leave no channel behind. An on-chain
shape check would only repeat what the signature set already decides.

**A fully colluding set affects only itself.** When both listed participants do sign a surplus
balance, the channel opens — and the surplus buys nothing: deposits are composed per listed
participant, so the recorded `totalDeposits` is exactly the two listed balances and matches what a
well-formed open records. The control case is what makes that assertion meaningful: without it,
"the totals look right" would be unfalsifiable. The other malformed direction reverts on the
out-of-range access, so it cannot strand escrow either.

The duplicate-participant check is separate — that one *is* enforced on-chain, and its test is
unchanged from before.

Deposit composition beyond the open path, genesis snapshot contents, calldata posting, and the
channel-id guards are not exercised here; those permutations under
[`UNIT-TEST-MANAGER-PROXY-1-NTYR71`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71)
stay with the Hardhat open-channel suite.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                     | Covers                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_open_duplicateParticipants_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L31) (line 31)                                  | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p14) |
| [`test_open_malformedTerms_abstainingParticipantBlocksThreshold`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L50) (line 50)            | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P6`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p6)   |
| [`test_open_malformedTerms_colluderCannotForgeTheAbstainer`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L67) (line 67)                 | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p12) |
| [`test_open_collusiveSurplusBalances_createNoDepositCredit`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L86) (line 86)                 | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P11`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p11) |
| [`test_open_wellFormedTerms_recordSameTotalsAsSurplusTerms`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L103) (line 103)               | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P15`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p15) |
| [`test_open_collusiveShortBalances_leaveNoState`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L115) (line 115)                          | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p13) |
