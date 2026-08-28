# LogFlushBus.ts — Source Report

> **Source:** [src/utils/logging/LogFlushBus.ts](../../../../../../../src/utils/logging/LogFlushBus.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

One instance per thread. It holds that thread's root loggers and one connection per neighbouring
thread, and it runs a log collection: upload this thread's own logs, ask each neighbour to do the
same, wait for their answers, and return the totals. It is the only place that knows a thread has
neighbours; loggers never see connections and connections never see loggers.

## Key design decisions

- **A collection floods outward and answers back.** A thread that receives a request forwards it on
  every connection except the one it arrived on, uploads its own logs, waits for each forwarded
  answer, and answers once. Because the connections form a tree, skipping the sender is enough to
  reach every thread exactly once and to guarantee the collection ends — no message identifiers or
  seen-sets are needed for that. The identifier a request carries exists only to match an answer to
  the request it belongs to.
- **The tree is a precondition, not an enforced invariant.** Adding a redundant connection between
  two threads that already have a path between them would make a collection circulate forever. This
  is stated on the class and enforced by review, not by a cycle check.
- **A second collection waits on the first thread's own upload, not on the whole first collection.**
  Waiting on the whole thing lets two threads that start at the same moment each end up behind the
  other's answer, which deadlocks until the time limit
  ([`INV-LOG-2-C7KZ9M`](../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m)).
- **Requests that arrive during a running collection queue one follow-up per asking thread, never one
  shared follow-up.** A follow-up skips only the connection its request came from, so a request from
  one neighbour still reaches the other. One shared follow-up that skipped both would answer each
  neighbour with the other's side missing from its count
  ([`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)).
- **A thread can ask for a collection and wait only on its own upload.** Ending a thread is the case
  for it: the neighbours have already been asked, they are still running, and their answers would
  only delay the exit ([`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).
- **What a collection reached is written back onto every root here and uploaded.** A thread that
  never answered leaves nothing in the stored logs, so the count of what was reached is the only
  thing that makes it visible to a reader ([`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
- **A connection that is removed settles whatever was waiting on it immediately**, so a thread known
  to be gone costs nothing instead of the full time limit.
- **How much of an incoming identity update to believe is decided by which side of the tree the
  other thread is on**, not by a policy each caller passes in. A parent may name a child; a child
  may only contribute the session, because a parent thread may hold several participants.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Root loggers registered by `createLogger`; connections added by the transports; control messages arriving from neighbouring threads.                                                                     |
| Outputs      | Totals for a finished collection (uploaded / failed / never answered / lines stored); control messages posted to neighbours.                                                                             |
| Owned state  | This thread's root loggers; its connections and which logger each belongs to; which loggers follow another's session; answers still owed; the running round and the follow-ups queued per asking thread. |
| Side effects | Triggers uploads through the registered loggers; posts messages to neighbouring threads; sets timers bounding how long an answer is awaited.                                                             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                             | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LogFlushBus.ts](../../../../../../../src/utils/logging/LogFlushBus.ts) | [`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r), [`INV-LOG-2-C7KZ9M`](../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m), [`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x), [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-8-B7VN3J`](../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j), [`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac), [`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

## Assumptions, dependencies, trust boundaries, and limits

- The connections of all threads together form a tree. Not checked at runtime.
- A neighbouring thread may vanish at any moment; posting to it may throw and it may never answer.
- The time limit for an answer must exceed one thread's worst-case upload, or a live upload is
  abandoned and the log is cut short.
- Whether a message survives the trip is the transport's problem, not this file's; it never touches
  the network or disk itself.
- Its own storage is bounded only by the number of registered loggers and connections, both of which
  are bounded by the session.

## Specification adherence

- A collection started anywhere reaches every thread it can, and the totals are the same whichever
  thread started it ([`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)).
- Two collections started at once each finish on their own
  ([`INV-LOG-2-C7KZ9M`](../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m)).
- A collection resolves only after every thread has uploaded or been given up on, and gives up after
  a bound ([`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)).
- The totals distinguish uploaded, failed, and never answered
  ([`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)).
- Session and participant are pushed to neighbours when they change, and to a new connection when it
  is added ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- What a collection reached is written onto every root here and uploaded with the logs
  ([`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)).
- A caller can start a collection and wait only on this thread's own upload
  ([`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).

## Specification contradictions

None demonstrated.

## Missing behavior

- Nothing prevents a caller from wiring a cycle, which
  [`INV-LOG-2-C7KZ9M`](../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m)
  forbids the _behaviour_ of. Today the precondition is documented and reviewed, not enforced.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                         | Implementation status | Evidence                                                                                                                                                                                                                                                        | Gap / divergence                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)   | Covered               | **Here:** forwards on every connection but the one a request arrived on, and sums its own upload with the answers. **Other files:** the transports add the connections.                                                                                         | None.                                                                                |
| [`INV-LOG-2-C7KZ9M`](../../../../../specification/runtime/log-collection.md#inv-log-2-c7kz9m)   | Partial               | **Here:** a queued collection waits on the running one's own upload only; repeats from one neighbour fold into that neighbour's queued collection and are answered when it ends.                                                                                | Termination relies on the tree precondition; no cycle check exists.                  |
| [`REQ-LOG-1-H2VQ8X`](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)   | Covered               | **Here:** each forwarded request settles on its answer or on the time limit; removing a connection settles its waiters at once. **Other files:** the runtime host keeps its connection until shutdown finishes.                                                 | None.                                                                                |
| [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)   | Covered               | **Here:** per-thread outcomes are summed into the totals returned to the caller; a follow-up queued per asking thread skips only that thread's connection, so each asker's total covers the tree once. **Other files:** the uploader classifies its own result. | None.                                                                                |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)   | Partial               | **Here:** identity is pushed on change and on connect, and how much of an incoming update to believe follows the tree side.                                                                                                                                     | Attaching a line to a session learned later is the uploader's part.                  |
| [`REQ-LOG-8-B7VN3J`](../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j)   | Covered               | **Here:** imports nothing platform-specific; a same-thread pair is joined without a connection. **Other files:** platform transports supply the connections.                                                                                                    | Browser paths are written but not yet executed.                                      |
| [`REQ-LOG-9-V6SMAC`](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)   | Covered               | **Here:** `recordRoundResult` writes the reason and the totals onto every root here, then uploads them. **Other files:** `Logger.uploadLogs` calls it once the collection ends.                                                                                 | None.                                                                                |
| [`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) | Partial               | **Here:** `flushOwnRealm` resolves on this thread's own upload, the neighbours having already been asked. **Other files:** the worker entry pairs it with a collection before exiting.                                                                          | A collection running in another thread counts the exiting thread as never answering. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                                                          | Public entry and setup                                                                        | Oracle and forbidden effects                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-logbus-1-q6hz2q"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q` | A collection reaches every thread, whichever one starts it.         | Join fake threads by real message channels; start a collection.                               | Every thread's logs arrive at a real receiver; no thread uploads twice.                         | <a id="unit-test-logbus-1-q6hz2q.p1"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P1` — one connected realm uploads; <a id="unit-test-logbus-1-q6hz2q.p2"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P2` — a realm two ports away uploads; <a id="unit-test-logbus-1-q6hz2q.p3"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P3` — started in the leaf, the root uploads; <a id="unit-test-logbus-1-q6hz2q.p4"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P4` — the sender is not echoed to; <a id="unit-test-logbus-1-q6hz2q.p5"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P5` — a child logger adds no second upload; <a id="unit-test-logbus-1-q6hz2q.p6"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P6` — a disposed logger is not uploaded; <a id="unit-test-logbus-1-q6hz2q.p7"></a>`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P7` — nothing is posted when uploads are off |
| <a id="unit-test-logbus-2-m0271x"></a>`UNIT-TEST-LOGBUS-2-M0271X` | Two collections at once both finish.                                | Two joined threads start one simultaneously.                                                  | Neither reports a thread as never answering; both finish under the limit.                       | <a id="unit-test-logbus-2-m0271x.p1"></a>`UNIT-TEST-LOGBUS-2-M0271X.P1` — two realms starting at once both finish; <a id="unit-test-logbus-2-m0271x.p2"></a>`UNIT-TEST-LOGBUS-2-M0271X.P2` — concurrent requests coalesce; <a id="unit-test-logbus-2-m0271x.p3"></a>`UNIT-TEST-LOGBUS-2-M0271X.P3` — a request arriving mid-round is still acked; <a id="unit-test-logbus-2-m0271x.p5"></a>`UNIT-TEST-LOGBUS-2-M0271X.P5` — two children asking during a hub round are each told the whole tree                                                                                                                                                                                                                                                                                        |
| <a id="unit-test-logbus-3-151gbt"></a>`UNIT-TEST-LOGBUS-3-151GBT` | A silent thread is given up on, a gone one costs nothing.           | Attach a connection nothing answers; separately remove one.                                   | Totals count it as never answered; removal settles immediately.                                 | <a id="unit-test-logbus-3-151gbt.p1"></a>`UNIT-TEST-LOGBUS-3-151GBT.P1` — a port that never acks is given up on; <a id="unit-test-logbus-3-151gbt.p2"></a>`UNIT-TEST-LOGBUS-3-151GBT.P2` — a port removed before the round is ignored; <a id="unit-test-logbus-3-151gbt.p3"></a>`UNIT-TEST-LOGBUS-3-151GBT.P3` — the round resolves only after every realm uploaded                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="unit-test-logbus-4-gjve9w"></a>`UNIT-TEST-LOGBUS-4-GJVE9W` | A folded request is answered only after a real upload.              | Hold a receiver response open, then have a neighbour ask.                                     | The answer never precedes the upload it stands for.                                             | <a id="unit-test-logbus-4-gjve9w.p1"></a>`UNIT-TEST-LOGBUS-4-GJVE9W.P1` — totals count one ok realm per connected thread; <a id="unit-test-logbus-4-gjve9w.p2"></a>`UNIT-TEST-LOGBUS-4-GJVE9W.P2` — a failed upload is counted failed; <a id="unit-test-logbus-4-gjve9w.p3"></a>`UNIT-TEST-LOGBUS-4-GJVE9W.P3` — a port that never acked is counted timed out; <a id="unit-test-logbus-4-gjve9w.p4"></a>`UNIT-TEST-LOGBUS-4-GJVE9W.P4` — error() uploads only this realm                                                                                                                                                                                                                                                                                                               |
| <a id="unit-test-logbus-5-xcsmzb"></a>`UNIT-TEST-LOGBUS-5-XCSMZB` | Identity crosses only in the allowed direction.                     | Push identity from a parent and from a child.                                                 | A child never sets participant identity on a parent thread.                                     | <a id="unit-test-logbus-5-xcsmzb.p1"></a>`UNIT-TEST-LOGBUS-5-XCSMZB.P1` — identity set after connecting reaches the leaf; <a id="unit-test-logbus-5-xcsmzb.p2"></a>`UNIT-TEST-LOGBUS-5-XCSMZB.P2` — a crash in the leaf files under that channel; <a id="unit-test-logbus-5-xcsmzb.p3"></a>`UNIT-TEST-LOGBUS-5-XCSMZB.P3` — a peer address from a child is refused; <a id="unit-test-logbus-5-xcsmzb.p4"></a>`UNIT-TEST-LOGBUS-5-XCSMZB.P4` — a second root in the realm follows the channel; <a id="unit-test-logbus-5-xcsmzb.p5"></a>`UNIT-TEST-LOGBUS-5-XCSMZB.P5` — identity is not passed to the following root                                                                                                                                                                   |
| <a id="unit-test-logbus-6-120mnp"></a>`UNIT-TEST-LOGBUS-6-120MNP` | Ending waits on this thread only, and a collection leaves a record. | Attach a connection nothing answers; start a collection and ask for this thread's own upload. | Resolves before the limit while the neighbour is still asked; the stored logs carry the totals. | <a id="unit-test-logbus-6-120mnp.p1"></a>`UNIT-TEST-LOGBUS-6-120MNP.P1` — own upload resolves without the neighbour's answer; <a id="unit-test-logbus-6-120mnp.p2"></a>`UNIT-TEST-LOGBUS-6-120MNP.P2` — the neighbour is asked before the own upload resolves; <a id="unit-test-logbus-6-120mnp.p3"></a>`UNIT-TEST-LOGBUS-6-120MNP.P3` — the stored logs carry what the collection reached; <a id="unit-test-logbus-6-120mnp.p4"></a>`UNIT-TEST-LOGBUS-6-120MNP.P4` — a neighbour that never answered is named in that record                                                                                                                                                                                                                                                          |

## Related source reports

- [Logger.ts.md](./Logger.ts.md) — owns the registration and the per-thread upload this file drives.
- [logControl.ts.md](./logControl.ts.md) — the message and result shapes crossing between threads.
- [LogUploader.ts.md](./LogUploader.ts.md) — performs one thread's upload and classifies its outcome.
