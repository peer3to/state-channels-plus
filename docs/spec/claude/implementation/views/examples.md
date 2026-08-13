# Examples

> **Specification subject:** [specification/concepts/state-machines.md](../../specification/protocol-model/state-machines.md)

> **Status:** Draft.
> **Scope:** The example integrations shipped in [examples/](../../../../../examples) and their status.
> Nothing in this document is normative reference material; examples illustrate SDK usage, they do
> not define protocol behavior.

## Contents

- [Inventory](#1-inventory)
- [Tic-Tac-Toe (legacy)](#2-tic-tac-toe-legacy)
- [Case applicability](#case-applicability)
- [Future Work](#future-work)

## 1. Inventory

[examples/](../../../../../examples) currently contains a single example:

| Example                                          | Status                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [Tic-Tac-Toe](../../../../../examples/TicTacToe) | **Legacy illustrative material.** Outdated one-versus-one teaching example; NOT a normative reference integration. |

## 2. Tic-Tac-Toe (legacy)

Tic-Tac-Toe is a two-player game with a wager, built as a teaching example for an earlier version
of the SDK. It is retained because it still demonstrates the basic integration shape end to end:

- **A state machine contract**
  ([TicTacToeStateMachine.sol](../../../../../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateMachine.sol#L4))
  extending `AStateMachine`: the board and balances as state, `makeMove` as the transition,
  `getState`/`_setState` serialization, turn-taking via `getNextToWrite`, and author identity via
  `_tx.header.participant` (see
  [concepts/state-machines.md](../../specification/protocol-model/state-machines.md)).
- **A consumer facet and manager proxy**
  ([TicTacToeConsumerFacet.sol](../../../../../examples/TicTacToe/contracts/TicTacToe/TicTacToeConsumerFacet.sol#L4),
  [TicTacToeStateChannelManagerProxy.sol](../../../../../examples/TicTacToe/contracts/TicTacToe/TicTacToeStateChannelManagerProxy.sol#L4))
  showing how an integrator provides genesis construction, deposits, and withdrawals
  (see [contracts/state-machine-base.md](./architecture/contracts/state-machine-base.md)).
- **A deployment script and a browser UI**
  ([tic-tac-toe-vite](../../../../../examples/TicTacToe/tic-tac-toe-vite), React + Vite) that calls the
  enshrined contract through the TypeScript SDK, against a local zero-gas EVM node.

### Limits

- **One-versus-one only.** It predates and does not exercise the multiparty-channel capabilities:
  joins into a running channel, spectating, membership-threshold changes, or channels near the
  full-mesh partition target of roughly 6–10 participants
  ([security/trust-model.md](../../specification/security/trust-model.md)).
- **No dispute coverage.** It does not demonstrate disputes, fraud proofs, timeouts, or the
  successor-fork lifecycle ([protocol/disputes.md](../../specification/disputes/disputes.md)).
- **Stale by construction.** Its UI is acknowledged incomplete, and it builds against the local
  repository build rather than the published package (`yarn && yarn build` in the repo root is
  required first — see [reference/configuration.md](./operations/configuration.md)).

Treat any conflict between this example and the specification tree as a defect of the example.

## Case applicability

This inventory defines no implementation requirement and therefore owns no implementation test plan.
The example is deliberately non-normative and is not evidence that a specification requirement is
implemented or verified. Requirements for example correctness or conformance must first be added
to the owning specification; only then may this document gain requirement-owned implementation
tests. This explicit exemption prevents the coverage audit from mistaking illustrative code for a
protocol obligation.

## Future Work

_Non-normative._

- Replace Tic-Tac-Toe with an example that demonstrates the SDK's current capabilities: a
  multiparty channel at the full-mesh small-partition target (~6–10 participants, per the topology
  limits in [security/trust-model.md](../../specification/security/trust-model.md)), the complete lifecycle
  (open → execute → settle), a join into a running channel, at least one dispute path with
  recovery, and the relevant operational limits.
- Keep one deliberately minimal "hello world" state machine alongside the full example, so the
  integration surface stays learnable without the full application weight.
