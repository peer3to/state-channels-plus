# workerResourceLimits.ts

> **Source:** [src/evm/node/workerResourceLimits.ts](../../../../../../../src/evm/node/workerResourceLimits.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

No specified behavior: Node worker resource-limit configuration.

## UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8

Absent override uses 1024 MB.

- Setup: Real owner with scoped inputs.
- Oracle: Absent override uses 1024 MB.

- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P1` — Absent override uses 1024 MB
- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P2` — Positive finite override is used
- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P3` — Zero disables the cap
- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P4` — Negative override disables the cap
- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P5` — Infinite override uses the default
- [x] `UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P6` — Invalid override uses the default
