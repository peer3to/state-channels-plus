# test/utils/SignatureUtils.test.ts — Test Report

> **Test file:** [test/utils/SignatureUtils.test.ts](../../../../../../test/utils/SignatureUtils.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SignatureUtils.ts](../../../../implementation/source/src/utils/SignatureUtils.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `SignatureUtils` with a real hardhat signer: `signMsg` over random 48-byte hex
and `getSignerAddress` recovery back to the signer's address, then a cross-component agreement
check — a factory block signed via `signBlock` recovers to the same address through both
`SignatureUtils.getSignerAddress(block.encode(), sig)` and `Block.signatureToAddress(sig)`,
demonstrating the two recovery paths hash the same canonical-encoding digest. Out of scope:
tampered messages/signatures, signature-encoding malleation, on-chain recovery agreement, and
signing every protocol object class. [`UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58`](../../../../implementation/source/src/utils/SignatureUtils.ts.md#unit-test-signature-utils-1-9zhm58) now defines one round-trip
permutation per object class plus tamper/malleation cases, but none is assignable in full: the
tamper/malleation cases are absent, the only signed object class is a block, and its signature
comes from `Block.sign` rather than `SignatureUtils.signBlock`, so even the block round trip
(`.P1`) never drives the component's sign side.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                    | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`SignatureUtils.getSignerAddress > recovers the signer of a message`](../../../../../../test/utils/SignatureUtils.test.ts#L17) (line 17)                                           | —      |
| [`SignatureUtils.getSignerAddress > agrees with Block.signatureToAddress for a block (same recovery key space)`](../../../../../../test/utils/SignatureUtils.test.ts#L25) (line 25) | —      |
