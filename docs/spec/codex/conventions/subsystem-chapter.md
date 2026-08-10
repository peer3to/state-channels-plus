# Subsystem chapter contract

## Status and authority

Every implementation-facing chapter in this specification follows the structure below. A chapter may add more sections, but it must not silently omit a required section. If a section does not apply, the chapter says why.

The words **must**, **must not**, **required**, **may**, and **should** describe intended system behavior. A statement under **Current implementation** reports what the repository does now. It does not turn current behavior into a requirement. A statement under **Difference from the intended design** records a known mismatch and names the decision needed to close it.

Code is evidence for current behavior. This specification is the design authority for intended behavior. When the two disagree, an implementation must not guess which one wins. The mismatch must be resolved in this specification or in an accepted design decision before code changes are merged.

## Required chapter structure

### 1. Purpose

State the problem the subsystem solves. Explain why the system needs this boundary and what would break if it did not exist.

### 2. Design decisions and rationale

Record decisions that cannot be recovered from function bodies alone. Include rejected alternatives when they explain a security, liveness, cost, or complexity tradeoff. Do not restate code as rationale.

### 3. Boundary and responsibilities

Define what the subsystem owns and what it delegates. Name every caller and downstream dependency that can affect correctness. State what is deliberately outside the boundary.

### 4. Data model and owned state

Define persisted state, in-memory state, commitments, identifiers, and derived values. For each important field, state:

- who writes it;
- who reads it;
- whether it is authoritative or cached;
- its valid zero or absent representation;
- the invariant that keeps it consistent with related fields.

### 5. Inputs and preconditions

List accepted inputs, authentication rules, time checks, membership checks, uniqueness checks, and required prior state. Separate conditions checked locally from conditions proved by signed or on-chain evidence.

### 6. Processing algorithm

Give the ordered algorithm. Include validation order when it affects error precedence, gas use, race safety, or slashing. State every deterministic tie-breaker. A caller must be able to implement compatible behavior from this section without reading the current code.

### 7. Outputs and postconditions

Define return values, persisted changes, emitted events, network messages, and external calls. State what must remain unchanged when processing fails.

### 8. Invariants

State safety and consistency properties in testable language. Avoid goals such as “should be secure.” Prefer statements such as “a `(channelId, author, forkId, transactionCnt)` calldata slot is write-once.”

### 9. Ordering, concurrency, and atomicity

Define which operations can race, how stale work is rejected, what is atomic, and what can be retried. If a protocol uses a single-threaded queue, on-chain transaction ordering, or compare-and-set style revalidation, say so here.

### 10. Trust and security assumptions

State who may be Byzantine, what signatures or commitments prove, and which data is only an untrusted claim until verified. Include resource-exhaustion limits and economic consequences when they are part of the design.

### 11. Failure behavior and recovery

Define fail-closed and fail-open behavior, retry policy, idempotency, crash recovery, stale state recovery, and permanent failure. State whether failure affects one request, one fork, one channel, or the whole node.

### 12. Current implementation

Point to the concrete modules that implement the subsystem. Describe material behavior that exists today, including shortcuts and incomplete paths. Source paths are evidence, not a substitute for the algorithm above.

### 13. Difference from the intended design

List known mismatches between the required behavior and current code. Each mismatch must be classified as one of:

- **bug**: current code violates an accepted requirement;
- **missing**: the requirement is accepted but not implemented;
- **decision pending**: the intended behavior is not settled;
- **documentation debt**: behavior exists but its contract is not yet precise enough.

### 14. Dependencies and cross-layer effects

Name upstream assumptions and downstream consumers. Explain how a change crosses SDK, wire protocol, contract, state-machine, storage, operations, and tests. Link to the detailed chapters rather than duplicating their rules.

### 15. Verification

Define required unit, integration, contract, and end-to-end observations. Cover success, malformed input, adversarial input, boundary timing, replay, duplicate delivery, restart, and contention where applicable. Identify current tests and missing tests separately.

### 16. Future work

Keep accepted later work separate from unresolved correctness. Future work must not contain a decision required to implement the current protocol.

## Decision record format

Use this compact format inside a chapter when a choice needs explicit ownership:

| Field                | Meaning                                                           |
| -------------------- | ----------------------------------------------------------------- |
| Decision             | The exact behavior being chosen                                   |
| Status               | Accepted, proposed, or unresolved                                 |
| Reason               | Why this behavior fits the system model                           |
| Rejected alternative | The strongest competing design and why it was not selected        |
| Consequence          | Cost, risk, compatibility, or operational effect                  |
| Affected layers      | Contract, SDK, wire, storage, state machine, operations, or tests |

## Traceability rule

Every normative algorithm must be traceable in both directions:

1. The chapter links to the code that currently implements or approximates it.
2. The verification section links to a test, or records the missing test by name and expected observation.
3. A source module implementing a materially different rule is listed under **Difference from the intended design**.

This rule prevents the specification from becoming either a code index or an aspirational document with no implementation evidence.
