// Mirror everything the compiled test tree needs but tsc does not emit: the
// non-TypeScript files under test/ (worker scripts, fixtures, JSON, Solidity
// sources the forge tests read) and the JavaScript runner under scripts/ that
// the runner tests require relative to themselves. Paths keep their shape, so
// dist/test/... and dist/scripts/... mirror test/... and scripts/....
const fs = require("fs");
const path = require("path");
const { writeStamp } = require("./e2e-parallel/shared/compiledTree");

const projectRoot = path.resolve(__dirname, "..");
const dist = path.join(projectRoot, "dist");

function mirror(sourceDir, keep) {
    const stack = [sourceDir];
    let copied = 0;
    while (stack.length) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const source = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") stack.push(source);
                continue;
            }
            if (!keep(source)) continue;
            const target = path.join(dist, path.relative(projectRoot, source));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
            copied++;
        }
    }
    return copied;
}

const notTypeScript = (file) => !/\.(c|m)?tsx?$/.test(file);
const copiedTest = mirror(path.join(projectRoot, "test"), notTypeScript);
const copiedScripts = mirror(path.join(projectRoot, "scripts"), notTypeScript);
// The runner compares this stamp with the sources to decide whether the
// compiled tree is current (see scripts/e2e-parallel/shared/compiledTree.js).
writeStamp(projectRoot);
console.log(
    `Mirrored ${copiedTest} test asset(s) and ${copiedScripts} runner file(s) into dist`
);
