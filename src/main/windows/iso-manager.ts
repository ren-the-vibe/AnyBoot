import { copyFile, stat, readdir, unlink } from "fs/promises";
import { join, basename } from "path";
import { IsoFile } from "../../shared/types";
import { probeIsoByFilename } from "../iso/probe";
import { getDiskNumber } from "./partition";
import {
  assignDriveLetter,
  removeDriveLetter,
  getPartitionDriveLetter,
} from "./format";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Get access to the data partition (partition 3) by ensuring it has a drive letter.
 * Returns the root path (e.g., "E:\") and a cleanup function to remove the letter.
 */
async function withDataPartition(
  devicePath: string,
  fn: (dataRoot: string) => Promise<void>
): Promise<void> {
  let letter = await getPartitionDriveLetter(devicePath, 3);
  let assignedByUs = false;

  if (!letter) {
    letter = await assignDriveLetter(devicePath, 3);
    assignedByUs = true;
  }

  const dataRoot = `${letter}:\\`;

  try {
    await fn(dataRoot);
  } finally {
    if (assignedByUs) {
      try {
        await removeDriveLetter(devicePath, 3);
      } catch {}
    }
  }
}

export async function addIsoWindows(
  isoPath: string,
  devicePath: string,
  onProgress?: (percent: number, message: string) => void
): Promise<void> {
  await withDataPartition(devicePath, async (dataRoot) => {
    const isoDir = join(dataRoot, "iso");
    const destPath = join(isoDir, basename(isoPath));

    const srcStat = await stat(isoPath);
    const totalBytes = srcStat.size;

    onProgress?.(0, `Copying ${basename(isoPath)}...`);

    // Use Node.js native file copy with progress polling
    const copyPromise = copyFile(isoPath, destPath);

    // Poll destination file size for progress
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

    try {
      await copyPromise;
      onProgress?.(100, "Copy complete.");
    } finally {
      clearInterval(interval);
    }
  });
}

export async function removeIsoWindows(
  isoName: string,
  devicePath: string
): Promise<void> {
  await withDataPartition(devicePath, async (dataRoot) => {
    const isoPath = join(dataRoot, "iso", isoName);
    await unlink(isoPath);
  });
}

export async function listIsosWindows(
  devicePath: string
): Promise<IsoFile[]> {
  const isoFiles: IsoFile[] = [];

  await withDataPartition(devicePath, async (dataRoot) => {
    const isoDir = join(dataRoot, "iso");

    let files: string[];
    try {
      files = await readdir(isoDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.toLowerCase().endsWith(".iso")) continue;

      try {
        const fileStat = await stat(join(isoDir, file));
        isoFiles.push({
          name: file,
          size: fileStat.size,
          sizeHuman: formatSize(fileStat.size),
          distroFamily: probeIsoByFilename(file),
        });
      } catch {
        continue;
      }
    }
  });

  return isoFiles;
}
