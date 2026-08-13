# System 7 — Runtime, Storage, and Operations

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system defines how a participant node exists as software: the client-node process model,
worker/inline transport equivalence, durable evidence and recovery storage, chain/RPC observation,
synchronization after restart, watchtower delegation, harness control, deployment configuration, and
operational limits. It hosts every other system without changing their observable behavior.

## System contract

- **Owned state.** The participant's process topology (inline or isolated contexts and their ports),
  chain-observation subscriptions, and the deployment configuration values that parameterize every
  timing window. Durable stores belong to [System 9 — Storage](../storage/README.md).
- **Public inputs.** Application/API calls from the integrator; chain events from RPC providers;
  configuration at startup; harness control in test deployments.
- **Public outputs.** A running, recoverable participant whose protocol behavior is identical across
  inline and isolated execution; committed events to the application; persisted evidence available to
  watchtowers and recovery.
- **Calls.** Every system — it schedules, persists for, and observes on behalf of all of them; the
  enforcement system via RPC-provider chain observation.
- **Called by.** The integrating application; test harnesses through the same serialized interfaces
  used in production.
- **Trust and availability assumptions.** At least one available, honest RPC endpoint
  ([../security/trust-model.md](../security/trust-model.md)); durable storage survives restart;
  execution contexts may crash, stall, or deliver late responses. The required host set is
  **browser and Node.js** with identical protocol capability
  ([`REQ-RUNTIME-5-WJ1XKK`](execution.md#req-runtime-5-wj1xkk)); platform APIs differ between them only beneath the
  equivalence boundary.
- **Ordering and concurrency.** One canonical owner per mutable resource; causal order within an
  ordered domain; lifecycle transitions settle every request exactly once
  ([execution.md](./execution.md), [sdk.md](./sdk.md)).
- **Invariants (owned).** [`INV-RUNTIME-1-AKRHAK`](execution.md#inv-runtime-1-akrhak), `REQ-RUNTIME-*` ([execution.md](./execution.md));
  [`INV-SDK-ARCH-1-KNAX7F`](sdk.md#inv-sdk-arch-1-knax7f), `REQ-SDK-ARCH-*` ([sdk.md](./sdk.md)); `REQ-CONFIG-*`
  ([configuration.md](./configuration.md)). Durable storage is its own system:
  [../storage/README.md](../storage/README.md).
- **Failure and recovery outcomes.** Context failure is contained at its boundary; restart recovers
  from the storage system's durable set and re-enters the block-progression pipeline without
  trusting read-back data ([`REQ-STOR-3-4RJGER`](../storage/durability.md#req-stor-3-4rjger)); stale callbacks cannot mutate
  disposed state; configuration outside validated bounds is rejected at startup, not discovered
  mid-protocol.
- **Resource bounds.** Supported-device targets (constrained laptops, phones, tablets), worker
  startup/transfer costs, message-queue and serialization limits; isolation is added only where
  measurement justifies it.
- **Verification evidence.** Requirement matrices in the owned documents; execution equivalence and
  the observation edge are proven under [`REQ-IX-8-FY54AV`](../interactions.md#req-ix-8-fy54av) and
  <a id="req-ix-7-a004vz"></a>`REQ-IX-7-A004VZ`.

## Owned documents

| Document | Defines |
| --- | --- |
| [execution.md](./execution.md) | Runtime isolation and concurrency: transfer-safe boundaries, ownership/ordering, lifecycle convergence, platform equivalence. |
| [sdk.md](./sdk.md) | Participant service architecture: coherent state, explicit ownership, ordered lifecycle, event fidelity, execution isolation. |
| [configuration.md](./configuration.md) | Deployment configuration semantics: timing windows, limits, and their validation. |

Durable storage and recovery were factored out into [System 9 — Storage](../storage/README.md),
which nearly every system calls; this system consumes it like the others.

## Interaction contracts

Producer of chain observation for every system ([`REQ-IX-7-A004VZ`](README.md#req-ix-7-a004vz)) and owner
of the execution-equivalence guarantee every system inherits
([`REQ-IX-8-FY54AV`](../interactions.md#req-ix-8-fy54av)).
