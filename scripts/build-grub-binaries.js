/**
 * Build GRUB2 binaries for bundling with AnyBoot.
 *
 * On Linux: runs the bash script directly.
 * On Windows: runs the bash script through WSL.
 *
 * Prerequisites:
 *   Linux/WSL: sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common
 */
const { execFileSync, execSync } = require("child_process");
const path = require("path");
const os = require("os");

const scriptDir = __dirname;
const bashScript = path.join(scriptDir, "build-grub-binaries.sh");

if (os.platform() === "win32") {
  // Convert Windows path to WSL path
  const match = bashScript.match(/^([A-Za-z]):[\\\/](.*)/);
  let wslPath;
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, "/");
    wslPath = `/mnt/${drive}/${rest}`;
  } else {
    wslPath = bashScript.replace(/\\/g, "/");
  }

  console.log("Running GRUB binary build via WSL...");
  console.log(`WSL path: ${wslPath}`);
  console.log("");
  console.log("If this fails, first install the required packages in WSL:");
  console.log("  wsl sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common");
  console.log("");

  try {
    execFileSync("wsl", ["bash", wslPath], { stdio: "inherit" });
  } catch (err) {
    console.error("\nFailed to build GRUB binaries via WSL.");
    console.error("Make sure WSL is installed and the grub packages are available.");
    process.exit(1);
  }
} else {
  console.log("Running GRUB binary build...");
  try {
    execFileSync("bash", [bashScript], { stdio: "inherit" });
  } catch (err) {
    console.error("\nFailed to build GRUB binaries.");
    console.error("Install: sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common");
    process.exit(1);
  }
}
