# W3 — harness ↔ worker rpc kernel

source of truth: `test/harness/threaded/actions/meeting_notes/summary.txt` (re-read first).
cross-cutting: `W0-cross-cutting-decisions.md` D-2 (MessagePort is only orchestrator ↔ worker), D-6 (minimal surface), D-8 (push and pull, one channel).

salvage source: `test/harness/parallel/rpc/{PeerRpc,PeerRpcErrors,PeerRpcTypes}.ts`. v1 is ~60KB (dual-port, watermarks, typed-namespace proxy, zod schemas, cause-chain depth 8, diagnostics bus). target ~10KB. **keep the correlation-id map+queue; drop everything else unless a caller in W1/W2/W4/W5/W6 demands it.**

---

## goal (verbatim from master-plan W3)

> request/response with correlation ids + a push channel for spy/event signals, both over the single MessagePort pair between orchestrator and each worker. mirror of boss's evm executor pattern.

boss's verbatim pattern (meeting summary, ~3:30):

> the promise is put into a map, a queue, and it fires. it has an ID. you send it to this other execution environment. once the other execution environment is done processing that request, it returns a response with the same ID with the result. then you take the promise out of the map queue and resolve it. from the perspective of usage, it's the same.

that is the entire kernel. everything else is a smell until a caller exists.

---

## topology — one port, not two

one `MessageChannel` per worker. orchestrator holds `port1`; worker holds `port2`. both directions use the same port. both `req`/`res` and `push` frames share the queue.

### why not the v1 dual-port split

v1 split `reqPort` and `evtPort` to avoid push frames blocking req/res under load. that's solving a load problem we don't have:

- harness scale is 5–10 workers per test.
- push volume is ~1–100 frames per test (spy increments, stall signals).
- req/res volume is in the same order.
- structured-clone serialization dominates over queueing.

head-of-line blocking on a single MessagePort queue is irrelevant at this scale. if a real load test ever shows otherwise we add a second port behind the same client/server shape. **default: one port, pinned in W0 as a new D-row.**

// W?: defer dual-port topology until a measured perf issue exists.

---

## wire format

three frame shapes. that's it.

```ts
type Req = { kind: "req"; id: number; method: string; args: unknown };
type Res = {
    kind: "res";
    id: number;
    result?: unknown;
    error?: SerializedError;
};
type Push = { kind: "push"; topic: string; payload: unknown };

type Frame = Req | Res | Push;

type SerializedError = { name: string; message: string; stack?: string };
```

notes:

- `method` is a plain string. namespacing (e.g. `"transition.tryProduceBlock"`) is a convention, not a type. callers concatenate.
- per the W1 §10 cascade (D-23), the legal `method` namespaces expand from `query.*`/`tx.*`/`ingest.*`/`lifecycle.*` to also include `byzantine.*`, `rpcStub.*`, `queryInternals.*`, `network.*`, and `transition.runRegisteredOp`. wire envelope unchanged — kernel still treats `method` as an opaque string and dispatches via the worker's `register`-driven map.
- `id` is a monotonic counter per orchestrator-side client. wraps via `Number.MAX_SAFE_INTEGER` only if a test runs ~9 quadrillion calls (won't).
- success vs failure: `error` present -> failure. `result` absent on failure. no discriminated `ok: true/false` flag; the presence of `error` is the discriminator.
- no `deadlineMs`, no `cancel` frame, no `seq` on push (see below).

// W?: defer `transfer` / `Transferable[]` until a caller needs zero-copy. structured clone is fine for our payloads.

---

## correlation-id pattern (boss's exact shape)

orchestrator-side `RpcClient`:

```ts
class RpcClient {
    private nextId = 1;
    private pending = new Map<number, { resolve; reject }>();

    call(method: string, args: unknown): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            // step 1 - guard against id reuse -> catches programmer error during W1 dev
            if (this.pending.has(id)) throw new RpcDuplicateIdError(id);
            // step 2 - park the promise under its id
            this.pending.set(id, { resolve, reject });
            // step 3 - fire the req
            this.port.postMessage({ kind: "req", id, method, args });
            // step 4 - res handler below pulls + resolves
        });
    }

    private onFrame(f: Frame) {
        if (f.kind === "res") {
            const entry = this.pending.get(f.id);
            if (!entry) return; // late or unknown -> drop
            this.pending.delete(f.id);
            f.error
                ? entry.reject(deserializeError(f.error))
                : entry.resolve(f.result);
        } else if (f.kind === "push") {
            this.emit(f.topic, f.payload); // -> W4 spy/event bus
        }
    }
}
```

worker-side `RpcServer`:

```ts
class RpcServer {
    private handlers = new Map<
        string,
        (args: unknown) => unknown | Promise<unknown>
    >();

    register(method: string, fn) {
        // step 1 - guard against accidental double-register -> last-write-wins silently aliases otherwise
        if (this.handlers.has(method))
            throw new RpcDuplicateHandlerError(method);
        this.handlers.set(method, fn);
    }

    push(topic: string, payload: unknown) {
        // step 1 - one-direction worker -> orchestrator
        this.port.postMessage({ kind: "push", topic, payload });
    }

    private async onFrame(f: Frame) {
        if (f.kind !== "req") return;
        const fn = this.handlers.get(f.method);
        if (!fn) {
            this.port.postMessage({
                kind: "res",
                id: f.id,
                error: { name: "Error", message: `no handler: ${f.method}` }
            });
            return;
        }
        try {
            const result = await fn(f.args);
            this.port.postMessage({ kind: "res", id: f.id, result });
        } catch (e) {
            this.port.postMessage({
                kind: "res",
                id: f.id,
                error: serializeError(e)
            });
        }
    }
}
```

re-entrancy: handlers run on the microtask queue naturally via `await`. no per-server mutex. a handler that triggers a callback rpc to the orchestrator works because both ports drain concurrently.

---

## error propagation

```ts
function serializeError(e: unknown): SerializedError {
    if (e instanceof Error)
        return { name: e.name, message: e.message, stack: e.stack };
    return { name: "Error", message: String(e) };
}

function deserializeError(s: SerializedError): Error {
    const err = new Error(s.message);
    err.name = s.name;
    if (s.stack) err.stack = s.stack;
    return err;
}
```

that's the whole error layer. no `PeerRpcRemoteError` wrapper class, no `causeChain` walk, no `aggregateErrors`, no `ErrorKlass` union, no `serverContext`. the worker-side stack survives on `err.stack` -> debugger sees it. if a test fails on a worker-side throw, mocha prints `name: message` and the worker stack. that's enough.

// W?: defer cause-chain / aggregate support until a worker handler genuinely throws nested errors that matter for debugging.

---

## cancellation

**not implemented.** no `AbortSignal`, no `cancel` frame, no `cancelAllPendingCalls`.

rationale: nobody in W1/W2/W4/W5/W6 cancels an rpc. tests run to completion or `dispose()` blows everything up (below). if we later get a real use case (e.g. an action that needs to interrupt a long-running worker call mid-test) we add `signal` on `call()` and a `cancel` frame, in one PR.

// W?: defer cancel until a caller exists.

---

## push channel

worker → orchestrator only. covers:

- spy increments (W4)
- event-barrier signals (W4)
- loop-delay stall reports (W6)

`server.push(topic, payload)` posts a `{ kind: "push", topic, payload }`. orchestrator routes by `topic` to subscribers. no backpressure protocol, no high/kill watermarks, no diagnostic bus.

dropped frames: if the orchestrator is busy and the kernel queue fills, node's MessagePort buffers in memory. we do not engineer for the queue overflowing — at our scale it won't. if a push is genuinely lost (only on `dispose`), the next test scenario re-creates the worker and spy counts reset from zero. counts are per-test, not cumulative; there is nothing to recover.

no `seq` number on push frames. v1 had one for "sanity check, not a recovery primitive" — unused, cut.

// W?: defer push acknowledgement / replay until a caller proves a frame loss can corrupt a test outcome.

---

## dispose

```ts
dispose() {
    // step 1 - reject all in-flight with a clear error
    for (const { reject } of this.pending.values()) {
        reject(new Error("rpc client disposed"));
    }
    this.pending.clear();
    // step 2 - close the port -> the other side gets a close event
    this.port.close();
}
```

worker-side server symmetrical: stop accepting frames, close port. in-flight handlers that resolve after close discover their `postMessage` is a no-op (or throws DataCloneError on some node builds — caught and swallowed).

### race with late `postMessage`

when one side closes the port, late posts from the other side hit a closed channel. behaviour is spec'd in both directions:

- orchestrator closes first -> worker's in-flight handler eventually calls `port.postMessage({kind:"res", ...})`. node throws synchronously (typically `DataCloneError` or "port is closed"). worker's rpc layer wraps every outbound `postMessage` in try/catch and drops the frame. handler's resolved value is discarded silently.
- worker closes first -> orchestrator's `port.postMessage` for a fresh `req` throws synchronously the same way. orchestrator's rpc layer try-catches, rejects the parked pending promise with `new Error("rpc client disposed")`, and removes the entry. caller sees the same error shape as if `dispose()` had been called directly.
- both sides also listen for the port `close` event and call their own `dispose()` on receipt -> after that, every future `postMessage` is a guarded no-op, not a throw. late posts that race the close event are caught by the try/catch above.

net: a `DataCloneError` or "closed port" throw is never user-visible. either the frame is dropped (worker-side, post-dispose) or the caller's pending promise is rejected with the disposed error (orchestrator-side).

no `disposing` half-state, no `WorkerDisposingError` distinct from disposed. `dispose()` is final.

---

## what we are NOT shipping (and the v1 features cut)

each line is one sentence; if it can't be justified, it's gone.

| feature                                                              | cut because                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| dual-port topology (`reqPort` + `evtPort`)                           | no load problem at harness scale; one port suffices                                        |
| typed namespace proxy (`createTypedPeerRpcClient<T>`)                | boss didn't ask; untyped `call(method, args)` is fine and smaller                          |
| zod schema validation (`argsSchema`, `resultSchema`)                 | worker handlers can validate themselves if they care                                       |
| `register` vs `override` vs `registerOrReplace`                      | one `register` is enough; throws on duplicate -> explicit `unregister` required to replace |
| watermark / backpressure (`highWatermark`, `killWatermark`)          | not a problem at 5-10 workers                                                              |
| diagnostics bus (`onDiagnostic`, framing-error reports)              | tests fail loud on the actual error; no separate channel needed                            |
| `PeerRpcRemoteError` wrapper class + cause-chain depth 8             | `{name, message, stack}` is the debugger contract that matters                             |
| cancellation (`AbortSignal`, `cancel` frame, `cancelledIds` TTL set) | no caller                                                                                  |
| timeouts (`timeoutMs` on call)                                       | mocha test timeout already covers this                                                     |
| `WithTransfer` / transferable lists                                  | no caller; structured clone is sufficient                                                  |
| event `seq` numbers                                                  | sanity-check-only; nobody asserts on them                                                  |
| `controlPort` reservation                                            | three-port topology was speculative; gone with dual-port                                   |
| `inflightCalls()` debug accessor                                     | not currently called outside v1 tests                                                      |
| `markDisposing()` distinct from `dispose()`                          | one terminal state is enough                                                               |

---

## bigint + worker context

the v2 worker bootstrap (W2) installs `BigInt.prototype.toJSON` so structured-clone payloads stringify cleanly when logged. **the rpc kernel does not know about it.** kernel just passes `unknown` through `postMessage`; structured clone handles BigInt natively. the `toJSON` patch is purely for log printing on the worker side.

---

## file layout

```
test/harness/threaded/rpc/
  rpc-types.ts   // Frame, Req, Res, Push, SerializedError; ~30 lines
  rpc-client.ts  // RpcClient class; ~80 lines
  rpc-server.ts  // RpcServer class; ~80 lines
  rpc-errors.ts  // serializeError, deserializeError; ~20 lines
```

total target: ~210 lines, ~7-8KB.

no `__tests__/` directory in the kernel; the kernel is exercised end-to-end through any threaded W1 test. a small unit smoke test in W3's own PR is fine but optional.

### v1 deletion in the same PR

when the W3 implementation PR lands, the v1 `test/harness/parallel/rpc/` tree is deleted in the same PR. files removed:

- `test/harness/parallel/rpc/PeerRpc.ts`
- `test/harness/parallel/rpc/PeerRpcClient.ts`
- `test/harness/parallel/rpc/PeerRpcServer.ts`
- `test/harness/parallel/rpc/PeerRpcErrors.ts`
- `test/harness/parallel/rpc/PeerRpcTypes.ts`
- `test/harness/parallel/rpc/PeerApi.ts`
- `test/harness/parallel/rpc/__tests__/` (entire directory)

this upgrades the master-plan §"v1 deletion order" conditional entry ("keep only IF W3 reuses it verbatim; otherwise delete") to unconditional: W3 does not reuse v1 verbatim -> the directory goes. back-cite: master-plan.md line 148.

---

## open questions resolved here

1. **single port vs dual port?** single. push frames do not meaningfully starve req/res at our scale. -> new W0 D-row on this.
2. **typed clients?** no. untyped `call(method, args)`. namespacing is convention.
3. **bigint + error special-casing in kernel?** no. kernel is payload-agnostic; W2 owns the bigint patch for log printing.
4. **schema-required methods?** no. v1 forced zod schemas on `transition.*` / `byzantine.*` / `tamper.*` / `lifecycle.*`. cut; handlers self-validate if they care.

---

## self-review against meeting non-negotiables

- D-2 (MessagePort only orchestrator ↔ worker): satisfied, one port per worker.
- D-6 (minimal surface): every cut above is a deliberate application of this. four files, two classes, three frame shapes.
- D-8 (push and pull, one channel): satisfied, both share the port.
- boss's "map and queue, fires with an id, resolved on response" pattern: literal implementation in `RpcClient.call` + `onFrame`.

drift check: nothing in this doc adds a public api that isn't required by a named caller in W1/W2/W4/W5/W6. correlation map, push topic dispatch, error serialize, dispose. nothing else.

---

## Revision log (round 1 review)

- M1 -> added "v1 deletion in the same PR" subsection under §file layout listing the six v1 files plus `__tests__/`, and back-citing the master-plan conditional entry (master-plan.md line 148) being upgraded to unconditional.
- M2 -> added §"race with late `postMessage`" under §dispose covering both directions (orchestrator-closes-first and worker-closes-first), the try/catch around every `postMessage`, and the port `close` event triggering local `dispose()` so late posts become guarded no-ops.
- m1 -> added one-line `if (this.pending.has(id)) throw new RpcDuplicateIdError(id)` guard in `RpcClient.call` before the pending-map insert.
- m3 -> added one-line `if (this.handlers.has(method)) throw new RpcDuplicateHandlerError(method)` guard in `RpcServer.register`; updated cut table row to reflect throw-on-duplicate + explicit `unregister` to replace.

## Revision log (W1 cascade)

- added one note to §wire format — legal `method` strings expand to include `byzantine.*`, `rpcStub.*`, `queryInternals.*`, `network.*`, `transition.runRegisteredOp`. wire envelope unchanged; method remains an opaque string. -> absorbs W1 §10 cascade for D-23.
