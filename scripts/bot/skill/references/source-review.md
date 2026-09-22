# Source review scope

Inspect correctness, specification and plan adherence, trust boundaries, races,
failure/recovery, performance, reuse/ownership, dead code, documentation, repository
AGENTS rules, contract consistency and test coverage. Read test source, not just
test names: distinguish component variations from system integration scenarios.
Report missing or weak assertions and relevant skipped tests. CI is evidence only
for its recorded revision; do not execute tests or wait for downstream jobs.

Explain findings with pinned GitHub source links and concrete behavior. Separate
demonstrated defects from decisions requiring human intent. Do not produce clean
section cards, duplicate one issue across lenses, or pad the report with praise.

On the first review inspect the whole PR diff and affected callers. On a resumed
session reuse only established analysis with an explicit coverage disposition.
A publication receipt proves publication, not that the earlier review performed
every audit in the current skill. Compare the earlier coverage with the inherited
plan, contradictions, behavior-to-test, reuse, dead-code and documentation
inventories. Complete missing audits over the full PR even when those files are
unchanged. Do not treat an earlier short report or a list of lens names as evidence
that their inventories were completed. Start with current discussion and open
findings, then changes since the last confirmed published review. Inspect affected
callers and regressions; revisit unchanged code when new changes, discussion or
missing audit evidence require it. A failed attempt is context, not a completed baseline. If the verified
baseline is unavailable, non-ancestral or has a different merge-base, inspect the
full diff and say why. Always gather current discussion and verify source revisions
before reusing prior accounting. Do not reread old drafts merely to rewrite them.
A format or publication failure does not erase source analysis already completed
in this conversation. Reuse its concrete findings and audit dispositions when
their source is unchanged; repair the failed output and inspect new discussion
and changed code. Do not restart the full audit just because no receipt was issued.
This reuse does not promote a failed attempt to a confirmed publication baseline
or imply that its proposed comments were actually posted.

Retain the concrete behavior-to-test and owner/caller dispositions in the report's
coverage inventory so the next turn can reuse verified work. Inspect every
applicable lens; finding count is neither a target nor a stopping condition. Give
each independently evidenced coverage gap its own finding as the inherited skill
requires, even when a related production defect is also reported. Do not collapse
the Tests audit into generic advice to add tests to the few existing findings.

Use the provided delta diff for review scope but the full PR diff for inline
anchors. Keep existing finding IDs stable; omit already closed findings unless
new evidence reopens them. Do not equate a manually resolved thread with proof of
a fix or a required human answer.

For automated review, the completion scope in automation.md overrides inherited
requirements to read resolved-thread history. Controller-filtered resolved threads
are out of scope, not a coverage gap.
