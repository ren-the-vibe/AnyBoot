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
import { getDiskNumber, getPartitionLayout } from "./partition";
import {
  assignDriveLetter,
  removeDriveLetter,
  getPartitionDriveLetter,
} from "./format";
import { writeGeneratedGrubCfg } from "../grub/config";

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
  const diskNum = getDiskNumber(devicePath);
  const layout = await getPartitionLayout(devicePath);
  if (!layout) {
    throw new Error(
      "Cannot install GRUB: drive does not have the expected BootAny partition layout. " +
        "Please prepare the drive first."
    );
  }

  // --- BIOS Installation (raw disk writes) ---
  // Must happen BEFORE mounting volumes: Windows blocks raw physical drive
  // writes while any volume on the disk is mounted.
  onProgress?.("Installing GRUB2 for BIOS...");
  const biosSrc = join(grubDir, "i386-pc");

  // Offline the disk to release any auto-mounted volumes from partitioning
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Disk -Number ${diskNum} -IsOffline $true`,
    ]);
  } catch {
    // May already be offline or not supported — continue anyway
  }

  try {
    // Write boot.img to MBR (first 440 bytes of disk)
    await writeMbr(devicePath, join(biosSrc, "boot.img"));

    // Write core.img to BIOS Boot Partition
    await writeBiosBootPartition(devicePath, join(biosSrc, "core.img"), layout.biosBoot);
  } finally {
    // Bring the disk back online so volumes can be mounted
    try {
      await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Set-Disk -Number ${diskNum} -IsOffline $false`,
      ]);
    } catch {}
  }

  // --- Mount volumes for file-level operations ---
  onProgress?.("Assigning drive letters...");

  let espLetter: string;
  let dataLetter: string;

  try {
    espLetter = await assignDriveLetter(devicePath, layout.esp);
  } catch {
    espLetter = await findFreeDriveLetter();
    await assignDriveLetterForced(devicePath, layout.esp, espLetter);
  }

  try {
    dataLetter = await assignDriveLetter(devicePath, layout.data);
  } catch {
    dataLetter = await findFreeDriveLetter(espLetter);
    await assignDriveLetterForced(devicePath, layout.data, dataLetter);
  }

  const espRoot = `${espLetter}:\\`;
  const dataRoot = `${dataLetter}:\\`;

  try {
    // Create directory structure
    onProgress?.("Creating directory structure...");
    await mkdir(join(espRoot, "EFI", "BOOT"), { recursive: true });
    await mkdir(join(espRoot, "EFI", "ubuntu"), { recursive: true });
    await mkdir(join(dataRoot, "boot", "grub", "i386-pc"), { recursive: true });
    await mkdir(join(dataRoot, "boot", "grub", "x86_64-efi"), {
      recursive: true,
    });
    await mkdir(join(dataRoot, "iso"), { recursive: true });

    // --- UEFI Installation (Secure Boot compatible) ---
    onProgress?.("Installing GRUB2 for UEFI (Secure Boot)...");
    const uefiSrc = join(grubDir, "x86_64-efi");

    // Secure Boot chain: shim (Microsoft-signed) → signed GRUB → our config
    await copyFile(
      join(uefiSrc, "shimx64.efi.signed"),
      join(espRoot, "EFI", "BOOT", "BOOTx64.EFI")
    );
    await copyFile(
      join(uefiSrc, "grubx64.efi.signed"),
      join(espRoot, "EFI", "BOOT", "grubx64.efi")
    );
    await copyFile(
      join(uefiSrc, "mmx64.efi"),
      join(espRoot, "EFI", "BOOT", "mmx64.efi")
    );

    // Copy UEFI GRUB modules to data partition
    await copyDirectoryContents(
      uefiSrc,
      join(dataRoot, "boot", "grub", "x86_64-efi")
    );

    // Copy BIOS GRUB modules to data partition
    onProgress?.("Copying BIOS GRUB modules...");
    await copyDirectoryContents(
      biosSrc,
      join(dataRoot, "boot", "grub", "i386-pc")
    );

    // --- GRUB Configuration ---
    // Generate initial grub.cfg (no ISOs yet — menu rebuilt when ISOs are added).
    // Written to BOTH the ESP and the data partition:
    //  - ESP  /EFI/ubuntu/grub.cfg  → loaded by signed GRUB (UEFI / Secure Boot)
    //  - Data /boot/grub/grub.cfg   → loaded by BIOS GRUB
    onProgress?.("Installing GRUB configuration...");
    await writeGeneratedGrubCfg(join(espRoot, "EFI", "ubuntu", "grub.cfg"), []);
    await writeGeneratedGrubCfg(join(dataRoot, "boot", "grub", "grub.cfg"), []);

    onProgress?.("GRUB installation complete.");
  } finally {
    // Remove ESP drive letter (users don't need to browse the EFI partition).
    // Keep the data partition letter so the drive is accessible in Explorer.
    try {
      await removeDriveLetter(devicePath, layout.esp);
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
 * Write core.img to the BIOS Boot Partition.
 * Uses PowerShell to find the partition offset and writes directly.
 */
async function writeBiosBootPartition(
  devicePath: string,
  coreImgPath: string,
  partitionNumber: number
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);
  const coreImg = await readFile(coreImgPath);

  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Partition -DiskNumber ${diskNum} -PartitionNumber ${partitionNumber}).Offset`,
  ]);

  const offset = parseInt(stdout.trim(), 10);
  if (isNaN(offset)) {
    throw new Error("Could not determine BIOS boot partition offset");
  }

  // Write core.img to the partition.
  // Windows raw device I/O requires writes to be a multiple of the sector size.
  const sectorSize = 512;
  const paddedLen = Math.ceil(coreImg.length / sectorSize) * sectorSize;
  const paddedBuf = Buffer.alloc(paddedLen);
  coreImg.copy(paddedBuf);

  const fd = await open(devicePath, "r+");
  try {
    await fd.write(paddedBuf, 0, paddedBuf.length, offset);
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
