# W3 review — harness ↔ worker rpc kernel

reviewer: critical pass. baseline: master-plan.md, W0 D-1..D-12, meeting summary 3:30 / 19:19 / 20:05.

---

## 1. boss-alignment per non-negotiable

| #   | non-negotiable                                    | verdict   | evidence                                                                                                                                                                           |
| --- | ------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | peer ↔ peer over LocalTransport, not MessagePort | respected | §topology only describes orchestrator↔worker port; kernel exposes no peer-routing primitive. nothing in the wire format implies peer addresses.                                   |
| 2   | MessagePort only orchestrator ↔ worker           | respected | §topology "one MessageChannel per worker. orchestrator holds port1; worker holds port2." no fan-out, no broker.                                                                    |
| 3   | one polymorphic harness                           | n/a here  | W3 is the transport; polymorphism is W1. kernel exposes one `RpcClient`/`RpcServer` pair, doesn't fork shapes per backend.                                                         |
| 4   | tests do not change                               | respected | no test-facing surface added; kernel is internal to `PeerHandle` (W1).                                                                                                             |
| 5   | no double code                                    | respected | one client, one server, one frame union. no parallel sync/async paths.                                                                                                             |
| 6   | minimal surface                                   | respected | four files (~210 lines), three frame shapes, two classes. explicit cut table at §"what we are NOT shipping" enumerates 14 v1 features deleted with one-line justifications.        |
| 7   | 2N+1 thread model / evm-orthogonal                | respected | kernel is per-worker MessagePort pair; evm-in-thread is invisible to it. §bigint notes BigInt is structured-clone-native, kernel stays payload-agnostic.                           |
| 8   | push and pull on one channel                      | respected | §wire format: `Req`/`Res`/`Push` share one port; §correlation-id literally implements boss's "map and queue, fires with id, resolved on response" (line 14: paraphrased verbatim). |
| 9   | loop-delay guard boss-shipped                     | respected | §push channel lists "loop-delay stall reports (W6)" as a consumer, not a designer. no policy in W3.                                                                                |

verbatim boss request/response/ID pattern: W3 lines 65-95 are a near-literal transcription — `pending.set(id, ...)` → `postMessage({kind:"req",id,...})` → `onFrame` looks up id, deletes, resolves/rejects. faithful.

---

## 2. findings

### BLOCKER

none.

### MAJOR

**M1 — naming drift: `RpcClient` / `RpcServer` is fine but file paths still smell of v1.**
§file layout puts kernel at `test/harness/threaded/rpc/`. v1 lives at `test/harness/parallel/rpc/`. document does not say what happens to the v1 directory. if both survive in the tree post-W3, future agents will grep into v1 by accident. plan needs a single sentence: "v1 `test/harness/parallel/rpc/` is deleted in the same PR." otherwise tech-debt persists indefinitely.

**M2 — `dispose()` swallow of `DataCloneError` is hand-wavy.**
§dispose line 194: "or throws DataCloneError on some node builds — caught and swallowed." swallowing means a worker-side handler that resolved with a non-cloneable value after `dispose()` silently does nothing. fine for the disposed orchestrator, but the worker's `await fn(args)` returns a value its post-resolve `postMessage` cannot deliver — does the worker crash, log, or no-op? spec it in one sentence (probably: worker also `dispose()`s on port `close` event; late `postMessage` is wrapped in try/catch and dropped). otherwise this is undefined behaviour the first time a real handler races dispose.

### MINOR

**m1 — `id: number` collision under wraparound is dismissed flippantly.**
"wraps via `Number.MAX_SAFE_INTEGER` only if a test runs ~9 quadrillion calls (won't)." correct in practice but the kernel doesn't even check — if some misuse re-uses ids the `pending.get(f.id)` lookup silently aliases. one-line guard (`if (pending.has(id)) throw`) costs nothing and catches programmer error during W1 development. NIT-adjacent; leaving as minor because the spec explicitly waves it away.

**m2 — `onFrame` ignores `res` for unknown id silently ("// late or unknown -> drop").**
correct policy, but combined with no logging this hides bugs. a single `console.warn` on unknown-id `res` arriving post-dispose is cheap. not a blocker; W4 won't notice.

**m3 — handler registration "last write wins" with no warning.**
§cut table: "one `register` (last write wins) is enough." reasonable, but during W1 development double-registration is a likely mistake. recommend `register` throws on duplicate (one line). overriding requires explicit `unregister` first. doesn't add surface, just safety.

### NIT

**n1 — `// W?: defer X until Y` comments are unsigned.**
five `// W?:` markers scattered (dual-port, transfer, cause-chain, cancel, push-ack). these are valuable as anchors but should reference the W item or be lifted into a single "deferred surface" section. minor doc hygiene.

**n2 — "no `seq` on push" is repeated three times.**
§wire format notes, §push channel notes, §cut table. one mention is enough.

**n3 — `EventName` type isn't named in W3.**
W4 references `EventName = keyof EventSpies` as a compile-time check on bumps. W3 keeps `topic: string`, which is fine for the kernel, but the doc could note that callers (W4) tighten `topic` to a literal union. cosmetic.

---

## drift checks (the things the prompt told me to look hard for)

- **dual-port sneaking back?** no. §topology defends single-port explicitly with a scale argument (5-10 workers, ~100 push frames/test). cut table line 1 reinforces. // W?: marker keeps the door open without building a door.
- **error envelope complexity?** no. §error propagation is literally `{name, message, stack}`. cut table explicitly kills `PeerRpcRemoteError`, cause chains, aggregate. clean.
- **AbortSignal / cancellation infra?** no. §cancellation: "not implemented." one paragraph. cut table line 8.
- **watermarks / backpressure?** no. §push channel: "no backpressure protocol, no high/kill watermarks." cut table lines 5 and 11.
- **typed-client codegen?** no. cut table line 2 kills the typed namespace proxy; §open-questions-resolved item 2 confirms.
- **naming drift v1 → v2.** the kernel class names move from `PeerRpc`/`PeerRpcClient` to `RpcClient`/`RpcServer`. file names move from `PeerRpc.ts` to `rpc-client.ts` / `rpc-server.ts`. this IS a redesign, not copy-paste — 895 lines collapse to ~80. line counts and structure support the slimming claim. however see M1: the document does not say the v1 directory gets deleted in the same PR, which leaves the rename half-done.

---

## 3. verdict

**APPROVE-WITH-CHANGES.**

W3 is the strongest v2 doc reviewed so far. it executes D-6 literally — 1174 lines → ~210 lines, 14 features cut with one-line rationales, every cut traceable to a missing caller. boss's "map, queue, fires with id, resolves on response" pattern is implemented verbatim. drift surface (dual-port, cancel, watermarks, typed clients, fancy errors) is enumerated and rejected.

required changes before merge:

1. (M1) state in §file layout that `test/harness/parallel/rpc/` is deleted in the W3 PR.
2. (M2) one sentence on worker-side dispose / late-`postMessage` behaviour.

recommended: 3. (m1, m3) cheap one-line guards for duplicate id and duplicate handler registration during W1 dev.

with those, this is the bar the other W docs should be measured against.
