# Verification Layer

> **Agent status:** Restructured to the repository-shaped contract (review objective 46); test
> reports are mechanically inventoried skeletons pending inspection.
> **Engineer verification:** Pending.

This layer answers: **what do the real tests actually prove?** It is organized around real test
files. Traceability runs through stable permutation IDs and exact test declarations — never through
path equality. A test counts only when its exact declaration, inspected setup, and oracle are
mapped to the obligation it proves.

## Contents

- [Layer structure](#layer-structure)
- [Test reports](#test-reports)
- [Declaration classification](#declaration-classification)
- [Mapping rules](#mapping-rules)
- [Views and open questions](#views-and-open-questions)

## Layer structure

| Location | Holds |
| --- | --- |
| [tests/](./tests/) | One maintained report per repository test file containing executable declarations, mirroring the `test/` tree (`tests/test/unit/ValidationService.test.ts.md`). Fixtures, harness code, utilities, runners, and configuration get no reports — a test report links support code only when it materially affects setup or the oracle. |
| [unit/](./unit/README.md), [integration/](./integration/README.md), [system/](./system/README.md), [end-to-end/](./end-to-end/README.md) | Navigational level indexes over the authoritative test reports; they duplicate no evidence. |
| [views/](./views/) | The pre-restructure verification documents: methodology views and the specification/implementation traceability matrices. Matrices remain valid mapping locations; migrating their rows beside the declarations they map (into `tests/` reports) is the ongoing consolidation. |
| [open-questions.md](./open-questions.md) | Verification-owned open decisions (oracles, environments, permutations, evidence). |

## Test reports

Each test-file report inventories every exact test or dynamic test family in that file and records:
its public production entry point; setup, stimulus, oracle, and forbidden effects; environment;
linked production files; assigned specification permutations and implementation-test obligations;
evidence quality (good, partial, wrong/misleading, adjacent-only, missing); and remaining gaps.

**Current maturity:** reports were scaffolded from mechanical declaration extraction. Every
declaration is `Unclassified` with `Pending inspection` quality until its body is actually read;
the skeleton deliberately lists declarations by name and line without exact links, because an exact
`[test](...#L<declaration>)` link is a mapping claim reserved for inspected rows.

## Declaration classification

Classification belongs to each **declaration**, not the file — one physical file may contain cases
at different levels:

1. **Unit** — one production component through its public boundary with controlled collaborators.
2. **Integration** — collaborating production components within one subsystem or process boundary.
3. **System** — a complete node, contract subsystem, or other deployable system boundary with its
   real internal composition.
4. **End-to-end** — an externally observable protocol workflow across the relevant peers,
   contracts, chain, consumer, or runtime boundaries.

Physically reorganizing the repository `test/` tree into these levels is future work; until then
the mirrored report path follows the repository exactly and the per-declaration classification
provides the normalized view (generated join:
[generated/traceability.md](../generated/traceability.md)).

## Mapping rules

- Map static declarations as `[test](...#L<declaration>)`; dynamic/fuzz declarations as
  `[test family](...)` with their generated dimensions and oracles enumerated.
- A mapping row states the permutation ID it proves; file links, directory links, and adjacent
  tests are never evidence.
- One declaration may prove several permutations; the case is the unit of traceability.
- A genuinely out-of-scope test file may use `// @spec-test-coverage-ignore: <reason>` in its
  first ten lines.
- Repair a shifted anchor only when the declaration has one unique match; never guess an ambiguous
  or vanished mapping.

## Views and open questions

The documents under [views/](./views/) keep the traceability matrices authored before the
restructure — the graph reads mapping rows from any verification document, so nothing was lost by
moving them. As declarations are inspected, their rows move into the owning `tests/` report; a
matrix row and a report row must never both claim the same mapping.

Oracle, environment, permutation, and evidence questions belong in
[open-questions.md](./open-questions.md).
