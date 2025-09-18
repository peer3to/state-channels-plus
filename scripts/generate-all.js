const { generateEthersTypes } = require("./generate-ethers-types");
const { generateCodecMappings } = require("./generate-codec-mappings");
const { generateArtifacts } = require("./generate-artifacts");

async function generateAll() {
    try {
        console.log("Generating ethers types");
        generateEthersTypes();

        console.log("Generating codec mappings");
        generateCodecMappings("./src");

        console.log("Generating artifacts");
        generateArtifacts();
    } catch (error) {
        console.error("Code generation failed:", error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    generateAll();
}

module.exports = { generateAll };
