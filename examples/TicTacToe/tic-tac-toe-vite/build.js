import fs from "fs";
import path, { dirname } from "path";
import symlinkDir from "symlink-dir";
import { fileURLToPath } from "url";
import getProviderUrl from "./getProviderUrl.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//Symlink node_modules to the build directory
async function createSymlink() {
  const target = path.resolve(__dirname, "hyperswarm", "node_modules");
  const source = path.resolve(__dirname, "dist", "node_modules");

  try {
    await symlinkDir(target, source);
    console.log(`Symlink created: ${source} -> ${target}`);
  } catch (error) {
    console.error(`Failed to create symlink: ${error.message}`);
  }
}

async function main() {
  await createSymlink();

  // Copy package.json to build directory
  fs.copyFileSync("package.json", "dist/package.json");

  // Append provider url to pear.links within package.json
  const packageJsonPath = path.join(__dirname, "dist", "package.json");
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonContent);
  if (Array.isArray(packageJson.pear?.links)) {
    packageJson.pear.links.push(getProviderUrl());
  }
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");
  
  //copy injectHyperswarm.js to build/static/js
  fs.copyFileSync("injectHyperswarm.js", "dist/assets/injectHyperswarm.min.js");

  // Path to the index.html file
  const filePath = path.join(__dirname, "dist/index.html");

  // Read the content of index.html
  let content = fs.readFileSync(filePath, "utf8");

  // Regular expression to find the first <script> tag
  const scriptTagRegex = /<script\b[^>]*>/i;
  const firstScriptMatch = content.match(scriptTagRegex);

  if (firstScriptMatch) {
    const firstScriptTag = firstScriptMatch[0];
    const scriptTagIndex = firstScriptMatch.index;

    // Add type="module" to the first script tag if it's not already present
    let newFirstScriptTag;
    if (/type\s*=\s*['"]module['"]/i.test(firstScriptTag)) {
      // Already has type="module", no changes needed
      newFirstScriptTag = firstScriptTag;
    } else {
      // Add type="module" to the first script tag
      newFirstScriptTag = firstScriptTag.replace(
        /<script\b/i,
        '<script type="module"'
      );
    }

    // The new script tag to insert
    const newScriptTag =
      '<script type="module" src="/assets/injectHyperswarm.min.js"></script>\n';

    // Insert the new script tag before the first script tag
    const updatedContent =
      content.slice(0, scriptTagIndex) +
      newScriptTag +
      newFirstScriptTag +
      content.slice(scriptTagIndex + firstScriptTag.length);

    // Write the updated content back to index.html
    fs.writeFileSync(filePath, updatedContent, "utf8");

    console.log("Successfully updated index.html");
  } else {
    console.log("No <script> tag found in index.html");
  }
}

main();
