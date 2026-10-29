/* eslint-disable no-console */
const Mocha = require("mocha");

async function main() {
    const filePath = process.argv[2];
    if (!filePath) throw new Error("Expected a test file path");

    const mocha = new Mocha();
    mocha.addFile(filePath);
    await mocha.loadFilesAsync();
    const titles = [];
    mocha.suite.eachTest((test) => titles.push(test.fullTitle()));
    process.stdout.write(JSON.stringify(titles));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
