# LoggerUtils.test.ts

Test file: [test/utils/LoggerUtils.test.ts](../../../../../../test/utils/LoggerUtils.test.ts)
Exercises: [LoggerUtils.ts](../../../../implementation/source/src/utils/LoggerUtils.ts.md)

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

## Tests

- `marks block confirmation bytes that do not decode instead of throwing`: UNIT-TEST-LOGGER-UTILS-34-HNBMFQ.P1
- `builds contract-call metadata from encoded calldata`: UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1
- `names any calldata a peer can author without throwing`: UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3
- `names a selector the SDK contract surface declares`: UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2
- `names every revert arg from the error ABI`: none
- `keeps numeric revert args as bigints`: none
- `an error without args still reports its name`: none
- `no decoded custom error yields no metadata`: none
- `reports each message block's previousBlockHash`: none
- `pairs the submitted snapshot head with the computed reduction target`: none
- `formats known and unknown numeric enum members without changing strings`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1
- `logs objective time failure using captured time and previous timestamps`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2
- `omits previous timestamp fields for subjective time failures`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3
- `names an RPC node by scheme and host, without credentials, path or query`: UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P1
- `names an unparseable RPC node URL without repeating it`: UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P2
- `names every RPC node of a list by scheme and host`: UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P3
