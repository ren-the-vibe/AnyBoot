import { stat, readdir, writeFile as fsWriteFile, unlink as fsUnlink } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";
import { partitionPath } from "../usb/format";
import {
  mountPartition,
  unmountPartition,
  createTempMountpoint,
  removeMountpoint,
} from "../usb/mount";
import { probeIsoByFilename } from "./probe";
import { generateGrubCfg } from "../grub/config";
import { IsoFile } from "../../shared/types";
import { runCommand, spawnCommand, translatePath } from "../utils/command-runner";
import { isWindows } from "../utils/platform";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function addIso(
  isoPath: string,
  devicePath: string,
  onProgress?: (percent: number, message: string) => void
): Promise<void> {
  const dataDevice = partitionPath(devicePath, 3);
  const dataMount = await createTempMountpoint("data");

  try {
    await mountPartition(dataDevice, dataMount);
    const isoDir = join(dataMount, "iso");
    const destPath = join(isoDir, basename(isoPath));

    // Get source file size for progress
    const srcStat = await stat(isoPath);
    const totalBytes = srcStat.size;

    const name = basename(isoPath);
    onProgress?.(0, `Copying ${name}... 0% (0 B / ${formatSize(totalBytes)})`);

    // Translate the ISO source path for WSL if on Windows
    const srcPath = translatePath(isoPath);

    // Use cp with privilege escalation
    await new Promise<void>((resolve, reject) => {
      const proc = spawnCommand("cp", ["--", srcPath, destPath], true);

      proc.on("close", (code) => {
        if (code === 0) {
          onProgress?.(100, "Copy complete. Updating boot menu...");
          // Regenerate grub.cfg after copy
          regenerateGrubCfg(dataMount, devicePath)
            .then(() => resolve())
            .catch(() => resolve()); // non-fatal if regen fails
        } else {
          reject(new Error(`cp exited with code ${code}`));
        }
      });

      proc.on("error", reject);

      // Poll file size for progress
      // On Windows, we poll via WSL stat; on Linux, use native stat
      const interval = setInterval(async () => {
        try {
          if (isWindows()) {
            const { stdout } = await runCommand("stat", [
              "-c",
              "%s",
              destPath,
            ]);
            const currentBytes = parseInt(stdout.trim(), 10);
            if (!isNaN(currentBytes)) {
              const percent = Math.min(
                99,
                Math.round((currentBytes / totalBytes) * 100)
              );
              onProgress?.(percent, `Copying ${name}... ${percent}% (${formatSize(currentBytes)} / ${formatSize(totalBytes)})`);
            }
          } else {
            const destStat = await stat(destPath);
            const percent = Math.min(
              99,
              Math.round((destStat.size / totalBytes) * 100)
            );
            onProgress?.(percent, `Copying ${name}... ${percent}% (${formatSize(destStat.size)} / ${formatSize(totalBytes)})`);
          }
        } catch {
          // File may not exist yet
        }
      }, 500);

      proc.on("close", () => clearInterval(interval));
    });
  } finally {
    try {
      await unmountPartition(dataMount);
    } catch {}
    await removeMountpoint(dataMount);
  }
}

export async function removeIso(
  isoName: string,
  devicePath: string
): Promise<void> {
  const dataDevice = partitionPath(devicePath, 3);
  const dataMount = await createTempMountpoint("data");

  try {
    await mountPartition(dataDevice, dataMount);
    const isoPath = join(dataMount, "iso", isoName);
    await runCommand("rm", ["--", isoPath], { asRoot: true });

    // Regenerate grub.cfg after removal
    await regenerateGrubCfg(dataMount, devicePath);
  } finally {
    try {
      await unmountPartition(dataMount);
    } catch {}
    await removeMountpoint(dataMount);
  }
}

export async function listIsos(devicePath: string): Promise<IsoFile[]> {
  const dataDevice = partitionPath(devicePath, 3);
  const dataMount = await createTempMountpoint("data");

  try {
    await mountPartition(dataDevice, dataMount);
    const isoDir = join(dataMount, "iso");

    let files: string[];
    try {
      if (isWindows()) {
        // Use WSL ls to read directory contents
        const { stdout } = await runCommand("ls", [isoDir]);
        files = stdout.trim().split("\n").filter(Boolean);
      } else {
        files = await readdir(isoDir);
      }
    } catch {
      return [];
    }

    const isoFiles: IsoFile[] = [];
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".iso")) continue;

      let fileSize = 0;
      try {
        if (isWindows()) {
          const { stdout } = await runCommand("stat", [
            "-c",
            "%s",
            join(isoDir, file),
          ]);
          fileSize = parseInt(stdout.trim(), 10);
        } else {
          const fileStat = await stat(join(isoDir, file));
          fileSize = fileStat.size;
        }
      } catch {
        continue;
      }

      isoFiles.push({
        name: file,
        size: fileSize,
        sizeHuman: formatSize(fileSize),
        distroFamily: probeIsoByFilename(file),
      });
    }

    return isoFiles;
  } finally {
    try {
      await unmountPartition(dataMount);
    } catch {}
    await removeMountpoint(dataMount);
  }
}

/**
 * Scan ISOs on the mounted data partition and regenerate grub.cfg.
 * Writes to BOTH the data partition (for BIOS) and the ESP (for UEFI / Secure Boot).
 */
async function regenerateGrubCfg(
  dataMount: string,
  devicePath: string
): Promise<void> {
  const isoDir = join(dataMount, "iso");
  const isoFiles: IsoFile[] = [];

  let files: string[];
  try {
    if (isWindows()) {
      const { stdout } = await runCommand("ls", [isoDir]);
      files = stdout.trim().split("\n").filter(Boolean);
    } else {
      files = await readdir(isoDir);
    }
  } catch {
    files = [];
  }

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".iso")) continue;
    let fileSize = 0;
    try {
      if (isWindows()) {
        const { stdout } = await runCommand("stat", ["-c", "%s", join(isoDir, file)]);
        fileSize = parseInt(stdout.trim(), 10);
      } else {
        const fileStat = await stat(join(isoDir, file));
        fileSize = fileStat.size;
      }
    } catch {
      continue;
    }
    isoFiles.push({
      name: file,
      size: fileSize,
      sizeHuman: formatSize(fileSize),
      distroFamily: probeIsoByFilename(file),
    });
  }

  // Write grub.cfg to the data partition only.  The ESP holds a static
  // bootstrap config (installed once during drive preparation) that chains
  // into the data partition's config, so only this copy needs updating.
  const cfg = generateGrubCfg(isoFiles);
  const tmpPath = join(tmpdir(), `bootany-grubcfg-${Date.now()}.cfg`);
  await fsWriteFile(tmpPath, cfg, "utf-8");
  try {
    await runCommand(
      "cp",
      [tmpPath, join(dataMount, "boot", "grub", "grub.cfg")],
      { asRoot: true }
    );
  } finally {
    try { await fsUnlink(tmpPath); } catch {}
  }
}
