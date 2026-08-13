# test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [UtilityFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A stateless Foundry fuzz suite over the pure array helpers of `UtilityFacet`, deployed standalone
(plain `new UtilityFacet()`, no diamond, no storage). Each test states an algebraic property and
checks it against a local reference (`_contains` loop): `subtractAddressArrays` yields a subset of
the minuend with nothing from the subtrahend, is the identity for an empty subtrahend, and empties
on self-subtraction; `concatBytesArrays` preserves total length and element order;
`insertIntoAddressArrayNoDuplicates` guarantees presence, appends exactly one element only when
absent, and is idempotent; `areAddressArraysEqual` is reflexive and symmetric. The facet's
signature-threshold verification, block decode, and genesis/ordering predicates are not touched
here (the Hardhat `SignatureVerification.test.ts` suite covers the threshold path). The planned
permutations [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p1)–`P8` all target those threshold/decode/predicate
surfaces, so none of them is covered by this array-helper suite and all rows stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                            | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`testFuzz_subtractAddressArrays_excludesSubtracted`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L22) (line 22)            | —      |
| [`testFuzz_subtractAddressArrays_emptyIsIdentity`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L32) (line 32)               | —      |
| [`testFuzz_subtractAddressArrays_selfIsEmpty`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L41) (line 41)                   | —      |
| [`testFuzz_concatBytesArrays_lengthAndOrder`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L46) (line 46)                    | —      |
| [`testFuzz_insertIntoAddressArrayNoDuplicates_containsAndDedup`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L58) (line 58) | —      |
| [`testFuzz_insertIntoAddressArrayNoDuplicates_idempotent`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L75) (line 75)       | —      |
| [`testFuzz_areAddressArraysEqual_reflexive`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L82) (line 82)                     | —      |
| [`testFuzz_areAddressArraysEqual_symmetric`](../../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L87) (line 87)                     | —      |
