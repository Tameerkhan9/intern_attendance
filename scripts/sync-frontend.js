const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const sourceDir = path.join(rootDir, "frontend");
const targetDir = path.join(rootDir, "public");

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of ["index.html", "app.js", "styles.css"]) {
  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}

console.log("Synced frontend files to public/");
