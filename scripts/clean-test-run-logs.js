const fs = require("node:fs");
const path = require("node:path");

const logsDirectory = path.resolve(__dirname, "../logs");
const runDirectoryPattern = /^run-\d+$/;

if (!fs.existsSync(logsDirectory)) {
    console.log("No test run logs found.");
    process.exit(0);
}

const runDirectories = fs
    .readdirSync(logsDirectory, { withFileTypes: true })
    .filter(
        (entry) => entry.isDirectory() && runDirectoryPattern.test(entry.name)
    );

for (const runDirectory of runDirectories) {
    fs.rmSync(path.join(logsDirectory, runDirectory.name), {
        recursive: true,
        force: true
    });
}

console.log(`Deleted ${runDirectories.length} test run log directories.`);
