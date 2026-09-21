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

Use existing published IDs verbatim on follow-up (for example R1FO1). Status is
new, continued, fixed, recurred or disagreement. Include fixed/disagreement
dispositions only for existing findings and provide inspected evidence. Those are
lifecycle updates, not new praise cards. `decision` is null unless a human must
decide; then it is {"required":true,"question":"...","reason":"...",
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
are satisfied. Missing evidence belongs in missing/errors and complete must be false.

No publishing dashboard, manual CLI instructions or certainty percentages are
needed in this automated report. The controller publishes, not the model.
