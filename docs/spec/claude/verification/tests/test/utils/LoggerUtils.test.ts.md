# test/utils/LoggerUtils.test.ts — Test Report

> **Test file:** [test/utils/LoggerUtils.test.ts](../../../../../../../test/utils/LoggerUtils.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LoggerUtils.ts](../../../../implementation/source/src/utils/LoggerUtils.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite calls `LoggerUtils`' static metadata builders directly with factory-built domain
values and asserts exact metadata shapes by deep equality. `getContractCallMetadata` reduces
encoded calldata to address, 4-byte selector, and byte length. `getCustomEvmErrorMetadata` names
every revert argument from the decoded error ABI itself (no hardcoded field list), keeps numeric
revert args as bigints for the stringifying log pipeline, reports a bare name for an argument-less
error, and yields `undefined` for `null`/`undefined` input (the `tryDecodeCustomError` miss
case). `getMessageBlockMetadata` surfaces each message block's `previousBlockHash` — the linkage
`_verifyInboundMessageBlocks` walks — and `getReductionInboundMetadata` pairs the submitted
snapshot's inbound head with the computed reduction target plus per-block metadata. The logger
itself, encoding, and upload are out of scope. The seed pool defines no permutations for this
component, so no test IDs are assignable here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                              | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`LoggerUtils > builds contract-call metadata from encoded calldata`](../../../../../../../test/utils/LoggerUtils.test.ts#L7) (line 7)                        | —      |
| [`LoggerUtils > getCustomEvmErrorMetadata > names every revert arg from the error ABI`](../../../../../../../test/utils/LoggerUtils.test.ts#L26) (line 26)    | —      |
| [`LoggerUtils > getCustomEvmErrorMetadata > keeps numeric revert args as bigints`](../../../../../../../test/utils/LoggerUtils.test.ts#L45) (line 45)         | —      |
| [`LoggerUtils > getCustomEvmErrorMetadata > an error without args still reports its name`](../../../../../../../test/utils/LoggerUtils.test.ts#L76) (line 76) | —      |
| [`LoggerUtils > getCustomEvmErrorMetadata > no decoded custom error yields no metadata`](../../../../../../../test/utils/LoggerUtils.test.ts#L87) (line 87)   | —      |
| [`LoggerUtils > reports each message block's previousBlockHash`](../../../../../../../test/utils/LoggerUtils.test.ts#L98) (line 98)                           | —      |
| [`LoggerUtils > pairs the submitted snapshot head with the computed reduction target`](../../../../../../../test/utils/LoggerUtils.test.ts#L112) (line 112)   | —      |
