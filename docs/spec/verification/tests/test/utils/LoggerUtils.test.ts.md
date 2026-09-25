# test/utils/LoggerUtils.test.ts — Test Report

> **Test file:** [test/utils/LoggerUtils.test.ts](../../../../../../test/utils/LoggerUtils.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LoggerUtils.ts](../../../../implementation/source/src/utils/LoggerUtils.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Use a real logger store and captured time; inspect exact enum output, severity, message and metadata including optional prior timestamps.

The suite calls `LoggerUtils`' static metadata builders directly with factory-built domain
values and asserts exact metadata shapes by deep equality. `getContractCallMetadata` reduces
encoded calldata to address, 4-byte selector, and byte length. `getCustomEvmErrorMetadata` names
every revert argument from the decoded error ABI itself (no hardcoded field list), keeps numeric
revert args as bigints for the stringifying log pipeline, reports a bare name for an argument-less
error, and yields `undefined` for `null`/`undefined` input (the `tryDecodeCustomError` miss
case). `getMessageBlockMetadata` surfaces each message block's `previousBlockHash` — the linkage
`_verifyInboundMessageBlocks` walks — and `getReductionInboundMetadata` pairs the submitted
snapshot's inbound head with the computed reduction target plus per-block metadata. The logger
itself, encoding, and upload are out of scope. `getContractCallMetadata` is checked on both sides of
selector naming: calldata for a function no SDK contract declares keeps the selector hex as the
name, and a selector the merged contract surface declares comes back named. A third case feeds it
the shapes peer-authored calldata can actually take — `"0x"`, a single byte, and an unknown
four-byte selector — and requires each to come back as its own name with nothing thrown, since
this helper runs on every block validation.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`LoggerUtils > builds contract-call metadata from encoded calldata`](../../../../../../test/utils/LoggerUtils.test.ts#L101) (line 101)                      | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p1) |
| [`LoggerUtils > names any calldata a peer can author without throwing`](../../../../../../test/utils/LoggerUtils.test.ts#L121) (line 121)                    | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p3) |
| [`LoggerUtils > names a selector the SDK contract surface declares`](../../../../../../test/utils/LoggerUtils.test.ts#L135) (line 135)                       | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p2) |
| [`LoggerUtils > getCustomEvmErrorMetadata > names every revert arg from the error ABI`](../../../../../../test/utils/LoggerUtils.test.ts#L147) (line 147)    | —                                                                                                                                          |
| [`LoggerUtils > getCustomEvmErrorMetadata > keeps numeric revert args as bigints`](../../../../../../test/utils/LoggerUtils.test.ts#L166) (line 166)         | —                                                                                                                                          |
| [`LoggerUtils > getCustomEvmErrorMetadata > an error without args still reports its name`](../../../../../../test/utils/LoggerUtils.test.ts#L197) (line 197) | —                                                                                                                                          |
| [`LoggerUtils > getCustomEvmErrorMetadata > no decoded custom error yields no metadata`](../../../../../../test/utils/LoggerUtils.test.ts#L208) (line 208)   | —                                                                                                                                          |
| [`LoggerUtils > reports each message block's previousBlockHash`](../../../../../../test/utils/LoggerUtils.test.ts#L233) (line 233)                           | —                                                                                                                                          |
| [`LoggerUtils > pairs the submitted snapshot head with the computed reduction target`](../../../../../../test/utils/LoggerUtils.test.ts#L233) (line 233)     | —                                                                                                                                          |
| [`LoggerUtils > formats known and unknown numeric enum members without changing strings`](../../../../../../test/utils/LoggerUtils.test.ts#L10) (line 10)    | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p1) |
| [`LoggerUtils > logs objective time failure using captured time and previous timestamps`](../../../../../../test/utils/LoggerUtils.test.ts#L23) (line 23)    | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p2) |
| [`LoggerUtils > omits previous timestamp fields for subjective time failures`](../../../../../../test/utils/LoggerUtils.test.ts#L69) (line 69)               | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p3) |
