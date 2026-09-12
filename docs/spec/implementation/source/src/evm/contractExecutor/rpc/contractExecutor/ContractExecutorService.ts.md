# ContractExecutorService.ts — Source Report

> **Source:** [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The worker's executor and everything held around it, from init to dispose: `init` rebuilds config
and the logger in this worker, registers the link to the thread above before anything that can
fail, files the worker under the owner's identity carried in the call, builds the EVM and starts
the monitor; `disposeExecutor` stops the monitor, drops a logger this worker owns and lets the link
go once the reply is out. The routable endpoints hold none of it.

## Key design decisions

- **The link before the EVM.** A crash while the EVM is still being built already has a way up
  ([`init`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts#L62)).
- **The owner's identity is a parameter, not a race.** The cast the owner's link makes on
  registration may cross before this link exists; `init` carries the same context, applied by tree
  side like any inbound one, so link and init may be posted in either order.
- **Close after the reply** — `disposeExecutor` hands the transport its own `closeAfterReply`, so
  the reply is out before the port goes and the drained loop exits on its own
  ([`disposeExecutor`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts#L128)).
- **A supplied logger stays the caller's.** One built in `init` is this worker's own and leaves the
  bus with it.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| Inputs       | The `init` parameters (precompile manifests, config, the owner's context, the host's clock adjustment) and the link they arrived on. |
| Outputs      | The executor every call endpoint reaches through `requireExecutor`.                   |
| Owned state  | The executor, the worker's logger and whether this worker owns it.                    |
| Side effects | Config rebuilt; logger, link, EVM and monitor created and torn down; the port closed. |

## Linked requirements

| Source file                                                                                                                       | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- **Two internal seams for a scripted worker.** `monitorOptions` always starts the monitor on its
  own threshold rather than the runtime config, and `configOverrides` forces config values over the
  ones `init` carried, so a scripted worker can stay silent. Production leaves both unset.

- One executor per worker; a second `init` replaces it and leaks the first.

## Specification adherence

- One owner of the EVM state ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                          | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** the executor lives here and nowhere else in the worker. | None.            |

## Related source reports

- [ContractExecutorRpcMethods.ts.md](./ContractExecutorRpcMethods.ts.md) — the endpoints and the family.
- [../ContractExecutorRoot.ts.md](../ContractExecutorRoot.ts.md)
