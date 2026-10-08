# Protocol Lifecycle — Implementation

> **Specification subject:** [specification/settlement/lifecycle.md](../../../specification/settlement/lifecycle.md)

## System design

### Concrete lifecycle component mapping

- Opening is wired through `StateChannelManagerProxy.open`, threshold verification, the consumer
  deposit/genesis hooks, the chain signer, and the channel-open event handler.
- Continuous execution is owned by `StateManager`, `BlockQueueManager`, validation strategies,
  `AgreementManager`, `P2PManager`, and the configured transports; `postBlockCalldata` is the
  base-layer fallback.
- Dispute fallback is split across `DisputeManager`, `DisputeValidationService`, the reduction
  services, `DisputeManagerFacet`, `DisputeVerificationFacet`, `FraudProofFacet`, and
  `DisputeFraudProofFacet`.
- Settlement is assembled by `SnapshotUpdateService` and applied through `StateSnapshotFacet` and
  the consumer withdrawal hook. Benign races include another peer's snapshot landing first.

Current: [`MathStateMachine.leaveChannel`](../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol#L112)
is exactly this — a normal transition that removes the caller and records an `ExitChannel`
outbound message. After a transition in which the local participant left, the SDK waits
`agreementTime` and then either posts the finalized snapshot (everyone signed) or opens a
self-removal dispute (`StateManager.startMaybeExitOnChain`).
