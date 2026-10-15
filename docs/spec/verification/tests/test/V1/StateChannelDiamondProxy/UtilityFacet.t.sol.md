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
facet's signature-threshold verification and genesis/ordering predicates are not
touched here (the Hardhat `SignatureVerification.test.ts` suite covers the threshold path). Block
decode is covered directly: a canonical block with a nonempty dynamic body and a nested message
round-trips byte-identically through `decodeBlock`, decodable noncanonical encodings (trailing
byte/word, dirty padding) revert with `ErrorNonCanonicalEncoding`, malformed bytes revert ordinarily,
and `tryDecodeBlock` reports canonical bytes true with exact fields and every other input false
with the default block. The obsolete trailing-word-acceptance permutation is deleted and its number
left gapped, so the gap at `P11` (between `P10` and `P12`) is intentional rather than a missing case. Of the planned
permutations `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1`–`P8`, the decode pair is now covered (`P4` valid,
`P7` invalid); the threshold/predicate permutations stay unassigned.

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
- `test_decodeBlock_canonicalRoundTrip`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P14
- `test_decodeBlock_rejectsNonCanonical`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P15
- `test_tryDecodeBlock_rejectsNonCanonical`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P4, UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7, UNIT-TEST-UTILITY-FACET-1-ER4P0V.P16
