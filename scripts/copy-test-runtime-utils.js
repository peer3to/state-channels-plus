const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const destinationDir = path.join(projectRoot, "dist", "test", "utils");

fs.mkdirSync(destinationDir, { recursive: true });
for (const fileName of ["nodeInfra.js", "nodeInfra.d.ts"]) {
    fs.copyFileSync(
        path.join(projectRoot, "test", "utils", fileName),
        path.join(destinationDir, fileName)
    );
}
