# test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol](../../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeUtils.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A minimal Foundry unit suite calling the free function
`_getUnfinalizedBlockConfirmationsFromStateProof` directly (file-level import of
`DisputeUtils.sol`; no diamond, no storage). Inputs are synthetic `StateProof`s whose last
milestone carries `n` empty block confirmations; the oracle is the returned array length: an empty
last milestone yields an empty result, `n` confirmations yield `n − 1` (the first, finalized block
is skipped), and a fuzz over `uint8 n` pins the exact `max(0, n − 1)` formula while proving the
walk never reverts. Confirmation contents, signatures, and the callers that consume the
unfinalized suffix are out of scope. The DisputeUtils source report declares no component test
obligations, and no specification permutation is fully demonstrated by these length-only checks,
so all rows stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                         | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`test_unfinalized_emptyLastMilestone_returnsEmpty`](../../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L12) (line 12) | —      |
| [`test_unfinalized_skipsFirstFinalizedBlock`](../../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L18) (line 18)        | —      |
| [`testFuzz_unfinalized_neverReverts`](../../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L24) (line 24)                | —      |
