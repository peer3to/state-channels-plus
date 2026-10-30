# AConsumerFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol)

## Requirements

- [`REQ-ENFSM-3-JZK0FB` (Genesis derivation)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-3-jzk0fb)
  Partial: `openChannelGenesis` is pure by signature, but the balance total of the returned genesis is integrator-owned and not checked by the manager's `open` ([`OQ-19-Y8FDQX` (Channel-balance invariant enforcement points)](../../../../open-questions.md#oq-19-y8fdqx)).
- [`REQ-ENFSM-2-G4HBKG` (Adapter confinement)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-2-g4hbkg)
  Contradicts: `deposit` and `withdraw` are reachable directly through the proxy `fallback`, not only through manager-owned paths ([`OQ-17-6Z5Q0J` (Consumer-facet functions are externally reachable)](../../../../open-questions.md#oq-17-6z5q0j)).
