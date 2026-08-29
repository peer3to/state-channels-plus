# test/unit/LocalDiamondBinding.test.ts — Test Report

> **Test file:** [test/unit/LocalDiamondBinding.test.ts](../../../../../../test/unit/LocalDiamondBinding.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [localDiamond.ts](../../../../implementation/source/src/utils/localDiamond.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Six pure cases over the client binding for the local mirror — no chain, no harness session, no
deployment. They use the two real generated ABIs (`LocalDiamond__factory.abi` and
`StateChannelManagerInterface__factory.abi`) and the module's own exports, so a change to either
Solidity surface flows into the assertions through typechain.

The first two cases are the merge contract: every `type:sighash` fragment key of both generated
ABIs is present in `localDiamondAbi`, and no key appears twice. Together they pin exactly what the
de-duplication must guarantee — completeness and uniqueness — without asserting which of two
signature-identical fragments survives, which is not observable.

The third case proves every generated manager error appears exactly once. The next two are the
reason the merge exists: a selector the proxy routes to a facet
(`getStateSnapshot`, absent from `LocalDiamond`'s own ABI) and a selector only `LocalDiamond`
declares (`getTotalDeposits`) both encode through the binding, byte-identical to the encoding
produced by their own generated interface. The last case pins the read-only construction path: a
`null` runner yields a binding whose `target` is the given address and whose `runner` is `null`.

Scope limit: nothing here calls the mirror. The address is a placeholder, so the suite proves the
ABI the binding carries, not that the deployed mirror answers it — that half is
`test/V1/UniversalDeployment.test.ts`, which drives real routed and `LocalDiamond`-only calls
through `connectLocalDiamond` against a deployed mirror.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                               | Covers                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`localDiamond binding > carries every fragment of both generated ABIs`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L21) (line 21)                | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P1`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p1) |
| [`localDiamond binding > keeps one fragment for a signature declared by both ABIs`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L33) (line 33)     | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P2`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p2) |
| [`localDiamond binding > includes every manager error once`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L37) (line 37)                            | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P8`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p8) |
| [`localDiamond binding > encodes a call to a function the proxy routes to a facet`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L43) (line 43)     | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P3`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p3) |
| [`localDiamond binding > encodes a call to a function only the local diamond declares`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L59) (line 59) | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P4`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p4) |
| [`localDiamond binding > connects a read-only binding when no runner is given`](../../../../../../test/unit/LocalDiamondBinding.test.ts#L75) (line 75)         | [`UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P5`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-local-diamond-binding-1-w8atc1.p5) |
