# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One direct Foundry case on the opening path. `setUp` deploys the full diamond through
`DiamondHarness` and binds it as `StateChannelManagerInterface`. The case builds an `OpenChannel`
whose two participant entries are the same address, signs the encoding once with that participant's
key, and submits both signature slots filled with that one signature — a set that satisfies the
per-slot signature check while naming the same participant twice. The oracle is the revert:
`open()` must fail with `ErrorDuplicateParticipant` and no channel may be created.

The file was named `StateChannelManagerProxyOpen.test.sol` until this change. Forge ran it either
way, but specification test discovery matches `*.t.sol`, so the case produced no discoverable
declaration and its evidence could not be assigned. The rename restores the convention every
sibling in the directory already follows and makes the case inventoriable; it changes no behaviour.

Only the duplicate-participant gate is exercised here. The other `open()` gates — zero channel id,
threshold shortfall, deposit composition — are covered by the Hardhat suite
[OpenChannel.test.ts](../DiamondProxy/StateChannelManager/OpenChannel.test.ts.md), and the
[`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) length and zero-address gaps
remain open there.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                    | Covers                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_open_duplicateParticipants_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol#L20) (line 20) | [`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p12) |
