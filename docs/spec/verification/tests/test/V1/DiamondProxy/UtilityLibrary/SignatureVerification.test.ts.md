# test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [UtilityFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                             | Covers                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateChannelUtilLibrary > Signature Verification > 1 of 1 - Success`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L48) (line 48)                                             | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Signature Verification > 1 of 1 - Wrong encoded message`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L60) (line 60)                               | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Signature Verification > 1 of 1 - No signature`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L74) (line 74)                                        | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Signature Verification > 1 of 1 - Invalid signature length`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L88) (line 88)                            | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 3 of 3 inorder - success`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L107) (line 107)                          | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 3 of 3 not inorder - success`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L124) (line 124)                      | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 3 of 3 with more signatures not inorder - success`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L141) (line 141) | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p6)                                                                                                                                 |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 2 of 3 - fail`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L163) (line 163)                                     | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P3`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p3), [`REQ-ENFPROOF-2-YZDCXM.T1.P5`](../../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm.t1.p5) |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 2 of 3 with one duplicate signature - fail`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L183) (line 183)        | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p1), [`REQ-ENFPROOF-2-YZDCXM.T1.P1`](../../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm.t1.p1) |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 3 of 3 with changed message - fail`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L203) (line 203)                | —                                                                                                                                                                                                                                                                                                              |
| [`StateChannelUtilLibrary > Treshold Signature Verification > 2 of 3 with one invalid signature length - fail`](../../../../../../../../test/V1/DiamondProxy/UtilityLibrary/SignatureVerification.test.ts#L223) (line 223)   | —                                                                                                                                                                                                                                                                                                              |
