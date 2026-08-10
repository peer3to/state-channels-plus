# Specification governance, versioning, and change control

## Status and authority

This chapter defines how the specification becomes authoritative and how code changes it. It does not define contract upgrade governance, which is a protocol mechanism described in [contract architecture](contracts/architecture-and-storage.md).

## 1. Purpose

The repository currently contains design intent, prototype behavior, tests, TODO comments, and review notes that do not always agree. Governance prevents an accidental implementation detail or passing test from silently becoming protocol policy.

## 2. Source-of-truth order

After approval, authority is:

1. accepted normative specification and decision records;
2. versioned external interface and encoding commitments derived from it;
3. implementation code;
4. tests as evidence;
5. comments and examples.

Before approval, this tree is a proposed consolidation. A statement under current implementation is evidence, not authority. An unresolved decision stays unresolved even if code picked a side.

## 3. Decision ownership

Engineers responsible for protocol and application integration approve normative design. Security-sensitive economic choices also require security review. Operations approves deployability and recovery runbooks. Product approves user-visible cost and latency targets but cannot weaken safety assumptions without an explicit protocol decision.

Agents and reviewers may discover facts, propose amendments, and implement approved behavior. They do not resolve design ambiguity by preference.

## 4. Change workflow

Every meaningful behavior change follows this order:

1. State the observed fact with code, test, trace, or chain evidence.
2. State the concern and affected safety, liveness, compatibility, privacy, fee, or operation property.
3. Write the proposed requirement and alternatives in the owning chapter.
4. Update the decision register if approval is pending.
5. Obtain named engineer approval and record date/version.
6. Update encodings, interfaces, config, migration, and operations impact.
7. Implement code.
8. Add focused, integration, E2E, adversarial, and migration evidence proportional to risk.
9. Run traceability audit in both directions.
10. Mark current/intended difference closed only after implementation and evidence match.

Code may be written behind a disabled experimental flag before approval, but it must not change production protocol behavior or commitments.

## 5. Chapter completion contract

Every implementation-facing subsystem follows [the chapter contract](conventions/subsystem-chapter.md). A section is complete only when an engineer can answer:

- what problem this boundary solves and why it exists;
- who calls it and what it owns;
- exact input, output, state, and encoding;
- ordered algorithm and every deterministic tie;
- invariants and cross-layer dependencies;
- concurrency, race, and atomicity behavior;
- trust, resource, privacy, and economic assumptions;
- failure, retry, restart, and reorganization behavior;
- current source evidence and known differences;
- tests that prove the public contract and gaps that remain.

A list of class or facet names is not a subsystem specification.

## 6. Requirement and invariant IDs

Stable IDs are optional in prose while the draft is changing, but every release gate and high-risk rule needs one before approval. Format:

```text
<AREA>-REQ-<number>
<AREA>-INV-<number>
<AREA>-DEC-<number>
```

Areas are `SYS`, `SM`, `EXEC`, `MSG`, `TIME`, `NET`, `FRAUD`, `DISPUTE`, `SDK`, `STORE`, `EVENT`, `CONTRACT`, `SEC`, and `OPS`. IDs are never reused. Withdrawn IDs stay in version history with replacement link.

Each ID links to owning chapter, accepted decision, implementation paths, focused tests, E2E evidence, and known gap. The [verification matrix](verification.md) is an index, not the only place links may exist.

## 7. Decision record

Accepted or pending choices use:

| Field           | Required content                                             |
| --------------- | ------------------------------------------------------------ |
| ID and title    | stable name                                                  |
| Status          | proposed, accepted, superseded, or rejected                  |
| Context         | observed facts and problem                                   |
| Decision        | exact behavior, including boundary values                    |
| Alternatives    | serious competing choices                                    |
| Reason          | safety, liveness, cost, complexity, and compatibility basis  |
| Consequences    | new risks, assumptions, migration, and operations work       |
| Affected layers | protocol, SDK, contract, state machine, wire, storage, tests |
| Approval        | owner, date, protocol version                                |

Accepted decisions move into the owning normative chapter. The open register keeps a short link until implementation audit closes it.

## 8. Compatibility and versioning

A protocol version covers:

- Solidity ABI structs, function selectors, events, and errors;
- byte encoding and hashing;
- signature domains and meanings;
- block, snapshot, stream, proof, dispute, and reduction rules;
- timer formulas and equality boundaries;
- state-machine and consumer interface contracts;
- storage schema and event replay semantics;
- RPC envelope, methods, and handshake negotiation.

Changing a hashed field order, proof interpretation, signer threshold, timer meaning, or successor function is a protocol version change. Adding an internal cache or log is not, unless it changes observable behavior.

Peers refuse active interaction on incompatible versions. Spectate may support explicit old-version verification in an isolated runtime. Contracts preserve old storage readers until all old channels settle or complete migration.

## 9. Current, intended, and future separation

Use these labels consistently:

- **Current implementation**: repository behavior observed now.
- **Difference from intended design**: accepted requirement not met, pending choice, or unclear current contract.
- **Future work**: improvement not required for the current accepted protocol.

Do not move a correctness blocker into future work. Do not write “should” for an unresolved choice and later treat it as approved.

## 10. Security and economic approval

The following always require explicit decision and security evidence:

- any new slash, bond loss, blacklist-to-chain consequence, or false-challenge penalty;
- proof predicate or proof-size change;
- threshold, membership, leader, finality, or reduction change;
- timeout and clock boundary;
- new trust in watchtower, provider, relay, committee, or data layer;
- asset adapter or balance algebra change;
- upgrade authority or storage migration;
- privacy exposure of state or audit data.

## 11. Review checklist

Before approving a chapter:

1. Compare it with review notes and current source.
2. Search for duplicate rules elsewhere and choose one owner.
3. Test every zero, empty, first, last, equal-deadline, duplicate, stale, and maximum case.
4. Identify attacker-controlled arrays and work.
5. Verify current/intended differences are complete.
6. Check no objective penalty depends on subjective local facts.
7. Check restart and reorganization behavior.
8. Check cross-language encoding and predicate vectors.
9. Check user-visible cost and recovery path.
10. Record approval or specific unresolved decision.

## 12. Documentation verification

Documentation CI checks Markdown format, local links, duplicate IDs, required chapter headings, unresolved markers, source links, banned stale terminology, and review coverage. It does not claim semantic approval. Engineer review remains required.

## 13. Future work

Non-normative process improvements include machine-readable requirement indexes, generated source/test backlinks, and signed release decision records. Engineer approval remains the authority even if these checks are automated.
