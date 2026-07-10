// run: yarn coverage:grid
//   -> test/unit/<subsystem>/GAPS.generated.md   (per-folder work list)
//   -> test/unit/COVERAGE.generated.md           (aggregate index)
// exits non-zero on any invalid tag, so CI catches drift.

import * as fs from "fs";
import * as path from "path";
import { listSubsystemFolders, scanSubsystem, UNIT_DIR, ROOT } from "./scan";
import {
    buildSubsystemReport,
    renderAggregateMd,
    renderFolderMd
} from "./report";

function main(): void {
    const reports = listSubsystemFolders().map((folder) =>
        buildSubsystemReport(scanSubsystem(folder))
    );

    for (const report of reports) {
        const out = path.join(UNIT_DIR, report.folder, "GAPS.generated.md");
        fs.writeFileSync(out, renderFolderMd(report));
        console.log(`  ${path.relative(ROOT, out)}`);
    }
    const aggregate = path.join(UNIT_DIR, "COVERAGE.generated.md");
    fs.writeFileSync(aggregate, renderAggregateMd(reports));
    console.log(`  ${path.relative(ROOT, aggregate)}`);

    let covered = 0;
    let reachable = 0;
    let gaps = 0;
    const errors = reports.flatMap((r) => r.errors);
    for (const r of reports)
        for (const m of r.matrices) {
            covered += m.covered.length;
            reachable += m.reachable;
            gaps += m.gaps.length;
        }
    console.log(
        `coverage-grid: ${reports.length} subsystem(s) · ${covered}/${reachable} cells covered · ${gaps} gaps · ${errors.length} errors`
    );
    for (const e of errors) console.error(`  error: ${e}`);
    if (errors.length) process.exit(1);
}

main();
