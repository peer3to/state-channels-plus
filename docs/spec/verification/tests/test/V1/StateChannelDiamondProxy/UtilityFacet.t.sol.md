# UtilityFacet.t.sol

Test file: [test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol)
Exercises: [UtilityFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)

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
planned permutations `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1`–`P8` all target those threshold/decode/predicate
surfaces, so none of them is covered by the array-helper cases and those permutations stay unassigned.

## Tests

- `testFuzz_subtractAddressArrays_excludesSubtracted`: none
- `testFuzz_subtractAddressArrays_emptyIsIdentity`: none
- `testFuzz_subtractAddressArrays_selfIsEmpty`: none
- `testFuzz_concatBytesArrays_lengthAndOrder`: none
- `testFuzz_insertIntoAddressArrayNoDuplicates_containsAndDedup`: none
- `testFuzz_insertIntoAddressArrayNoDuplicates_idempotent`: none
- `testFuzz_areAddressArraysEqual_reflexive`: none
- `testFuzz_areAddressArraysEqual_symmetric`: none
- `test_retrieveSignerAddresses_unrecoverableSignatureYieldsZeroInItsSlot`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P9
- `test_retrieveSignerAddresses_noSignaturesYieldsEmptySet`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P10
