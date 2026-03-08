import { execFile } from "child_process";
import { promisify } from "util";
import {
  copyFile,
  mkdir,
  readdir,
  writeFile,
  open,
  readFile,
} from "fs/promises";
import { join, resolve } from "path";
import { getDiskNumber } from "./partition";
import {
  assignDriveLetter,
  removeDriveLetter,
  getPartitionDriveLetter,
} from "./format";
import { getGrubCfgSourcePath } from "../grub/config";

const execFileAsync = promisify(execFile);

/**
 * Get the path to bundled GRUB resources.
 * In development: <project>/resources/grub/
 * In production: <app>/resources/resources/grub/
 */
function getGrubResourcesDir(): string {
  const isDev = !process.resourcesPath?.includes("app.asar");
  if (isDev) {
    return resolve(__dirname, "..", "..", "..", "resources", "grub");
  }
  return join(process.resourcesPath, "resources", "grub");
}

/**
 * Install GRUB on Windows by copying bundled binaries.
 *
 * UEFI: Copy grubx64.efi to ESP at /EFI/BOOT/BOOTx64.EFI
 * BIOS: Write boot.img to MBR, write core.img to BIOS Boot Partition
 * Both: Copy GRUB modules and grub.cfg to data partition
 */
export async function installGrubWindows(
  devicePath: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const grubDir = getGrubResourcesDir();

  // Assign drive letters to ESP (partition 1) and Data (partition 3)
  onProgress?.("Assigning drive letters...");

  let espLetter: string;
  let dataLetter: string;

  try {
    espLetter = await assignDriveLetter(devicePath, 1);
  } catch {
    espLetter = await findFreeDriveLetter();
    await assignDriveLetterForced(devicePath, 1, espLetter);
  }

  try {
    dataLetter = await assignDriveLetter(devicePath, 3);
  } catch {
    dataLetter = await findFreeDriveLetter(espLetter);
    await assignDriveLetterForced(devicePath, 3, dataLetter);
  }

  const espRoot = `${espLetter}:\\`;
  const dataRoot = `${dataLetter}:\\`;

  try {
    // Create directory structure
    onProgress?.("Creating directory structure...");
    await mkdir(join(espRoot, "EFI", "BOOT"), { recursive: true });
    await mkdir(join(dataRoot, "boot", "grub", "i386-pc"), { recursive: true });
    await mkdir(join(dataRoot, "boot", "grub", "x86_64-efi"), {
      recursive: true,
    });
    await mkdir(join(dataRoot, "iso"), { recursive: true });

    // --- UEFI Installation ---
    onProgress?.("Installing GRUB2 for UEFI...");
    const uefiSrc = join(grubDir, "x86_64-efi");

    // Copy grubx64.efi as the default UEFI boot loader
    await copyFile(
      join(uefiSrc, "grubx64.efi"),
      join(espRoot, "EFI", "BOOT", "BOOTx64.EFI")
    );

    // Copy UEFI GRUB modules to data partition
    await copyDirectoryContents(
      uefiSrc,
      join(dataRoot, "boot", "grub", "x86_64-efi")
    );

    // --- BIOS Installation ---
    onProgress?.("Installing GRUB2 for BIOS...");
    const biosSrc = join(grubDir, "i386-pc");

    // Copy BIOS GRUB modules to data partition
    await copyDirectoryContents(
      biosSrc,
      join(dataRoot, "boot", "grub", "i386-pc")
    );

    // Write boot.img to MBR (first 440 bytes of disk)
    await writeMbr(devicePath, join(biosSrc, "boot.img"));

    // Write core.img to BIOS Boot Partition (partition 2)
    await writeBiosBootPartition(devicePath, join(biosSrc, "core.img"));

    // --- GRUB Configuration ---
    onProgress?.("Installing GRUB configuration...");
    const grubCfgSrc = getGrubCfgSourcePath();
    await copyFile(grubCfgSrc, join(dataRoot, "boot", "grub", "grub.cfg"));

    onProgress?.("GRUB installation complete.");
  } finally {
    // Remove drive letters when done
    try {
      await removeDriveLetter(devicePath, 1);
    } catch {}
    try {
      await removeDriveLetter(devicePath, 3);
    } catch {}
  }
}

/**
 * Write GRUB boot.img to the MBR of the disk (first 440 bytes).
 * Preserves the partition table (bytes 440-511).
 */
async function writeMbr(devicePath: string, bootImgPath: string): Promise<void> {
  const bootImg = await readFile(bootImgPath);

  // Only write the boot code portion (first 440 bytes), not the partition table
  const bootCode = bootImg.subarray(0, 440);

  // Read current MBR to preserve partition table
  const fd = await open(devicePath, "r+");
  try {
    const mbrBuf = Buffer.alloc(512);
    await fd.read(mbrBuf, 0, 512, 0);

    // Overwrite boot code, keep partition table intact
    bootCode.copy(mbrBuf, 0);

    await fd.write(mbrBuf, 0, 512, 0);
  } finally {
    await fd.close();
  }
}

/**
 * Write core.img to the BIOS Boot Partition (partition 2).
 * Uses PowerShell to find the partition offset and writes directly.
 */
async function writeBiosBootPartition(
  devicePath: string,
  coreImgPath: string
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);
  const coreImg = await readFile(coreImgPath);

  // Get the offset of partition 2
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Partition -DiskNumber ${diskNum} -PartitionNumber 2).Offset`,
  ]);

  const offset = parseInt(stdout.trim(), 10);
  if (isNaN(offset)) {
    throw new Error("Could not determine BIOS boot partition offset");
  }

  // Write core.img to the partition
  const fd = await open(devicePath, "r+");
  try {
    await fd.write(coreImg, 0, coreImg.length, offset);
  } finally {
    await fd.close();
  }
}

/**
 * Copy all files from one directory to another (non-recursive).
 */
async function copyDirectoryContents(
  srcDir: string,
  destDir: string
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(srcDir);
  } catch {
    return; // Source dir doesn't exist (modules not bundled)
  }

  for (const file of files) {
    try {
      await copyFile(join(srcDir, file), join(destDir, file));
    } catch {
      // Skip files that can't be copied (e.g., directories)
    }
  }
}

async function findFreeDriveLetter(exclude?: string): Promise<string> {
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `(68..90 | ForEach-Object { [char]$_ } | Where-Object { ` +
      `(Get-PSDrive -Name $_ -ErrorAction SilentlyContinue) -eq $null ` +
      `} | Select-Object -First 3) -join ','`,
  ]);

  const letters = stdout.trim().split(",").filter(Boolean);
  for (const letter of letters) {
    if (letter !== exclude) return letter;
  }
  throw new Error("No free drive letters available");
}

async function assignDriveLetterForced(
  devicePath: string,
  partitionNumber: number,
  letter: string
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);
  await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Set-Partition -DiskNumber ${diskNum} -PartitionNumber ${partitionNumber} -NewDriveLetter ${letter}`,
  ]);
}
