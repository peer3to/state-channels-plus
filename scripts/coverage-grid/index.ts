// run: yarn coverage:grid  ->  COVERAGE_GRID.generated.{md,html}

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { ROOT, OUT_MD, OUT_HTML, ECHARTS_CDN } from "./domain";
import { buildModel } from "./build";
import { renderMd } from "./render-md";
import { renderHtml } from "./render-html";

function download(url: string, dest: string): Promise<boolean> {
    return new Promise((resolve) => {
        const file = fs.createWriteStream(dest);
        https
            .get(url, (res) => {
                const code = res.statusCode ?? 0;
                if (code >= 300 && code < 400 && res.headers.location) {
                    file.close();
                    fs.rmSync(dest, { force: true });
                    return resolve(download(res.headers.location, dest));
                }
                if (code !== 200) {
                    file.close();
                    fs.rmSync(dest, { force: true });
                    return resolve(false);
                }
                res.pipe(file);
                file.on("finish", () => file.close(() => resolve(true)));
            })
            .on("error", () => {
                file.close();
                fs.rmSync(dest, { force: true });
                resolve(false);
            });
    });
}

async function ensureEcharts(): Promise<string> {
    const dest = path.join(path.dirname(OUT_HTML), "echarts.min.js");
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500_000)
        return "echarts.min.js";
    return (await download(ECHARTS_CDN, dest)) ? "echarts.min.js" : ECHARTS_CDN;
}

async function main() {
    const model = buildModel();
    const echartsSrc = await ensureEcharts();
    fs.writeFileSync(OUT_MD, renderMd(model));
    fs.writeFileSync(OUT_HTML, renderHtml(model, echartsSrc));
    const s = model.summary;
    console.log(`coverage-grid ->`);
    console.log(`  ${path.relative(ROOT, OUT_MD)}`);
    console.log(
        `  ${path.relative(ROOT, OUT_HTML)}  (echarts: ${echartsSrc === "echarts.min.js" ? "vendored locally" : "CDN fallback"})`
    );
    console.log(
        `  scenarios ${s.scenarios} · proof types ${s.proofsCovered}/${s.proofsTotal} · cells ${s.cellsCovered}/${s.cellsTotal}`
    );
    console.log(
        `  gaps: ${model.gaps.length}   DSL errors: ${model.errors.length}   cross-check mismatches: ${model.crossChecks.length}`
    );
    for (const e of model.errors.slice(0, 6)) console.log(`    DSL! ${e}`);
    for (const c of model.crossChecks.slice(0, 6))
        console.log(`    cross! ${c}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
