# Model output: Markdown once

Return the Markdown document itself, not a JSON result and not a fenced wrapper.
The controller derives findings from its AI blocks and injects bindings, identity,
timing and evidence counters. Do not repeat the finding prose in JSON.

Start with a title and a single-line document marker using controller-bound SHAs:

    <!-- pr-review-document {"schema":2,"repo":"owner/repo","pr":498,"headSha":"<head>","baseSha":"<base>"} -->

Group findings by descriptive `##` sections. Each card has this shape:

    - [ ] **[FO1] General PR comment**
      <!-- pr-review-finding {"id":"FO1","kind":"general","status":"new","threadId":null,"evidence":["Pinned source URL or concrete evidence"],"decision":null} -->
      <!-- human:FO1:start -->
      <!-- human:FO1:end -->
      <!-- ai:FO1:start -->
      🟠 **[FO1] — Concrete problem.**

      Explain trigger, code path, incorrect behavior and impact in ordinary Markdown.

      > **Fix FO1-FIX**
      > Explain the change and a specific regression scenario with its expected result.
      <!-- ai:FO1:end -->

Inline cards use `kind:"inline", "path":"relative/file.js", "line":42,
"side":"RIGHT"` and `Inline comment` in the heading. Only real PR diff locations
are valid. Human blocks are empty: never invent a human assessment.
Keep the card heading, target and source preview outside the AI block. They are
local routing/display metadata, not published prose. The AI block starts with the
severity and finding ID, never `Inline comment`, `General PR comment` or `Target:`.
Findings requiring a human decision instead start their AI block with
`🧑 **HUMAN DECISION REQUIRED**` on its own first line, followed by the severity
and finding ID. Include the STOP warning from automation.md telling
implementing agents to wait for the human's explicit comment. Populate `decision`
as well; prose alone does not activate the decision gate.
The publisher normalizes this warning to one leading block from the structured
decision. Keep the STOP warning in its own paragraph, separate from the evidence
and proposed fix.

Use existing published IDs verbatim on follow-up (for example R1FO1). Status is
new, continued, fixed, recurred or disagreement. Include fixed/disagreement
dispositions only for existing findings and provide inspected evidence. Those are
lifecycle updates, not new praise cards. For new findings, `decision` is null for
technical fixes and choices already settled by the specification or an explicit
human decision; cite the settling evidence. An unresolved design choice requires
{"required":true,"question":"...","reason":"...",
"revision":1,"authority":"author"} (authority may also be maintainer).

End with one single-line control marker. This is bookkeeping, not a second report:

    <!-- review-result {"coverage":{"complete":true,"missing":[],"files":["relative/file.js"],"lenses":["correctness"],"behaviors":["retry after failure"]},"accounting":[],"recommendation":"comment","errors":[]} -->

Every required source gets an accounting entry with exactly `sourceId`,
`sourceRevision` (current digest), `disposition`, `response`, `findingId` and
`humanAssessment`. Disposition is response, no-action, continued, fixed or
disagreement. Response is a concise explanation; findingId is a report finding ID
or null; humanAssessment is accepted, insufficient, conflict or null. Do not copy
whole findings into accounting. Preserve unchanged accounting only when the exact
source revision still matches. Coverage lists inspected surfaces, never guessed
ones. Recommendation is comment, or approve only when the existing approval rules
are satisfied. `coverage.complete` means the source and discussion review is
complete, not that runtime acceptance has passed. Use `coverage.missing` only for
unread source, required discussion, or unfinished review surfaces; those make
complete false. Tool failures belong in errors.

Put absent, pending or unverified CI/live acceptance evidence in the optional
`coverage.verificationMissing` string array. This does not make source coverage
incomplete or count as a tool error: return the actionable review with complete
true when its source scope is finished, and recommendation comment. The publisher
keeps these limitations as metadata and blocks approval. Report a concrete test-coverage
defect as a finding when warranted; do not invent a defect simply because live
evidence is unavailable. Never run or wait for tests to fill this field.

Unknown GitHub thread-resolution status belongs in `coverage.verificationMissing`
as well, not in `coverage.missing` or `errors`. It does not block a completed
source/discussion review; use recommendation comment. Do not infer resolution
from code fixes or invent human consent. The publisher verifies current thread
state. Missing comments, replies or source evidence remain blocking.

No publishing dashboard, manual CLI instructions or certainty percentages are
needed in this automated report. The controller publishes, not the model.
