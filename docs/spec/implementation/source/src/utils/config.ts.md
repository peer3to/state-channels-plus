# config.ts — Source Report

> **Source:** [src/utils/config.ts](../../../../../../src/utils/config.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

Runtime configuration surface (env-derived flags incl. VM_DEDICATED_THREAD, debug gates).

## Key design decisions

CRASH_LOG_UPLOAD_COALESCE_MS defaults to 3,000 ms and controls deterministic gossip coalescing independently of random upload jitter. The obsolete per-hop flush timeout is removed; uploader HTTP deadlines and retries are unchanged.

1. **The gas-usage read bound is configuration, not a constant.** `GAS_USAGE_SETTLE_MS`
   (2,000 ms) caps how long a gas-usage read — the public table read and the disposal report —
   waits for outstanding receipts before it answers with the rows already recorded; a receipt still
   pending then shows up on a later read. It bounds a wait on a chain a deployment may not control,
   which is why it is tunable per deployment rather than compiled in. A receipt wait itself has no
   bound: a transaction counts whenever it mines, and recorder disposal ends the waits still open.
   See [GAS_USAGE_SETTLE_MS](../../../../../../src/utils/config.ts#L38).
2. **`EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS` is a per-context throw, not a process kill.** The monitor throws in its own context; the sdk and contract-executor workers report that throw to the host as a detached error and keep serving, inline it surfaces like any uncaught error. The same flag enables the `##E2E_TIMING##` diagnostics.
3. **The join authorization lifetime is configuration.** `JOIN_CHANNEL_DEADLINE_SECONDS`
   ([#L33](../../../../../../src/utils/config.ts#L33)) defaults to `DEFAULT_JOIN_CHANNEL_DEADLINE_SECONDS` = 120 chain seconds
   ([#L50](../../../../../../src/utils/config.ts#L50), [#L71](../../../../../../src/utils/config.ts#L71)). `JoinChannelService.prepareJoinChannelConfirmation` adds it to
   chain time to set the join's `deadlineTimestamp`. The value is local to the joiner (countersigners only
   check that the deadline has not passed) and it bounds how long a submitted join can land, so it also
   bounds how long a pending joiner stays pending for an unseen join and how long a terminal leave waits for
   it. The default constant lives here and is re-exported from the network services index, so callers and
   tests read one value. It follows the ordinary precedence, so the environment and explicit overrides can
   shorten it (tests do).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                        | Specification IDs                                                                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [config.ts](../../../../../../src/utils/config.ts) | [`REQ-CONFIG-1-PDHA8T`](../../../../specification/runtime/configuration.md#req-config-1-pdha8t), [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the views.

# Terminal leave contribution

`LEAVE_CHANNEL_WATCHDOG_MS` is a runtime-local liveness bound with a 15,000 millisecond default. It is configurable and is not an on-chain timing parameter. This contributes to [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

# Join authorization lifetime contribution

`JOIN_CHANNEL_DEADLINE_SECONDS` is a runtime-local choice with a 120 second default. It sets the deadline of
every join this runtime prepares and so bounds the pending-join window and the terminal leave's join wait.
This contributes to [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75); the test evidence is mapped to [`UNIT-TEST-JOIN-CHANNEL-SERVICE-1-32GSQS.P13`](../rpc/network/services/joinChannel/JoinChannelService.ts.md#unit-test-join-channel-service-1-32gsqs.p13).
