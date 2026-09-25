# Trust Model — Implementation

> **Specification subject:** [specification/security/trust-model.md](../../../specification/security/trust-model.md)

## System design

**Current:** The implementation supports exactly one provider. Configuration exposes a single
`PROVIDER_URL` string ([src/utils/config.ts](../../../../../src/utils/config.ts#L1)), the event listener
subscribes through the single provider attached to the contract runner
([src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)), and the runtime
chain context derives its WebSocket connection from the same URL
([src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1)).
There is no multi-provider redundancy, cross-checking, or failover — **gap**.

**Current:** No watchtower, delegate, or third-party monitoring implementation exists in this
repository — **gap**. The SDK assumes the participant's own client
([src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1),
[src/disputeManager](../../../../../src/disputeManager)) is online to observe and respond. An
integrator deploying version one MUST either keep every honest participant's client online through
every contest window or operate an external delegate running the same SDK on the participant's
behalf.

## Migrated concrete material

The P2P layer is a **full mesh**: every participant connects directly to every other participant
(NetworkRpcRouter broadcasts each RPC to the manager’s current connections).
Messaging cost is therefore quadratic in the number of participants.

The dispute and fraud-proof system defends against the following without requiring participants to
trust one another. Enum sources:
contracts/V1/types/ProofTypes.sol.

## Gaps

- [`REQ-TRUST-4-KW24NF` (Version one REQUIRES a watchtower or equivalent continuously available delegate)](../../../specification/security/trust-model.md#req-trust-4-kw24nf)
  Partial: No watchtower implementation in repo.
