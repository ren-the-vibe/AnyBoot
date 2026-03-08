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
 * Get a ranked list of WSL distro candidates to try.
 * Debian/Ubuntu-based distros with apt come first, then the rest.
 * Each entry is a distro name (string), or null for the default distro.
 */
function getWslCandidates() {
  const preferred = ["ubuntu", "debian"];
  const candidates = [];

  try {
    const raw = execSync("wsl --list --quiet", { encoding: "utf-8" });
    // wsl --list can output UTF-16; strip null bytes and clean up
    const distros = raw
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Add preferred distros first (by name match)
    for (const pref of preferred) {
      for (const d of distros) {
        if (d.toLowerCase().includes(pref) && !candidates.includes(d)) {
          candidates.push(d);
        }
      }
    }

    // Add remaining distros that have apt
    for (const d of distros) {
      if (!candidates.includes(d)) {
        try {
          execSync(`wsl -d ${d} -- which apt`, { stdio: "ignore" });
          candidates.push(d);
        } catch {
          // no apt, add at the end as a last resort
        }
      }
    }

    // Add any remaining distros we haven't tried (low priority)
    for (const d of distros) {
      if (!candidates.includes(d)) {
        candidates.push(d);
      }
    }
  } catch {
    // wsl --list failed; fall back to default
    candidates.push(null);
  }

  if (candidates.length === 0) {
    candidates.push(null);
  }

  return candidates;
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

  const candidates = getWslCandidates();
  let success = false;

  for (const distro of candidates) {
    const wslArgs = distro
      ? ["-d", distro, "bash", wslPath]
      : ["bash", wslPath];
    const distroLabel = distro || "default";

    console.log(`Trying WSL distro: ${distroLabel}...`);
    console.log(`WSL path: ${wslPath}`);
    console.log("");

    try {
      execFileSync("wsl", wslArgs, { stdio: "inherit" });
      success = true;
      break;
    } catch (err) {
      console.error(`\nBuild failed with distro "${distroLabel}".`);
      if (candidates.indexOf(distro) < candidates.length - 1) {
        console.error("Trying next distro...\n");
      }
    }
  }

  if (!success) {
    console.error("\nFailed to build GRUB binaries with all available WSL distros.");
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
