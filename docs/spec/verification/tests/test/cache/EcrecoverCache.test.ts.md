# test/cache/EcrecoverCache.test.ts — Test Report

> **Test file:** [test/cache/EcrecoverCache.test.ts](../../../../../../test/cache/EcrecoverCache.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EcrecoverCache.ts](../../../../implementation/source/src/cache/EcrecoverCache.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs the ecrecover precompile (address `0x01`) through `evm.runCall` with a real
`(digest, v, r, s)` from a random wallet's signing key, using the shared helpers in
`test/fixtures/RecoveryCacheFixture.ts`. The memoized EVM comes from `createEvm` (which installs
the memo); the reference is a plain `EVM.create()`. A recording variant counts the real recoveries
the memo lets through. The memo is reset before each test. Each run is compared with the plain
EVM on the whole result: output, gas used, and exception. The cases cover a valid signature, repeats
and a second signature (entry count), repeats after a fill (one real recovery), each half of the
key in a cache already holding two other entries — one signature under two digests, and two
wallets' signatures under one digest, each called twice and compared with the plain EVM, with one
real recovery per distinct input — the precompile's
own acceptance boundaries — a high `s` (accepted by the precompile), a `v` other than 27/28, a zero
`r` (no key) — and gas one below and exactly at the precompile cost, plus a memo hit below the
cost. With `SIGNER_RECOVERY_CACHE_MAX` lowered to 3, the eviction case checks insertion-order
eviction by the recorded recoveries and that an evicted input recovers the plain EVM's result. The
last case zeroes the key returned by a miss and by a hit and checks that a later hit still returns
the real key.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration | Covers |
| --- | --- |
| [`EcrecoverCache > recovers the same signer as an EVM without the memo`](../../../../../../test/cache/EcrecoverCache.test.ts#L23) (line 23) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P1`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p1) |
| [`EcrecoverCache > memoizes by (digest, signature) — repeats add no entries and return the same signer`](../../../../../../test/cache/EcrecoverCache.test.ts#L35) (line 35) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P2`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p2) |
| [`EcrecoverCache > repeated calls after a cache fill match the plain EVM in output and gas, with one real recovery`](../../../../../../test/cache/EcrecoverCache.test.ts#L48) (line 48) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P6`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p6) |
| [`EcrecoverCache > keys on the digest — one signature under two digests matches the plain EVM for each in a filled cache`](../../../../../../test/cache/EcrecoverCache.test.ts#L60) (line 60) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P10`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p10) |
| [`EcrecoverCache > keys on the signature — two signatures under one digest match the plain EVM for each in a filled cache`](../../../../../../test/cache/EcrecoverCache.test.ts#L90) (line 90) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P11`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p11) |
| [`EcrecoverCache > a high-s signature matches the plain EVM in output and gas`](../../../../../../test/cache/EcrecoverCache.test.ts#L123) (line 123) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P7`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p7) |
| [`EcrecoverCache > an invalid v matches the plain EVM in output and gas, and keeps no entry`](../../../../../../test/cache/EcrecoverCache.test.ts#L144) (line 144) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P8`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p8) |
| [`EcrecoverCache > a signature that recovers no key matches the plain EVM in output and gas, and keeps no entry`](../../../../../../test/cache/EcrecoverCache.test.ts#L157) (line 157) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P3`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p3) |
| [`EcrecoverCache > insufficient precompile gas matches the plain EVM on both sides of the precompile cost`](../../../../../../test/cache/EcrecoverCache.test.ts#L173) (line 173) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P9`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p9) |
| [`EcrecoverCache > evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly`](../../../../../../test/cache/EcrecoverCache.test.ts#L206) (line 206) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P5`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p5) |
| [`EcrecoverCache > mutating a returned public key does not change a later recovery`](../../../../../../test/cache/EcrecoverCache.test.ts#L238) (line 238) | [`UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P4`](../../../../implementation/source/src/cache/EcrecoverCache.ts.md#unit-test-ecrecover-cache-1-s0eeq5.p4) |
