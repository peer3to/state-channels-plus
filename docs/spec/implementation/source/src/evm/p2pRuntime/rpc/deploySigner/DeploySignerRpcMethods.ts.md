# DeploySignerRpcMethods.ts — Source Report

> **Source:** [DeploySignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The deploy signer's operations as endpoints: address, nonce, name resolution, a call, and a deploy
transaction that is mined before it is answered.

## Key design decisions

- **A deploy reply is the mined transaction**, hash, addresses, data and receipt, so the bridge
  signer's `wait()` has nothing left to wait for.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                            |
| ------------ | ------------------------------------------------------------------- |
| Inputs       | Transaction requests; a name.                                       |
| Outputs      | Address, nonce, resolved name, call result, a deployed transaction. |
| Owned state  | None.                                                               |
| Side effects | Deploys into the host's local VM.                                   |

## Linked requirements

| Source file                                                                                                           | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [DeploySignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerRpcMethods.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Only the setup phase calls these; the host is reachable before `deployComplete`.

## Specification adherence

- The local VM has one owner ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** every method ends on `host.deploySigner`. | None.            |

## Related source reports

- [DeploySignerService.ts.md](./DeploySignerService.ts.md)
- [../../../signer/DeploymentBridgeSigner.ts.md](../../../signer/DeploymentBridgeSigner.ts.md) — the caller.
