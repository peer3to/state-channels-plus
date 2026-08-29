# RelayerPool.ts — Source Report

> **Source:** [src/transport/relay/RelayerPool.ts](../../../../../../../src/transport/relay/RelayerPool.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [transport upgrade](../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Responsibility and observable boundary

Selects relay URLs and owns the retry lifecycle for the Holepunch relay client: failed URL
exclusion, jitter, bounded full-pool backoff, paired-event deduplication, and success reset.

## Key design decisions

1. **Production time and randomness are direct dependencies.** Tests scope fake timers and
   `Math.random`; production construction has no test-only options.
2. **A retry has one owned timer.** Success clears that timer before resetting pool state.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                     |
| ------------ | ------------------------------------------------------------ |
| Inputs       | Configured URLs, connection success, and connection failure. |
| Outputs      | Selected URL and one delayed reconnect callback.             |
| Owned state  | Excluded URLs, exhaustion count, and one pending timer.      |
| Side effects | Schedules or cancels one timer and logs relay selection.     |

## Linked requirements

| Source file                                                               | Specification IDs                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [RelayerPool.ts](../../../../../../../src/transport/relay/RelayerPool.ts) | [`REQ-UPG-5-YQV7MJ`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj) |

## Assumptions, dependencies, trust boundaries, and limits

- The configured URL list is trusted configuration. Relay failure and close events may arrive as a
  pair for one connection and must request only one retry.

## Specification adherence

- Failed relays are excluded until exhaustion; jitter and exponential backoff are bounded.
- Success resets exclusions/backoff and cancels pending retry work.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                     | Implementation status | Evidence                                                                                                                                                                                          | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-UPG-5-YQV7MJ`](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj) | Covered               | **Here:** URL selection, exclusion reset, bounded delay, and timer ownership. **Other files:** [HolepunchRelay](../../../HolepunchRelay.ts.md) reports connection events and performs reconnects. | None.            |

## Component test obligations

| Unit test ID                                                                  | Obligation                          | Public entry and setup                                                                                            | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-relayer-pool-1-f0230r"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R` | Relay selection and retry lifecycle | Use the public pool with scoped fake time and randomness; report failures, exhaustion, paired events, and success | URL and delay bounds hold; one retry exists; success cancels pending reconnect work | <a id="unit-test-relayer-pool-1-f0230r.p1"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P1` — empty pool; <a id="unit-test-relayer-pool-1-f0230r.p2"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P2` — non-excluded selection; <a id="unit-test-relayer-pool-1-f0230r.p3"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P3` — failover jitter; <a id="unit-test-relayer-pool-1-f0230r.p4"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P4` — exhaustion and reset; <a id="unit-test-relayer-pool-1-f0230r.p5"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P5` — backoff cap; <a id="unit-test-relayer-pool-1-f0230r.p6"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P6` — success reset; <a id="unit-test-relayer-pool-1-f0230r.p7"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P7` — pending retry cancellation; <a id="unit-test-relayer-pool-1-f0230r.p8"></a>`UNIT-TEST-RELAYER-POOL-1-F0230R.P8` — paired-event deduplication. |

## Related source reports

- [HolepunchRelay](../../../HolepunchRelay.ts.md).
