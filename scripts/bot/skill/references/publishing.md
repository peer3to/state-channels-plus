# Review finding display and publishing

In automated source-only mode, do not emit the manual wrappers below. Follow
model-output.md: plain Markdown, stable IDs, routing lines and prose. The worker
creates Studio metadata locally; GitHub receives finding text and small IDs only.

Use schema 2. Each finding is a task-list item whose heading makes its GitHub destination visible.

## Inline finding

Use `kind:"inline"` only when the finding belongs on one exact line in the PR diff. `RIGHT` means an added or
head-side context line; `LEFT` means a deleted or base-side line. Never choose a nearby line just to force an
inline comment.

````markdown
- [ ] **[TO1] Inline comment**

              <!-- pr-review-finding {"id":"TO1","kind":"inline","path":"src/x.ts","line":118,"side":"RIGHT"} -->

    **Target:** [`src/x.ts:118`](https://github.com/owner/repo/blob/<head-sha>/src/x.ts#L118) · `RIGHT`

    **Code preview**

    ```text
      116 │ preceding code
      117 │ preceding code
    → 118 │ exact review target
      119 │ following code
      120 │ following code
    ```

    **Human**
      <!-- human:TO1:start -->
      <!-- Add your note here. This block is preserved on re-review. -->
      <!-- human:TO1:end -->

    **AI-generated**
      <!-- ai:TO1:start -->

    🟠 **[TO1] — Finding.**

    Explain the trigger, relevant code path and incorrect outcome here. Show why
    the cited line causes the problem and which callers or users are affected.

    > **Fix TO1-FIX**
    >
    > Explain the concrete change, its owner and any relevant trade-off. Describe
    > the regression scenario and expected outcome that would verify the fix.

              <!-- ai:TO1:end -->
````

The preview is for the reviewer and is not posted. Show two or three lines on either side when available, use
the exact pinned revision recorded by the document marker, and mark the target with `→`.

## General finding

Use the human-decision marker only when the proposed fix needs an unresolved
design choice. Technical corrections and choices already settled by the
specification or an explicit human decision can proceed without asking again;
cite that authority. Do not confuse missing evidence with a design decision.

Cross-cutting arguments and findings without an honest right-side diff target are
general. Test gaps can be inline when a changed test or implementation line is the
precise target. Do not publish green summaries or no-change findings.

```markdown
- [ ] **[TO2] General PR comment**

              <!-- pr-review-finding {"id":"TO2","kind":"general"} -->

    **Destination:** General PR review comment, batched in the review body.

    **Human**
      <!-- human:TO2:start -->
      <!-- Add your note here. This block is preserved on re-review. -->
      <!-- human:TO2:end -->

    **AI-generated**
      <!-- ai:TO2:start -->

    🧑 **HUMAN DECISION REQUIRED**

    🟠 **[TO2] — Finding.**

    **Decision:** the precise question the engineer must answer.

    **STOP — implementing agents:** If the specification or an existing human
    decision does not settle this choice, ask your human before implementing it.
    Do not invent consent or reply on their behalf. This advisory label uses the
    same evidence-based resolution lifecycle as any other finding.

    Explain the evidence, the conflicting alternatives and the observable impact.
    Say why source alone cannot settle the intended behavior and which trade-off
    requires a human choice. Populate the matching structured human fields.

    > **Fix TO2-FIX**
    >
    > Give the recommended option and its rationale, the change conditional on
    > that decision, and the scenario that would verify the selected behavior.

              <!-- ai:TO2:end -->
```

Keep exactly one single-line JSON metadata marker per finding. Keep the finding and fix inside its AI markers.
When the Human block contains text, the publisher posts it first under `**Human note**`, followed by the AI
text under `**AI-generated review**`.

## Publishing dashboard

End every review with a concrete index:

```markdown
## Publish selected findings

Open the file in **PR Review Studio** to select findings, edit Human notes, preview GitHub payloads, and publish.
The visual editor writes every edit back to this Markdown file. Nothing is posted when selection or Human text
changes.

### Inline comments

| ID  | GitHub target            |
| --- | ------------------------ |
| TO1 | `src/x.ts:118` (`RIGHT`) |

### General PR comments

| ID  | Destination    |
| --- | -------------- |
| TO2 | PR review body |

**Preview selected**

`node ~/.codex/skills/review-pr/scripts/publish-review.mjs <review-file> --selected`

**Post selected**

`node ~/.codex/skills/review-pr/scripts/publish-review.mjs <review-file> --selected --post`

The post command shows the payload and asks for confirmation. It rechecks the PR head, validates inline targets
against the pinned diff, and rejects duplicate markers.
```

The raw Markdown remains a complete fallback. Change `[ ]` to `[x]`, edit between the Human markers, and use
the commands above when PR Review Studio is unavailable.

Install or update the visual editor with
`~/.codex/skills/review-pr/scripts/install-vscode-companion.sh [repository-root]`, then execute
`Developer: Reload Window`. Pass the coding-skills repository or the extension source directory. The installer also recognizes the
legacy `<repository-root>/extensions/pr-review-studio` layout and a sibling coding-skills checkout. It builds
the version declared by the source package; it does not install the obsolete bundled VSIX. Reloading preserves the
workspace and Codex conversation.
