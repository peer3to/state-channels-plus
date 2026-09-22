# channelKey.ts

> **Source:** [channelKey.ts](../../../../../../src/utils/channelKey.ts#L1)
>
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)

## UNIT-TEST-CHANNEL-KEY-32-YJ2A0A

Channel key conversion

- Setup: Case variants share a key and non-string inputs retain permissive String conversion without validation.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P1` — shares an identity across hex case variants
- [x] `UNIT-TEST-CHANNEL-KEY-32-YJ2A0A.P2` — preserves permissive string conversion without validation
