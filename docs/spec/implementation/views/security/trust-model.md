# Trust Model — Implementation

> **Specification subject:** [specification/security/trust-model.md](../../../specification/security/trust-model.md)

## System design

**Current:** The implementation accepts an ordered list of RPC endpoints. Configuration exposes
`PROVIDER_URLS`, falling back to the single `PROVIDER_URL` ([src/utils/config.ts](../../../../../src/utils/config.ts#L1)),
and the runtime chain context opens one reconnecting node per endpoint
([src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1)).
Each request goes to the first connected endpoint and fails over when it drops
([MultiRpcProvider](../../source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md)); the event listener
subscribes on every endpoint and catches up after a reconnect
([src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)). Answers are not
cross-checked between endpoints: every listed endpoint is trusted. A listed endpoint, a backup
included, can forge logs on its subscription and so advance the completed-block watermark, after
which honest streamed logs below it are dropped; cross-endpoint verification is out of scope —
**accepted limit**.

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
