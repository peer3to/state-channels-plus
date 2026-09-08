# test/utils/EthersResultProxy.test.ts — Test Report

> **Test file:** [test/utils/EthersResultProxy.test.ts](../../../../../../test/utils/EthersResultProxy.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EthersResultProxy.ts](../../../../implementation/source/src/utils/EthersResultProxy.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the complete public normalization proxy. It covers recursive standalone value
conversion, direct and static contract calls, synchronous and asynchronous results, input
conversion, method receiver and metadata preservation, unchanged rejection propagation, every
supported listener registration/removal verb, duplicate listener removal, event-log prototype
preservation, query-filter conversion, and unrelated member passthrough.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each permutation is assigned to at most one
test declaration.

| Test declaration                                                                                                                                                                      | Covers                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`EthersResultProxy > recursively converts Results in arrays and plain objects while retaining clean branches`](../../../../../../test/utils/EthersResultProxy.test.ts#L13) (line 13) | [`UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P4`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-1-1brj8d.p4) |
| [`EthersResultProxy > converts a synchronous direct method result`](../../../../../../test/utils/EthersResultProxy.test.ts#L36) (line 36)                                             | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P1`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p1) |
| [`EthersResultProxy > converts an asynchronous direct method result`](../../../../../../test/utils/EthersResultProxy.test.ts#L48) (line 48)                                           | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P2`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p2) |
| [`EthersResultProxy > converts a staticCall result`](../../../../../../test/utils/EthersResultProxy.test.ts#L59) (line 59)                                                            | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P3`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p3) |
| [`EthersResultProxy > converts Result arguments before direct and static calls`](../../../../../../test/utils/EthersResultProxy.test.ts#L70) (line 70)                                | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P4`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p4) |
| [`EthersResultProxy > preserves method properties and invokes wrapped calls with the contract receiver`](../../../../../../test/utils/EthersResultProxy.test.ts#L94) (line 94)        | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P5`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p5) |
| [`EthersResultProxy > propagates a wrapped method rejection unchanged`](../../../../../../test/utils/EthersResultProxy.test.ts#L106) (line 106)                                       | [`UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P6`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-2-ra8yec.p6) |
| [`EthersResultProxy > converts on listener arguments and preserves event-log identity fields`](../../../../../../test/utils/EthersResultProxy.test.ts#L122) (line 122)                | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P1`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p1) |
| [`EthersResultProxy > keeps once listener semantics while converting arguments`](../../../../../../test/utils/EthersResultProxy.test.ts#L148) (line 148)                              | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P2`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p2) |
| [`EthersResultProxy > converts addListener arguments`](../../../../../../test/utils/EthersResultProxy.test.ts#L165) (line 165)                                                        | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P3`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p3) |
| [`EthersResultProxy > keeps prependListener ordering while converting arguments`](../../../../../../test/utils/EthersResultProxy.test.ts#L181) (line 181)                             | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P4`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p4) |
| [`EthersResultProxy > keeps prependOnceListener ordering and one-shot semantics`](../../../../../../test/utils/EthersResultProxy.test.ts#L199) (line 199)                             | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P5`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p5) |
| [`EthersResultProxy > removes an on listener through its original callback`](../../../../../../test/utils/EthersResultProxy.test.ts#L212) (line 212)                                  | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P6`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p6) |
| [`EthersResultProxy > removes repeated registrations through the original callback`](../../../../../../test/utils/EthersResultProxy.test.ts#L227) (line 227)                          | [`UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P7`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-3-b08xre.p7) |
| [`EthersResultProxy > converts every event log returned by queryFilter`](../../../../../../test/utils/EthersResultProxy.test.ts#L244) (line 244)                                      | [`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P1`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-4-4ykw7t.p1) |
| [`EthersResultProxy > returns a non-array queryFilter result unchanged`](../../../../../../test/utils/EthersResultProxy.test.ts#L266) (line 266)                                      | [`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P2`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-4-4ykw7t.p2) |
| [`EthersResultProxy > passes ordinary methods and non-function properties through`](../../../../../../test/utils/EthersResultProxy.test.ts#L275) (line 275)                           | [`UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P3`](../../../../implementation/source/src/utils/EthersResultProxy.ts.md#unit-test-ethers-result-proxy-4-4ykw7t.p3) |
