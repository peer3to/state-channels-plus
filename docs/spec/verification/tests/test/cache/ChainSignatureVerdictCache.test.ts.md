# test/cache/ChainSignatureVerdictCache.test.ts — Test Report

> **Test file:** [test/cache/ChainSignatureVerdictCache.test.ts](../../../../../../test/cache/ChainSignatureVerdictCache.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ChainSignatureVerdictCache.ts](../../../../implementation/source/src/cache/ChainSignatureVerdictCache.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the chain-verdict memo directly with real wallet signatures over random digests.
It checks that an unknown pair has no verdict, that accepted and rejected verdicts come back for
their own pairs, that the digest is part of the key, and that the configured size bound evicts the
oldest entry while newer ones stay. The cache is reset before each test, and the eviction test
restores the global size setting in `finally`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration | Covers |
| --- | --- |
| [`ChainSignatureVerdictCache > has no verdict for a pair it was never told about`](../../../../../../test/cache/ChainSignatureVerdictCache.test.ts#L23) (line 23) | [`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P1`](../../../../implementation/source/src/cache/ChainSignatureVerdictCache.ts.md#unit-test-chain-signature-verdict-cache-1-9h0xz0.p1) |
| [`ChainSignatureVerdictCache > returns the stored verdict for its own pair, rejected and accepted alike`](../../../../../../test/cache/ChainSignatureVerdictCache.test.ts#L30) (line 30) | [`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P2`](../../../../implementation/source/src/cache/ChainSignatureVerdictCache.ts.md#unit-test-chain-signature-verdict-cache-1-9h0xz0.p2) |
| [`ChainSignatureVerdictCache > keys on the message too: the same signature over another message has no verdict`](../../../../../../test/cache/ChainSignatureVerdictCache.test.ts#L43) (line 43) | [`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P3`](../../../../implementation/source/src/cache/ChainSignatureVerdictCache.ts.md#unit-test-chain-signature-verdict-cache-1-9h0xz0.p3) |
| [`ChainSignatureVerdictCache > bounds size and evicts the oldest past SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/ChainSignatureVerdictCache.test.ts#L51) (line 51) | [`UNIT-TEST-CHAIN-SIGNATURE-VERDICT-CACHE-1-9H0XZ0.P4`](../../../../implementation/source/src/cache/ChainSignatureVerdictCache.ts.md#unit-test-chain-signature-verdict-cache-1-9h0xz0.p4) |
