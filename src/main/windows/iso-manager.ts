import { stat, readdir, unlink, mkdir } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
import { IsoFile } from "../../shared/types";
import { probeIsoByFilename } from "../iso/probe";
import { getPartitionLayout } from "./partition";
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
 * Get access to the data partition by ensuring it has a drive letter.
 * Returns the root path (e.g., "E:\") and a cleanup function to remove the letter.
 */
async function withDataPartition(
  devicePath: string,
  fn: (dataRoot: string) => Promise<void>
): Promise<void> {
  const layout = await getPartitionLayout(devicePath);
  if (!layout) {
    throw new Error("DRIVE_NOT_PREPARED");
  }
  let letter = await getPartitionDriveLetter(devicePath, layout.data);
  let assignedByUs = false;

  if (!letter) {
    letter = await assignDriveLetter(devicePath, layout.data);
    assignedByUs = true;
  }

  const dataRoot = `${letter}:\\`;

  try {
    await fn(dataRoot);
  } finally {
    if (assignedByUs) {
      try {
        await removeDriveLetter(devicePath, layout.data);
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
    await mkdir(isoDir, { recursive: true });
    const name = basename(isoPath);
    const destPath = join(isoDir, name);

    const srcStat = await stat(isoPath);
    const totalBytes = srcStat.size;

    onProgress?.(0, `Copying ${name}... 0% (0 B / ${formatSize(totalBytes)})`);

    // Use streaming copy instead of copyFile — NTFS pre-allocates the full
    // file size, so stat-polling the destination always reports 100% instantly.
    const src = createReadStream(isoPath);
    const dest = createWriteStream(destPath);
    let copiedBytes = 0;

    src.on("data", (chunk: string | Buffer) => {
      copiedBytes += chunk.length;
      const percent = Math.min(99, Math.round((copiedBytes / totalBytes) * 100));
      onProgress?.(percent, `Copying ${name}... ${percent}% (${formatSize(copiedBytes)} / ${formatSize(totalBytes)})`);
    });

    await pipeline(src, dest);
    onProgress?.(100, "Copy complete.");
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

  try {
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
  } catch (err: any) {
    if (err.message === "DRIVE_NOT_PREPARED") {
      return [];
    }
    throw err;
  }

  return isoFiles;
}
