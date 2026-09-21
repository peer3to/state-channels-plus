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
session reuse the established analysis. Start with current discussion and open
findings, then changes since the last confirmed published review. Inspect affected
callers and regressions; revisit unchanged code only when new changes or discussion
require it. A failed attempt is context, not a completed baseline. If the verified
baseline is unavailable, non-ancestral or has a different merge-base, inspect the
full diff and say why. Always gather current discussion and verify source revisions
before reusing prior accounting. Do not reread old drafts merely to rewrite them.

Use the provided delta diff for review scope but the full PR diff for inline
anchors. Keep existing finding IDs stable; omit already closed findings unless
new evidence reopens them. Do not equate a manually resolved thread with proof of
a fix or a required human answer.
