# LoggerUtils.ts

> **Source:** [src/utils/LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts)

No specified behavior: Structured-log formatting helpers (dispute/auditing metadata projections, hash formatting).

## UNIT-TEST-LOGGER-UTILS-32-WMBBZA

Enum and failed time metadata

- Setup: Use a real logger store and captured time; inspect exact enum output, severity, message and metadata including optional prior timestamps.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1` — formats known and unknown numeric enum members without changing strings
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2` — logs objective time failure using captured time and previous timestamps
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3` — omits previous timestamp fields for subjective time failures
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P4` — Dispute proof metadata translates chain enum values 0, 1, 19 and 20 into the exact dispute-family names, including the two new counters, without using the overlapping block-fraud names
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P5` — Block-fraud metadata translates chain enum values 0, 1 and 4 into BlockDoubleSign, BlockInvalidStateTransition and ForgedInboundMessageBlock
- [x] `UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P6` — Unknown dispute proof value 99 and unknown block-fraud proof value 5 format as UNKNOWN(99) and UNKNOWN(5) in their separate metadata lookups

## UNIT-TEST-LOGGER-UTILS-33-A11YBZ

Contract-call metadata names its selector

- Setup: Call `getContractCallMetadata` with calldata for a function the SDK contract surface declares, for one it does not, and for data too short to hold a selector at all.
- Oracle: The returned selector, function name and calldata length; no other metadata field changes, and no input throws.

- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P1` — undeclared selector is reported as its own hex
- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P2` — declared selector is reported by name
- [x] `UNIT-TEST-LOGGER-UTILS-33-A11YBZ.P3` — calldata shorter than a selector is returned unchanged and does not throw

## UNIT-TEST-LOGGER-UTILS-34-HNBMFQ

Refused block confirmations log without decoding

- Setup: Call `getBlockConfirmationStructMetadata` with a confirmation whose block bytes do not decode.
- Oracle: The metadata marks `undecodableBlock: true`, keeps the confirmation hash and signatures, and has no block fields; the call does not throw.

- [x] `UNIT-TEST-LOGGER-UTILS-34-HNBMFQ.P1` — undecodable block bytes are marked instead of throwing

## UNIT-TEST-RPC-NODE-METADATA-1-1WC176

RPC endpoint redaction

- Setup: Call getRpcNodeMetadata and getRpcNodesMetadata with credential, path, query and unparseable inputs
- Oracle: Only scheme and host remain; an unparseable URL is not repeated

- [x] `UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P1` — userinfo, path and query dropped
- [x] `UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P2` — unparseable URL
- [x] `UNIT-TEST-RPC-NODE-METADATA-1-1WC176.P3` — every endpoint of a list
