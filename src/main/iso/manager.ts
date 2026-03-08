import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { stat, readdir, unlink } from "fs/promises";
import { join, basename } from "path";
import { partitionPath } from "../usb/format";
import {
  mountPartition,
  unmountPartition,
  createTempMountpoint,
  removeMountpoint,
} from "../usb/mount";
import { probeIsoByFilename } from "./probe";
import { IsoFile } from "../../shared/types";

const execFileAsync = promisify(execFile);

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

    onProgress?.(0, `Copying ${basename(isoPath)}...`);

    // Use cp with pkexec for privileged copy
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("pkexec", ["cp", "--", isoPath, destPath]);

      proc.on("close", (code) => {
        if (code === 0) {
          onProgress?.(100, "Copy complete.");
          resolve();
        } else {
          reject(new Error(`cp exited with code ${code}`));
        }
      });

      proc.on("error", reject);

      // Poll file size for progress
      const interval = setInterval(async () => {
        try {
          const destStat = await stat(destPath);
          const percent = Math.min(
            99,
            Math.round((destStat.size / totalBytes) * 100)
          );
          onProgress?.(percent, `Copying ${basename(isoPath)}...`);
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
    await execFileAsync("pkexec", ["rm", "--", isoPath]);
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
      files = await readdir(isoDir);
    } catch {
      return [];
    }

    const isoFiles: IsoFile[] = [];
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".iso")) continue;

      const filePath = join(isoDir, file);
      const fileStat = await stat(filePath);

      isoFiles.push({
        name: file,
        size: fileStat.size,
        sizeHuman: formatSize(fileStat.size),
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
