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

One test calls `getBlockConfirmationStructMetadata` with block bytes that do not decode and asserts `undecodableBlock: true`, the original signature, and no block fields.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`LoggerUtils > marks block confirmation bytes that do not decode instead of throwing`](../../../../../../test/utils/LoggerUtils.test.ts#L40) (line 40)      | [`UNIT-TEST-LOGGER-UTILS-34-HNBMFQ.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-34-hnbmfq.p1)         |
| [`LoggerUtils > builds contract-call metadata from encoded calldata`](../../../../../../test/utils/LoggerUtils.test.ts#L149) (line 149)                      | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p1)         |
| [`LoggerUtils > names any calldata a peer can author without throwing`](../../../../../../test/utils/LoggerUtils.test.ts#L169) (line 169)                    | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p3)         |
| [`LoggerUtils > names a selector the SDK contract surface declares`](../../../../../../test/utils/LoggerUtils.test.ts#L183) (line 183)                       | [`UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-33-a11ybz.p2)         |
| [`LoggerUtils > getCustomEvmErrorMetadata > names every revert arg from the error ABI`](../../../../../../test/utils/LoggerUtils.test.ts#L195) (line 195)    | —                                                                                                                                                  |
| [`LoggerUtils > getCustomEvmErrorMetadata > keeps numeric revert args as bigints`](../../../../../../test/utils/LoggerUtils.test.ts#L214) (line 214)         | —                                                                                                                                                  |
| [`LoggerUtils > getCustomEvmErrorMetadata > an error without args still reports its name`](../../../../../../test/utils/LoggerUtils.test.ts#L245) (line 245) | —                                                                                                                                                  |
| [`LoggerUtils > getCustomEvmErrorMetadata > no decoded custom error yields no metadata`](../../../../../../test/utils/LoggerUtils.test.ts#L256) (line 256)   | —                                                                                                                                                  |
| [`LoggerUtils > reports each message block's previousBlockHash`](../../../../../../test/utils/LoggerUtils.test.ts#L267) (line 267)                           | —                                                                                                                                                  |
| [`LoggerUtils > pairs the submitted snapshot head with the computed reduction target`](../../../../../../test/utils/LoggerUtils.test.ts#L281) (line 281)     | —                                                                                                                                                  |
| [`LoggerUtils > formats known and unknown numeric enum members without changing strings`](../../../../../../test/utils/LoggerUtils.test.ts#L58) (line 58)    | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p1)         |
| [`LoggerUtils > logs objective time failure using captured time and previous timestamps`](../../../../../../test/utils/LoggerUtils.test.ts#L71) (line 71)    | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p2)         |
| [`LoggerUtils > omits previous timestamp fields for subjective time failures`](../../../../../../test/utils/LoggerUtils.test.ts#L117) (line 117)             | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza.p3)         |
| [`LoggerUtils > names an RPC node by scheme and host, without credentials, path or query`](../../../../../../test/utils/LoggerUtils.test.ts#L10) (line 10)   | [`UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P1`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-rpc-node-metadata-1-1wc176.p1) |
| [`LoggerUtils > names an unparseable RPC node URL without repeating it`](../../../../../../test/utils/LoggerUtils.test.ts#L23) (line 23)                     | [`UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P2`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-rpc-node-metadata-1-1wc176.p2) |
| [`LoggerUtils > names every RPC node of a list by scheme and host`](../../../../../../test/utils/LoggerUtils.test.ts#L29) (line 29)                          | [`UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P3`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-rpc-node-metadata-1-1wc176.p3) |
