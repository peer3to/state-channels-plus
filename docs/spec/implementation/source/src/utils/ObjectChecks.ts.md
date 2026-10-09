# ObjectChecks.ts

> **Source:** [src/utils/ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-OBJECT-CHECKS-1-BHAQSX

Method and compatible-shape core

- Setup: Exercise callable properties plus compatible service and Result values
- Oracle: Callable public shapes pass; missing/non-functions fail without constructor checks

- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P1` — own method
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P2` — inherited method
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P3` — non-function, missing, and non-object method inputs
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P4` — complete cross-module RPC service
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P5` — missing `createRPCMethods`
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P6` — native and cross-module ethers Result
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P7` — ordinary array without Result API
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P8` — proxy-wrapped ethers Result
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P9` — Object-prototype methods remain structural methods
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P10` — callable accessor evaluated once and accepted
- [x] `UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P11` — throwing method accessor propagates

## UNIT-TEST-OBJECT-CHECKS-2-VMPCB5

Property boundaries

- Setup: Check own/inherited, missing, null, primitive, and function-valued inputs
- Oracle: Only object values exposing the named own or inherited property pass

- [x] `UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P1` — own and inherited properties
- [x] `UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P2` — missing and non-object values rejected
- [x] `UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P3` — throwing proxy `has` trap propagates

## UNIT-TEST-OBJECT-CHECKS-3-3JXMP5

RPC-service rejection branches

- Setup: Remove or corrupt each operation in an otherwise complete public service shape
- Oracle: Missing service operations and invalid service/manager value kinds reject

- [x] `UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P1` — missing/null/primitive/function service
- [x] `UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P2` — non-callable `createRPCMethods`
- [x] `UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P3` — missing/null/primitive/function `router`
- [x] `UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P4` — missing/non-callable `runRPC`
- [x] `UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P5` — An actual runtime service passes structural service recognition through callable construction/dispatch and its router, without a peer manager dependency

## UNIT-TEST-OBJECT-CHECKS-4-NVX8KE

Result rejection branches

- Setup: Corrupt the array requirement and each required Result method
- Oracle: Non-arrays and arrays with missing/non-callable Result operations reject

- [x] `UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P1` — method-shaped non-array/null/primitive rejected
- [x] `UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P2` — each missing Result method
- [x] `UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P3` — each non-callable Result method
