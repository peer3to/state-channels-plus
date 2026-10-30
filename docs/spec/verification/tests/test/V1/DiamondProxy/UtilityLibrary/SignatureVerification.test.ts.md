# SignatureVerification.test.ts

Test file: [test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts)
Exercises: [UtilityFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)

## Overview

A Hardhat suite that deploys `UtilityFacet` standalone and calls `verifyThresholdSigned` directly
with ethers `personal_sign` signatures over an ABI-encoded message hash. The oracle is the
returned `(ok, reason)` tuple — `"Cryptography: Not enough signatures provided"` vs
`"Cryptography: Not enough valid signatures"` — or the `ECDSAInvalidSignatureLength` custom error
for length-corrupted signatures. Cases walk the 1-of-1 path (success, wrong encoded message, no
signature, invalid length) and the 3-of-3 threshold path: signatures in and out of order, extra
signatures tolerated, a one-signature shortfall, a duplicate signature never double-counted
toward the threshold, a changed message invalidating all signatures, and a length-corrupted
signature in a batch. Diamond routing, membership-union hops, and signer malleation (as opposed
to truncation/corruption) are out of scope. The former missing-and-extra-member bundle is now
split into single-scenario IDs (`P3` missing member, `P6` extra member) and both halves are
assigned below; the remaining permutations target surfaces this suite does not touch (malleated
encodings, `tryDecode`, genesis predicates) and stay unassigned.

## Tests

- `1 of 1 - Success`: none
- `1 of 1 - Wrong encoded message`: none
- `1 of 1 - No signature`: none
- `1 of 1 - Invalid signature length`: none
- `3 of 3 inorder - success`: none
- `3 of 3 not inorder - success`: none
- `3 of 3 with more signatures not inorder - success`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P6
- `2 of 3 - fail`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P3, REQ-ENFPROOF-2-YZDCXM.T1.P5
- `2 of 3 with one duplicate signature - fail`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1, REQ-ENFPROOF-2-YZDCXM.T1.P1
- `3 of 3 with changed message - fail`: none
- `2 of 3 with one invalid signature length - fail`: none
