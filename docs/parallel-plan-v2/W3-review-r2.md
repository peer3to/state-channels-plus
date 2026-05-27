# W3 review r2 — harness ↔ worker rpc kernel

baseline: round-1 review (`W3-review.md`), revised `W3-rpc-kernel.md` (revision log lines 295-301), W0 D-1..D-21, master-plan.md, meeting summary.

scope: status per round-1 finding + new blockers/majors only.

---

## 1. round-1 findings — status

### BLOCKER

none in r1.

### MAJOR

**M1 — v1 directory deletion in the W3 PR.** RESOLVED.
evidence: §file layout lines 259-271 add the "v1 deletion in the same PR" subsection. enumerates the six files + `__tests__/` directory by path. back-cites master-plan.md line 148 and explicitly upgrades the "conditional" entry to "unconditional: W3 does not reuse v1 verbatim -> the directory goes." revision log M1 confirms. clean.

**M2 — `dispose()` swallow of `DataCloneError` underspecified.** RESOLVED.
evidence: §dispose lines 202-210 add §"race with late `postMessage`" covering both directions (orchestrator-closes-first, worker-closes-first), wrapping every outbound `postMessage` in try/catch, and listening for the port `close` event to trigger local `dispose()` so subsequent posts become guarded no-ops. closing line "a `DataCloneError` or 'closed port' throw is never user-visible" specifies the contract. revision log M2 confirms.

### MINOR

**m1 — duplicate id guard.** RESOLVED.
evidence: §correlation-id pattern line 77 adds `if (this.pending.has(id)) throw new RpcDuplicateIdError(id)` as "step 1" with comment "guard against id reuse -> catches programmer error during W1 dev." revision log m1 confirms.

**m2 — `console.warn` on unknown-id `res`.** NOT ADDRESSED.
evidence: §correlation-id pattern line 90 still reads `if (!entry) return; // late or unknown -> drop`. no logging added. revision log does not mention. status: deliberately ignored or overlooked. **not raising to blocker** — original finding was MINOR and the §dispose r2 spec now makes the "unknown id post-dispose" path the dominant case where this fires, and that path is now well-defined (orchestrator has already rejected the parked promise with "rpc client disposed"). a stray warn there would be noise, not signal. consider this finding withdrawn.

**m3 — duplicate handler register guard.** RESOLVED.
evidence: §correlation-id pattern (server) line 107 adds `if (this.handlers.has(method)) throw new RpcDuplicateHandlerError(method)` as "step 1." cut-table row updated from "last write wins" to "throws on duplicate -> explicit `unregister` required to replace." revision log m3 confirms.

### NITS

n1 (unsigned `// W?:` markers), n2 ("no `seq` on push" repeated 3x), n3 (`EventName` literal-union note) — none addressed, none worth blocking on. doc hygiene only.

---

## 2. new findings (r2 only)

### BLOCKER

none.

### MAJOR

none.

### MINOR

**r2-m1 — `RpcDuplicateIdError` / `RpcDuplicateHandlerError` / `RpcUnknownHandlerError` are referenced but undeclared.**
the r1 fixes introduce three named error classes (`RpcDuplicateIdError` line 77, `RpcDuplicateHandlerError` line 107, plus the inline `no handler: ${f.method}` `Error` at line 120 which is not a named class). §file layout calls out `rpc-errors.ts ~20 lines` containing `serializeError` / `deserializeError` only. either:

- (a) declare the two named errors in `rpc-errors.ts` and bump the line budget by ~6 lines, or
- (b) just `throw new Error("rpc: duplicate id N")` / `throw new Error("rpc: duplicate handler 'method'")` — the r1 finding asked for a one-line guard, not a named class.
  recommend (b) — D-6 minimal surface; named error classes for programmer-error guards are exactly the v1 over-engineering this doc is repudiating. one line.

### NITS

**r2-n1 — single-port decision is in W0 as D-21, not a "new W0 D-row pinning single-port topology" as the W3 doc claims at line 34.**
W3 line 34: "**default: one port, pinned in W0 as a new D-row.**" W0 D-21 is titled "one MessagePort per worker; lifecycle frames ride W3's envelope" and covers W2's lifecycle-on-the-port concern, not specifically the W3 dual-vs-single load argument from §topology. close enough — the D-21 statement "v1's three-port split was the over-engineering this plan repudiates; starting v2 with two ports concedes that ground unnecessarily" covers the same ground. cosmetic only; no separate D-row required.

---

## 3. drift checks (r2)

- single-port? still single. §topology unchanged, // W?: marker intact, W0 D-21 backstops it. clean.
- dispose race? now fully specified in both directions; the try/catch + `close` event handshake is concrete enough to implement without ambiguity. clean.
- did the M1/M2/m1/m3 fixes drag in new surface? **no.** total kernel size estimate (lines 247-255) still claims "~210 lines, ~7-8KB." the added guards are one line each. the added §"race with late `postMessage`" is doc-only, no new code. clean.
- did the duplicate-id / duplicate-handler guards leak into a v1-style error hierarchy? **borderline.** see r2-m1 — two new named error classes were introduced where plain `Error` would do. small, but exactly the smell this doc was supposed to reject. recommend collapsing.

---

## 4. verdict

**READY FOR PDR with one minor.**

all r1 BLOCKER (none), MAJOR (M1, M2), MINOR (m1, m3) findings are resolved with evidence in the revision log and visible in the doc body. r1 m2 (log on unknown id) is now obviated by the r1-M2 fix and can be withdrawn. one new MINOR (r2-m1) is doc-cleanup: drop the two named error classes for the duplicate-id / duplicate-handler guards and use plain `Error`. that change is ~2 lines and does not require another round — fold into the implementation PR.

W3 remains the strongest v2 doc. the slimming claim (v1 ~60KB -> ~7-8KB, 14 features cut with one-line rationales each) survives r2 scrutiny.
