# Log Collection

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A session runs across more than one thread, and each thread keeps its own logs
([execution.md](./execution.md)). The thread that hits an error is usually not the one holding the logs
that explain it. Running with less isolation means fewer threads, not fewer sets of logs.

So a useful log has to be built from all of them. A **log collection** is one request — started by a
thread that hit an error, or by the application asking for one — that gathers those logs and stores them
together. How the threads reach each other, and how the logs are packed and stored, is up to the
implementation. What follows is what a collection has to do that anyone can observe.

## Requirements and invariants

**<a id="inv-log-1-p4wt6r"></a>`INV-LOG-1-P4WT6R` — A collection covers the whole session.** A collection
started from any thread MUST gather the logs of every thread of that session it can still reach, not just
the thread it started from. It MUST NOT matter which thread started it.

**<a id="inv-log-2-c7kz9m"></a>`INV-LOG-2-C7KZ9M` — Collections finish, and never wait on each other.** A
collection MUST finish within a time limit no matter how the threads are arranged, and MUST NOT keep
bouncing between them. If two threads start one at the same time, each MUST finish on its own; neither may
end up waiting for the other.

**<a id="req-log-1-h2vq8x"></a>`REQ-LOG-1-H2VQ8X` — A collection finishes before shutdown throws it away.**
A collection MUST NOT count as done until every thread it can reach has either sent its logs or been
counted as unreachable. A thread MUST stay reachable by a collection that is already running until that
thread has finished shutting down. A thread that never answers MUST be given up on after a time limit,
not waited on forever.

**<a id="req-log-2-n6bj3d"></a>`REQ-LOG-2-N6BJ3D` — The caller is told what actually happened.** When the
application asks for a collection, the answer MUST say how many threads sent their logs, how many failed
to, how many never answered, and how much was stored. It MUST NOT say it worked when that has not been
confirmed.

**<a id="req-log-3-t9fm2k"></a>`REQ-LOG-3-T9FM2K` — Writing a log line does not disturb the session.**
Writing a log line MUST NOT touch the network or disk, block protocol work, or change protocol timing
beyond a little local work. Each thread keeps only so much and throws away the oldest first. A thread with
nothing new to send MUST cost nothing — no sending, and no waiting.

**<a id="req-log-4-w5xr7q"></a>`REQ-LOG-4-W5XR7Q` — Every line says where it came from.** Every log line
MUST say which session and which participant it belongs to and which thread wrote it, and MUST carry a
timestamp that can be compared against lines from the other threads. If the session or the participant is
only known later, the lines written before that MUST still end up filed under it.

**<a id="req-log-5-st6s0g"></a>`REQ-LOG-5-ST6S0G` — Sending twice does not store twice.** Sending may
happen more than once: if a send is not confirmed it MUST be sent again, and MUST NOT be treated as
stored. Sending lines that are already stored MUST NOT store them twice or put them out of order, and the
receiver MUST NOT have to remember anything between one send and the next.

**<a id="req-log-6-q8ky4n"></a>`REQ-LOG-6-Q8KY4N` — One run's logs never overwrite another's.** Logs from
different sessions, participants, threads, and runs MUST stay apart. A later run MUST NOT overwrite an
earlier one, mix into it, or push it out.

**<a id="req-log-7-m2rc5w"></a>`REQ-LOG-7-M2RC5W` — Nothing unpacks without a limit.** Neither sending nor
reading logs may require holding an unlimited amount unpacked from a limited amount sent. A receiver MUST
stop at its limit while it unpacks, rather than unpack everything and check afterwards, and MUST say when
it left something out rather than quietly return a short log.

**<a id="req-log-9-v6smac"></a>`REQ-LOG-9-V6SMAC` — The stored logs say what the collection reached.**
A collection the application asks for MUST store, next to the logs it gathered, a record of why it ran and
of how many threads sent their logs, failed to, or never answered. A thread that never answered leaves
nothing behind, so without that record a reader cannot tell a short session from a session missing a
thread.

**<a id="req-log-10-69ctn1"></a>`REQ-LOG-10-69CTN1` — A thread that is ending waits only for its own
logs.** A thread ending because it hit an error MUST ask the threads it can reach to send theirs before it
ends, and MUST wait for its own send to finish. It MUST NOT hold its shutdown waiting for any other
thread's send.

**<a id="req-log-8-b7vn3j"></a>`REQ-LOG-8-B7VN3J` — Works wherever the runtime works.** Collection MUST
work the same whether the session runs in one thread or several, and on every supported host
([`REQ-RUNTIME-5-WJ1XKK`](execution.md#req-runtime-5-wj1xkk)) — the same way execution itself has to match
([`INV-RUNTIME-1-AKRHAK`](execution.md#inv-runtime-1-akrhak)). Fewer threads MAY mean fewer sets of logs;
it MUST NOT mean missing the ones that exist.

## Assumptions and constraints

- A thread can crash, hang, or be killed with no warning, including while a collection is running.
- The thread that hits an error often has none of the logs that explain it.
- Logs are there for development and support. They are not protocol state, and no protocol decision may
  depend on them.
- The receiver may be offline, and a send can fail for one thread and work for another.
- Lines get written before the session's identity is known, so
  [`REQ-LOG-4-W5XR7Q`](log-collection.md#req-log-4-w5xr7q) cannot assume it is known when a line is
  written.
- Each thread keeps only so much ([`REQ-LOG-3-T9FM2K`](log-collection.md#req-log-3-t9fm2k)), so a stored
  log can be missing its oldest lines. Where that happened has to be visible, not silent.

## Security considerations

Logs are built out of live protocol data and out of errors, so they are a way for secrets to leak. A log
line MUST NOT carry keys, tokens, or anything else used to authorize a request, copied by accident out of
an error or out of the request that failed. When fields are copied out of an error, they MUST be picked
from a fixed list, never by copying whatever the error happens to expose.

Some of what ends up in a log is chosen by other peers, because a peer affects what a session logs about
it. A receiver MUST NOT trust a field it is sent when deciding where to put the data, MUST limit how much
one send can store, and MUST NOT let one bad send stop the rest of the session's logs from being stored.
A receiver that expects a token MUST refuse a send without one instead of storing it.

## Verification and test plan

### Requirement test matrix

| Plan item                                               | Requirements / invariants                                  | Setup and stimulus                                                                                   | Expected result                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-log-1-p4wt6r.t1"></a>`INV-LOG-1-P4WT6R.T1`   | [`INV-LOG-1-P4WT6R`](log-collection.md#inv-log-1-p4wt6r)   | Start a collection from each thread in turn, with logs waiting in every thread.                      | Every thread's logs get stored, whichever thread started it.                                            | <a id="inv-log-1-p4wt6r.t1.p1"></a>`INV-LOG-1-P4WT6R.T1.P1` — started from the app's thread; <a id="inv-log-1-p4wt6r.t1.p2"></a>`INV-LOG-1-P4WT6R.T1.P2` — started from a middle thread; <a id="inv-log-1-p4wt6r.t1.p3"></a>`INV-LOG-1-P4WT6R.T1.P3` — started from the last thread in the chain; <a id="inv-log-1-p4wt6r.t1.p4"></a>`INV-LOG-1-P4WT6R.T1.P4` — started by an error nobody caught, not by a call; <a id="inv-log-1-p4wt6r.t1.p5"></a>`INV-LOG-1-P4WT6R.T1.P5` — several participants in one thread.                       |
| <a id="inv-log-2-c7kz9m.t1"></a>`INV-LOG-2-C7KZ9M.T1`   | [`INV-LOG-2-C7KZ9M`](log-collection.md#inv-log-2-c7kz9m)   | Start collections in two threads at once, and start another while one is still running.              | Both finish without waiting on each other; extras fold into one; none runs past the limit.              | <a id="inv-log-2-c7kz9m.t1.p1"></a>`INV-LOG-2-C7KZ9M.T1.P1` — two threads start at once; <a id="inv-log-2-c7kz9m.t1.p2"></a>`INV-LOG-2-C7KZ9M.T1.P2` — three or more start at once; <a id="inv-log-2-c7kz9m.t1.p3"></a>`INV-LOG-2-C7KZ9M.T1.P3` — another starts while one is running; <a id="inv-log-2-c7kz9m.t1.p4"></a>`INV-LOG-2-C7KZ9M.T1.P4` — two different neighbouring threads ask while one is running.                                                                                                                         |
| <a id="req-log-1-h2vq8x.t1"></a>`REQ-LOG-1-H2VQ8X.T1`   | [`REQ-LOG-1-H2VQ8X`](log-collection.md#req-log-1-h2vq8x)   | Shut the session down right after starting a collection; separately, make one thread stop answering. | Nothing written beforehand is lost; a silent thread is given up on after the limit.                     | <a id="req-log-1-h2vq8x.t1.p1"></a>`REQ-LOG-1-H2VQ8X.T1.P1` — shutdown starts while a collection is running; <a id="req-log-1-h2vq8x.t1.p2"></a>`REQ-LOG-1-H2VQ8X.T1.P2` — a thread is killed with no warning; <a id="req-log-1-h2vq8x.t1.p3"></a>`REQ-LOG-1-H2VQ8X.T1.P3` — a thread hangs past the limit; <a id="req-log-1-h2vq8x.t1.p4"></a>`REQ-LOG-1-H2VQ8X.T1.P4` — a thread already known to be gone is given up on straight away.                                                                                                 |
| <a id="req-log-2-n6bj3d.t1"></a>`REQ-LOG-2-N6BJ3D.T1`   | [`REQ-LOG-2-N6BJ3D`](log-collection.md#req-log-2-n6bj3d)   | Ask for a collection while the receiver accepts, refuses, and is not there.                          | The answer separates sent, failed and no-answer, and never claims it worked without proof.              | <a id="req-log-2-n6bj3d.t1.p1"></a>`REQ-LOG-2-N6BJ3D.T1.P1` — receiver accepts; <a id="req-log-2-n6bj3d.t1.p2"></a>`REQ-LOG-2-N6BJ3D.T1.P2` — receiver refuses; <a id="req-log-2-n6bj3d.t1.p3"></a>`REQ-LOG-2-N6BJ3D.T1.P3` — receiver is not there; <a id="req-log-2-n6bj3d.t1.p4"></a>`REQ-LOG-2-N6BJ3D.T1.P4` — different results per thread in one collection.                                                                                                                                                                        |
| <a id="req-log-3-t9fm2k.t1"></a>`REQ-LOG-3-T9FM2K.T1`   | [`REQ-LOG-3-T9FM2K`](log-collection.md#req-log-3-t9fm2k)   | Write more than a thread keeps; start a collection against a thread with nothing new.                | Oldest lines go first and the gap shows; an idle thread costs no sending and no waiting.                | <a id="req-log-3-t9fm2k.t1.p1"></a>`REQ-LOG-3-T9FM2K.T1.P1` — more written than a thread keeps; <a id="req-log-3-t9fm2k.t1.p2"></a>`REQ-LOG-3-T9FM2K.T1.P2` — idle thread sends nothing; <a id="req-log-3-t9fm2k.t1.p3"></a>`REQ-LOG-3-T9FM2K.T1.P3` — collection turned off entirely; <a id="req-log-3-t9fm2k.t1.p4"></a>`REQ-LOG-3-T9FM2K.T1.P4` — writing while the protocol is busy.                                                                                                                                                  |
| <a id="req-log-4-w5xr7q.t1"></a>`REQ-LOG-4-W5XR7Q.T1`   | [`REQ-LOG-4-W5XR7Q`](log-collection.md#req-log-4-w5xr7q)   | Write lines before the session has an identity, then give it one and collect.                        | Lines say which session, participant and thread they came from, the earlier ones included.              | <a id="req-log-4-w5xr7q.t1.p1"></a>`REQ-LOG-4-W5XR7Q.T1.P1` — identity known before any line; <a id="req-log-4-w5xr7q.t1.p2"></a>`REQ-LOG-4-W5XR7Q.T1.P2` — identity arrives after lines exist; <a id="req-log-4-w5xr7q.t1.p3"></a>`REQ-LOG-4-W5XR7Q.T1.P3` — identity arrives after an earlier collection already stored them; <a id="req-log-4-w5xr7q.t1.p4"></a>`REQ-LOG-4-W5XR7Q.T1.P4` — two participants in one thread stay apart; <a id="req-log-4-w5xr7q.t1.p5"></a>`REQ-LOG-4-W5XR7Q.T1.P5` — timestamps line up across threads. |
| <a id="req-log-5-st6s0g.t1"></a>`REQ-LOG-5-ST6S0G.T1`   | [`REQ-LOG-5-ST6S0G`](log-collection.md#req-log-5-st6s0g)   | Lose a confirmation and collect again; send an overlapping batch twice.                              | Unconfirmed lines get sent again; repeats do not double up or reorder; the receiver keeps no state.     | <a id="req-log-5-st6s0g.t1.p1"></a>`REQ-LOG-5-ST6S0G.T1.P1` — confirmation lost after storing; <a id="req-log-5-st6s0g.t1.p2"></a>`REQ-LOG-5-ST6S0G.T1.P2` — send refused then retried; <a id="req-log-5-st6s0g.t1.p3"></a>`REQ-LOG-5-ST6S0G.T1.P3` — overlapping batch sent twice; <a id="req-log-5-st6s0g.t1.p4"></a>`REQ-LOG-5-ST6S0G.T1.P4` — two sends for one session at once.                                                                                                                                                      |
| <a id="req-log-6-q8ky4n.t1"></a>`REQ-LOG-6-Q8KY4N.T1`   | [`REQ-LOG-6-Q8KY4N`](log-collection.md#req-log-6-q8ky4n)   | Run two sessions, two participants, and the same participant twice, all into one receiver.           | Each set stays apart; no run overwrites, mixes into, or pushes out another.                             | <a id="req-log-6-q8ky4n.t1.p1"></a>`REQ-LOG-6-Q8KY4N.T1.P1` — two sessions; <a id="req-log-6-q8ky4n.t1.p2"></a>`REQ-LOG-6-Q8KY4N.T1.P2` — two participants in one session; <a id="req-log-6-q8ky4n.t1.p3"></a>`REQ-LOG-6-Q8KY4N.T1.P3` — two threads of one participant; <a id="req-log-6-q8ky4n.t1.p4"></a>`REQ-LOG-6-Q8KY4N.T1.P4` — two runs reusing the same names and line numbering.                                                                                                                                                |
| <a id="req-log-7-m2rc5w.t1"></a>`REQ-LOG-7-M2RC5W.T1`   | [`REQ-LOG-7-M2RC5W`](log-collection.md#req-log-7-m2rc5w)   | Send a small batch that unpacks into a huge one; read back a log whose parts add up past the limit.  | The limit stops it while unpacking; anything left out is reported, not quietly dropped.                 | <a id="req-log-7-m2rc5w.t1.p1"></a>`REQ-LOG-7-M2RC5W.T1.P1` — one send unpacks past the limit; <a id="req-log-7-m2rc5w.t1.p2"></a>`REQ-LOG-7-M2RC5W.T1.P2` — a read adds up past the limit across many parts; <a id="req-log-7-m2rc5w.t1.p3"></a>`REQ-LOG-7-M2RC5W.T1.P3` — one bad send does not stop the rest; <a id="req-log-7-m2rc5w.t1.p4"></a>`REQ-LOG-7-M2RC5W.T1.P4` — send with no token to a receiver that expects one.                                                                                                         |
| <a id="req-log-8-b7vn3j.t1"></a>`REQ-LOG-8-B7VN3J.T1`   | [`REQ-LOG-8-B7VN3J`](log-collection.md#req-log-8-b7vn3j)   | Run the same collection with the session split across threads every way it can be, on every host.    | Same coverage and same answer; fewer sets of logs only when there are fewer threads.                    | <a id="req-log-8-b7vn3j.t1.p1"></a>`REQ-LOG-8-B7VN3J.T1.P1` — everything in one thread; <a id="req-log-8-b7vn3j.t1.p2"></a>`REQ-LOG-8-B7VN3J.T1.P2` — partly split; <a id="req-log-8-b7vn3j.t1.p3"></a>`REQ-LOG-8-B7VN3J.T1.P3` — fully split; <a id="req-log-8-b7vn3j.t1.p4"></a>`REQ-LOG-8-B7VN3J.T1.P4` — Node.js host; <a id="req-log-8-b7vn3j.t1.p5"></a>`REQ-LOG-8-B7VN3J.T1.P5` — browser host; <a id="req-log-8-b7vn3j.t1.p6"></a>`REQ-LOG-8-B7VN3J.T1.P6` — no test harness, just an app.                                        |
| <a id="req-log-9-v6smac.t1"></a>`REQ-LOG-9-V6SMAC.T1`   | [`REQ-LOG-9-V6SMAC`](log-collection.md#req-log-9-v6smac)   | Ask for a collection while every thread answers, and again while one never does.                     | The stored logs carry a record of why it ran and of how many sent, failed and never answered.           | <a id="req-log-9-v6smac.t1.p1"></a>`REQ-LOG-9-V6SMAC.T1.P1` — every thread answers; <a id="req-log-9-v6smac.t1.p2"></a>`REQ-LOG-9-V6SMAC.T1.P2` — one thread never answers; <a id="req-log-9-v6smac.t1.p3"></a>`REQ-LOG-9-V6SMAC.T1.P3` — the record is stored, not only returned to the caller; <a id="req-log-9-v6smac.t1.p4"></a>`REQ-LOG-9-V6SMAC.T1.P4` — the record matches the answer the caller got.                                                                                                                              |
| <a id="req-log-10-69ctn1.t1"></a>`REQ-LOG-10-69CTN1.T1` | [`REQ-LOG-10-69CTN1`](log-collection.md#req-log-10-69ctn1) | Make a thread end on an error while a neighbouring thread is slow to answer.                         | The ending thread sends its own logs and ends without waiting for the neighbour, which was still asked. | <a id="req-log-10-69ctn1.t1.p1"></a>`REQ-LOG-10-69CTN1.T1.P1` — a neighbour that never answers does not hold the exit; <a id="req-log-10-69ctn1.t1.p2"></a>`REQ-LOG-10-69CTN1.T1.P2` — the neighbours are asked before the exit; <a id="req-log-10-69ctn1.t1.p3"></a>`REQ-LOG-10-69CTN1.T1.P3` — the ending thread's own logs are stored first.                                                                                                                                                                                           |
