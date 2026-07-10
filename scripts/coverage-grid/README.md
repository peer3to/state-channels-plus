# coverage-grid

Static map of which subsystem variants have a test. Does not run tests.

Each subsystem folder under `test/unit/` owns a `domain.ts` defining its
variant matrices (see `test/SUBSYSTEMS.md` for the subsystem map and axes).
Tests are **native mocha `it`s**; they link to cells only through the literal
meta of the `covers()` wrapper exported by that domain - there is no
inference and no `.sol` parsing.

## See coverage

1. `yarn coverage:grid`
2. read `test/unit/COVERAGE.generated.md` (aggregate) or
   `test/unit/<subsystem>/GAPS.generated.md` (per-folder work list)

## Two matrix kinds

- `variants({ fields })` - the readable per-field form; every option of every
  field needs at least one test, fields do **not** multiply:

  ```ts
  forkId: ["valid", "unlinked", "cross-fork"]
  ```

  Include the positive/valid option - the happy path is a variant too.
- `product({ axes })` - axes that genuinely interact; every reachable
  combination (full tuple) needs a test.

## Close a gap

1. pick a cell from the folder's gap list
2. write a native `it` and wrap the body in the domain's `covers()` - the
   meta is FLAT, just field/axis names; mapping to matrices is the scanner's
   job:

   ```ts
   import { covers } from "./domain";

   it("kills a dispute whose forkId is unlinked", covers({
       forkId: "unlinked",
       proofType: "DisputeInvalidStateProof",
       carrier: "signedblocks"
   }, async function () { ... }));
   ```

   Here `forkId` claims the disputeInput variant, `proofType` claims the
   proofTypes variant, and because `proofType` + `carrier` complete the
   carrierInteraction product, that tuple is claimed too. The meta is typed
   against the domain - an unknown key or option is a compile error, and the
   error message lists the valid options. At runtime `covers()` just returns
   the body - mocha sees a plain `it`.
3. `yarn coverage:grid` -> the cell moves from gaps to covered

## Track a new variant

1. add the option (or a new field/matrix) in the folder's `domain.ts`
2. `yarn coverage:grid` -> new cells show as gaps until tests claim them

## Rules the scanner enforces (exit 1)

- every `it()` in a subsystem folder must wrap its body in `covers()` - an
  untagged test is an error
- meta must be an **object literal** - no variables, spreads, calls, or
  template substitutions. No inference means a non-literal tag would be
  silently unread; the scanner makes it loud instead.
- every meta key must claim at least one cell (a product is claimed only
  when ALL its axes are present) - a dead key is an error with a hint
- a field name may live in at most one variants matrix per domain - the
  scanner rejects ambiguous domains at load
- claiming an `unreachable` cell is an error - fix the tag or the domain rule
- `it.skip` needs a `blocked:` reason in its meta; its cells count as
  *planned*, not covered
- `it.only` must not be committed

`unreachable` in `domain.ts` = the cell cannot exist (a constraint of the
space). `it.skip` + `blocked:` = the test should exist but is blocked. Keep
the two apart.
