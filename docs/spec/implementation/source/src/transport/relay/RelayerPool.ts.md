# RelayerPool.ts

> **Source:** [src/transport/relay/RelayerPool.ts](../../../../../../../src/transport/relay/RelayerPool.ts)
>
> **Design views:** [transport upgrade](../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`REQ-UPG-5-YQV7MJ` (Relay retries converge without stale work)](../../../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj)

## UNIT-TEST-RELAYER-POOL-1-F0230R

Relay selection and retry lifecycle

- Setup: Use the public pool with scoped fake time and randomness; report failures, exhaustion, paired events, and success
- Oracle: URL and delay bounds hold; one retry exists; success cancels pending reconnect work

- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P1` — empty pool
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P2` — non-excluded selection
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P3` — failover jitter
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P4` — exhaustion and reset
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P5` — backoff cap
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P6` — success reset
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P7` — pending retry cancellation
- [x] `UNIT-TEST-RELAYER-POOL-1-F0230R.P8` — paired-event deduplication
