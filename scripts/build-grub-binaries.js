/**
 * Build GRUB2 binaries for bundling with AnyBoot.
 *
 * On Linux: runs the bash script directly.
 * On Windows: runs the bash script through WSL, preferring a Debian/Ubuntu
 *   distro since apt and grub packages are required.
 *
 * Prerequisites:
 *   Linux:     sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common
 *   Windows:   wsl -d Ubuntu sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common
 */
const { execFileSync, execSync } = require("child_process");
const path = require("path");
const os = require("os");

const scriptDir = __dirname;
const bashScript = path.join(scriptDir, "build-grub-binaries.sh");

/**
 * Find a Debian/Ubuntu-based WSL distro that has apt available.
 * Returns the distro name to pass to `wsl -d`, or null to use the default.
 */
function findDebianWslDistro() {
  // Preferred distro names (case-insensitive match)
  const preferred = ["ubuntu", "debian"];

  try {
    const raw = execSync("wsl --list --quiet", { encoding: "utf-8" });
    // wsl --list can output UTF-16; strip null bytes and clean up
    const distros = raw
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // First pass: look for a known Debian-based name
    for (const pref of preferred) {
      const match = distros.find((d) => d.toLowerCase().includes(pref));
      if (match) return match;
    }

    // Second pass: test if default distro has apt
    try {
      execSync("wsl -- which apt", { stdio: "ignore" });
      return null; // default distro has apt, use it
    } catch {
      // default doesn't have apt
    }

    // Third pass: test each distro for apt
    for (const distro of distros) {
      try {
        execSync(`wsl -d ${distro} -- which apt`, { stdio: "ignore" });
        return distro;
      } catch {
        // no apt in this distro
      }
    }
  } catch {
    // wsl --list failed
  }

  return null;
}

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

  const distro = findDebianWslDistro();
  const wslArgs = distro
    ? ["-d", distro, "bash", wslPath]
    : ["bash", wslPath];
  const distroLabel = distro || "default";

  console.log(`Running GRUB binary build via WSL (distro: ${distroLabel})...`);
  console.log(`WSL path: ${wslPath}`);
  console.log("");

  try {
    execFileSync("wsl", wslArgs, { stdio: "inherit" });
  } catch (err) {
    console.error("\nFailed to build GRUB binaries via WSL.");
    console.error("");
    console.error("This requires a Debian/Ubuntu-based WSL distro with GRUB packages.");
    console.error("To fix this:");
    console.error("  1. Install Ubuntu in WSL:  wsl --install -d Ubuntu");
    console.error("  2. Install GRUB packages:  wsl -d Ubuntu sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common");
    console.error("  3. Re-run:                 npm run build-grub");
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
