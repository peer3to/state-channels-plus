# test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol) > **Status:** Authored — engineer verification pending.
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
absent, and is idempotent; `areAddressArraysEqual` is reflexive and symmetric. Two direct cases cover the signer-set report
`retrieveSignerAddresses`: three signatures where the middle one is 64 bytes (the wrong length, so
recovery fails) must yield the two real signers in submission order with `address(0)` in the
middle slot rather than a revert, and an empty signature list must yield an empty set. The
facet's signature-threshold verification, block decode, and genesis/ordering predicates are not
touched here (the Hardhat `SignatureVerification.test.ts` suite covers the threshold path). The
planned permutations [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v)–`P8` all target those threshold/decode/predicate
surfaces, so none of them is covered by the array-helper cases and those rows stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                   | Covers                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`testFuzz_subtractAddressArrays_excludesSubtracted`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L26) (line 26)                      | —                                                                                                                                                                         |
| [`testFuzz_subtractAddressArrays_emptyIsIdentity`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L36) (line 36)                         | —                                                                                                                                                                         |
| [`testFuzz_subtractAddressArrays_selfIsEmpty`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L45) (line 45)                             | —                                                                                                                                                                         |
| [`testFuzz_concatBytesArrays_lengthAndOrder`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L50) (line 50)                              | —                                                                                                                                                                         |
| [`testFuzz_insertIntoAddressArrayNoDuplicates_containsAndDedup`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L62) (line 62)           | —                                                                                                                                                                         |
| [`testFuzz_insertIntoAddressArrayNoDuplicates_idempotent`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L79) (line 79)                 | —                                                                                                                                                                         |
| [`testFuzz_areAddressArraysEqual_reflexive`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L86) (line 86)                               | —                                                                                                                                                                         |
| [`testFuzz_areAddressArraysEqual_symmetric`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L91) (line 91)                               | —                                                                                                                                                                         |
| [`test_retrieveSignerAddresses_unrecoverableSignatureYieldsZeroInItsSlot`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L98) (line 98) | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P9`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v)  |
| [`test_retrieveSignerAddresses_noSignaturesYieldsEmptySet`](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol#L115) (line 115)              | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P10`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v) |
