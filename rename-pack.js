const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

// Get the package name and replace special characters (e.g., @ and /)
const packageName = packageJson.name.replace("@", "").replace("/", "-");
const fixedFileName = "peer3-local-package.tgz";

// Find the generated .tgz file (e.g., package-name-version.tgz)
const generatedFileName = `${packageName}-${packageJson.version}.tgz`;

// Check if the fixed file already exists and delete it
if (fs.existsSync(fixedFileName)) {
    fs.rmSync(fixedFileName); // Remove the existing file
    console.log(`Deleted existing file: ${fixedFileName}`);
}

// Rename the file
if (fs.existsSync(generatedFileName)) {
    fs.renameSync(generatedFileName, fixedFileName);
    console.log(`Renamed ${generatedFileName} to ${fixedFileName}`);
} else {
    console.error(`File ${generatedFileName} not found`);
}
// // Bump up the package.json version number (minor)
// const versionParts = packageJson.version.split(".");
// versionParts[2] = parseInt(versionParts[2], 10) + 1; // Increment the patch version
// packageJson.version = versionParts.join(".");

// // Write the updated package.json back to the file
// fs.writeFileSync(
//     path.join(__dirname, "package.json"),
//     JSON.stringify(packageJson, null, 2) + "\n"
// );
// console.log(`Updated package.json version to ${packageJson.version}`);
