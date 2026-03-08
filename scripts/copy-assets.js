const fs = require("fs");
const path = require("path");

const assets = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
];

for (const [src, dest] of assets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
