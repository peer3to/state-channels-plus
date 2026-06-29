# coverage-grid

Static map of which byzantine variants have a test. Does not run tests.

## See coverage
1. `yarn coverage:grid`
2. open `test/V1/COVERAGE_GRID.generated.html` (or `.md`)
3. read rows: `✓` = covered, bare = gap

## Close a gap
1. pick a bare cell from the report → `Struct.field:variant`
2. write the test; link it one of two ways:
   - **inference**: use a known byzantine helper (e.g. `byzantine.submitDoubleSignBlock`) → auto-counted
   - **explicit**: `scenario("title", { target: "Struct.field:variant", setup: "proof:milestones" }, fn)`
3. `yarn coverage:grid` → cell flips to `✓`

## Track a new variant
1. add the class to the field's list in `scripts/coverage-grid/domain.ts`
2. `yarn coverage:grid` → new cell shows as a gap until a test targets it

## Tags can't drift
- run fails with `DSL errors` if a `target` / `setup` / `invariant` points at a field/class/invariant that doesn't exist → fix the tag or the domain

