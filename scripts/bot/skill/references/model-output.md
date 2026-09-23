# Model output: ordinary Markdown

Return the review once, as Markdown. Do not generate JSON, HTML comments,
document/card metadata, hashes, evidence arrays, Human/AI wrappers, or a
review-result footer. The worker adds bindings and editor metadata itself.
This overrides the manual Studio format in inherited skills and publishing.md.
Keep the substantive audits, detailed explanations, sections and stable IDs.

Under each descriptive `##` review section, write findings like this:

    ### [FO1] Incorrect retry boundary
    Status: new
    Location: scripts/example.js:42

    🟠 **[FO1] — Incorrect retry boundary.**

    Explain the trigger, code path, wrong outcome and impact. Include pinned
    source links here, once, rather than repeating them in metadata.

    > **Fix FO1-FIX**
    > Explain the concrete fix and regression scenario with its expected outcome.

`Location` is an exact RIGHT-side PR diff target, or `general`. Routing lines
are private and are not published. `Status` is new, continued, fixed, recurred or
disagreement. Reuse published IDs exactly. Existing findings being fixed or
disagreed still need an evidence-backed disposition; omission is not resolution.

For unresolved design choices start the finding body with
`🧑 **HUMAN DECISION REQUIRED**`, before the severity lead, then a `Decision:`
sentence and the advisory STOP guidance from automation.md. Do not duplicate this
in structured fields. Specifications and prior human decisions can settle a choice.

Account for substantive human discussion in a visible table, once:

    | Source | Disposition | Assessment | Finding |
    | --- | --- | --- | --- |
    | comment:123 | response | Evidence-backed assessment with a source link. | FO1 |

Source IDs use comment, inline or review followed by the numeric GitHub ID.
Disposition is response, no-action, continued, fixed or disagreement. Use `-`
when no finding applies. Do not put a literal pipe in the assessment cell.
Do not account separately for bot notifications or repeat finding prose here.
The worker derives finding accounting from dispositions and binds discussion
revisions from actual public reads; never calculate or copy hashes.

Decide third-party threads from the code and the entire current conversation,
just like bot findings. Give every substantive reply a disposition. Use fixed,
disagreement or no-action with an evidence-backed reason when nothing remains;
use continued and link a finding when work remains. A response alone does not
mean resolved: link its finding, or choose an explicit settled disposition.
The publisher may resolve a third-party thread only when all current replies
have settled decisions. General comments stay on GitHub; their dispositions
and linked findings track whether anything remains actionable.

Finish with this short private completion section (no per-file inventory):

    ## Review completion
    Complete: yes
    Missing: none
    Verification missing: tests were not executed; thread resolution is publisher-owned
    Lenses: correctness; security; races; performance; tests; reuse; documentation
    Behaviors: retry recovery; publication lifecycle

Use `Complete: no` and list unfinished source/discussion surfaces in `Missing`
when applicable. Lists use `; `, or `none`. Only claim lenses and behaviors
actually inspected. Unknown resolution flags and missing/pending runtime checks
belong in `Verification missing`, not `Missing`. Never run or wait for tests.
Do not decide PR approval. Recommendation defaults to comment; legacy
recommendations are ignored for approval. Final CI jobs deterministically check
confirmed resolution, fresh discussion, the current head and successful CI.
No publishing dashboard or certainty percentages.

On repair, correct the saved document using specific validation feedback.
Do not repeat source inspection unless evidence is genuinely missing.
