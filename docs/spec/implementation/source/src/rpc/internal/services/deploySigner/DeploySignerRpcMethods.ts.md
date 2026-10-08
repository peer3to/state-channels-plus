# DeploySignerRpcMethods.ts

> **Source:** [src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)

## UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11

Preserve deployment call bytes across the runtime boundary.

- Setup: Deploy a real MathStateMachine during SDK setup and call getSum through the supplied deployment signer.
- Oracle: The public signer returns the exact ABI-encoded zero value; the internal response uses encodedReturnData.

- [x] `UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P1` — inline SDK placement
- [x] `UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P2` — SDK worker placement
