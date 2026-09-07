# LobbyMatchingValidation.ts — Source Report

> **Source:** [LobbyMatchingValidation.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingValidation.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Validate the optional matchmaking duration shared by signer and lobby service.

## Key design decisions

Null and omitted values mean no timeout; positive safe integers are returned unchanged. The original error message is retained for every rejected value. See [LobbyMatchingValidation.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingValidation.ts#L1).

## Inputs, outputs, state, and side effects

Validate the optional matchmaking duration shared by signer and lobby service. No timers are created here. Scheduling and timeout outcomes belong to LobbyMatchingService.

## Linked requirements

| Source file                                                                                                        | Specification IDs                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [LobbyMatchingValidation.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingValidation.ts#L1) | [`REQ-LOBBY-9-N894C0`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) |

Validates the optional caller timeout without creating a deadline for null or omitted input. This is a limited contribution; the callers own the complete policy.

## Assumptions, dependencies, trust boundaries, and limits

No timers are created here. Scheduling and timeout outcomes belong to LobbyMatchingService.

## Specification adherence

Validates the optional caller timeout without creating a deadline for null or omitted input.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                         | Implementation status | Evidence                                                                                                                                                                                                                                                                                            | Gap / divergence            |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-LOBBY-9-N894C0`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) | Covered               | **Here:** Validates the optional caller timeout without creating a deadline for null or omitted input. [source](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingValidation.ts#L1). **Other files:** [caller report](LobbyMatchingService.ts.md) owns the surrounding operation. | None for this contribution. |

## Component test obligations

| Unit test ID                                                                                              | Obligation               | Public entry and setup                                                                                                                                                 | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-lobby-matching-validation-32-4xzx5r"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R` | Match timeout validation | Invoke validateMatchTimeout directly; null/omitted and safe positive integers pass, zero/negative/fractional/unsafe/nonfinite values throw the exact existing message. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-lobby-matching-validation-32-4xzx5r.p1"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P1` — accepts omitted timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p2"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P2` — accepts null timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p3"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P3` — accepts positive integer timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p4"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P4` — accepts largest safe timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p5"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P5` — rejects zero timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p6"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P6` — rejects negative timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p7"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P7` — rejects fractional timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p8"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P8` — rejects unsafe timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p9"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P9` — rejects infinite timeout; <a id="unit-test-lobby-matching-validation-32-4xzx5r.p10"></a>`UNIT-TEST-LOBBY-MATCHING-VALIDATION-32-4XZX5R.P10` — rejects NaN timeout |

## Related source reports

- [LobbyMatchingService.ts.md](LobbyMatchingService.ts.md)
