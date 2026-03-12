import { stat, readdir, unlink, mkdir } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
import { IsoFile } from "../../shared/types";
import { probeIsoByFilename } from "../iso/probe";
import { writeGeneratedGrubCfg } from "../grub/config";
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

/**
 * Write grub.cfg to both the data partition and the ESP.
 * The ESP copy is loaded by the signed GRUB (UEFI / Secure Boot),
 * while the data copy is loaded by BIOS GRUB.
 */
async function writeGrubCfgToAll(
  devicePath: string,
  dataRoot: string,
  isos: IsoFile[]
): Promise<void> {
  // Data partition (BIOS boot)
  await writeGeneratedGrubCfg(join(dataRoot, "boot", "grub", "grub.cfg"), isos);

  // ESP (UEFI / Secure Boot) — signed GRUB loads from /EFI/ubuntu/grub.cfg
  const layout = await getPartitionLayout(devicePath);
  if (!layout) return;

  let espLetter = await getPartitionDriveLetter(devicePath, layout.esp);
  let espAssignedByUs = false;

  if (!espLetter) {
    try {
      espLetter = await assignDriveLetter(devicePath, layout.esp);
      espAssignedByUs = true;
    } catch {
      // Non-fatal: data partition copy still works for BIOS boot
      return;
    }
  }

  try {
    const espRoot = `${espLetter}:\\`;
    await writeGeneratedGrubCfg(
      join(espRoot, "EFI", "ubuntu", "grub.cfg"),
      isos
    );
  } finally {
    if (espAssignedByUs) {
      try {
        await removeDriveLetter(devicePath, layout.esp);
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
    onProgress?.(100, "Copy complete. Updating boot menu...");

    // Regenerate grub.cfg on both data partition and ESP
    const isos = await scanIsos(dataRoot);
    await writeGrubCfgToAll(devicePath, dataRoot, isos);
  });
}

export async function removeIsoWindows(
  isoName: string,
  devicePath: string
): Promise<void> {
  await withDataPartition(devicePath, async (dataRoot) => {
    const isoPath = join(dataRoot, "iso", isoName);
    await unlink(isoPath);

    // Regenerate grub.cfg on both data partition and ESP
    const isos = await scanIsos(dataRoot);
    await writeGrubCfgToAll(devicePath, dataRoot, isos);
  });
}

/**
 * Scan the iso/ directory on a mounted data partition and return IsoFile[].
 */
async function scanIsos(dataRoot: string): Promise<IsoFile[]> {
  const isoDir = join(dataRoot, "iso");
  const isoFiles: IsoFile[] = [];

  let files: string[];
  try {
    files = await readdir(isoDir);
  } catch {
    return [];
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

  return isoFiles;
}

export async function listIsosWindows(
  devicePath: string
): Promise<IsoFile[]> {
  let isoFiles: IsoFile[] = [];

  try {
    await withDataPartition(devicePath, async (dataRoot) => {
      isoFiles = await scanIsos(dataRoot);
    });
  } catch (err: any) {
    if (err.message === "DRIVE_NOT_PREPARED") {
      return [];
    }
    throw err;
  }

  return isoFiles;
}
