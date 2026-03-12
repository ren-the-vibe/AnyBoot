import { execFile } from "child_process";
import { promisify } from "util";
import {
  copyFile,
  mkdir,
  readdir,
  writeFile,
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

  // --- BIOS Installation (raw disk writes via PowerShell) ---
  // Uses PowerShell FileStream with ReadWrite sharing to avoid EIO errors
  // from Windows volume locks on the physical drive.
  onProgress?.("Installing GRUB2 for BIOS...");
  const biosSrc = join(grubDir, "i386-pc");

  // Write boot.img to MBR (first 440 bytes of disk)
  await writeMbr(devicePath, join(biosSrc, "boot.img"));

  // Write core.img to BIOS Boot Partition
  await writeBiosBootPartition(devicePath, join(biosSrc, "core.img"), layout.biosBoot);

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
 *
 * Uses PowerShell FileStream with FileShare.ReadWrite to avoid EIO errors
 * caused by Windows holding volume locks on the physical drive.
 */
async function writeMbr(devicePath: string, bootImgPath: string): Promise<void> {
  // PowerShell script that:
  // 1. Opens the physical drive with ReadWrite sharing (avoids volume lock conflicts)
  // 2. Reads the current 512-byte MBR to preserve the partition table
  // 3. Overwrites only the first 440 bytes (boot code) with boot.img
  // 4. Writes the modified MBR back
  const ps = `
    $bootImg = [System.IO.File]::ReadAllBytes('${bootImgPath.replace(/\\/g, "\\\\")}')
    $stream = [System.IO.FileStream]::new(
      '${devicePath.replace(/\\/g, "\\\\")}',
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::ReadWrite
    )
    try {
      $mbr = New-Object byte[] 512
      [void]$stream.Read($mbr, 0, 512)
      [System.Array]::Copy($bootImg, 0, $mbr, 0, [Math]::Min($bootImg.Length, 440))
      $stream.Position = 0
      $stream.Write($mbr, 0, 512)
      $stream.Flush()
    } finally {
      $stream.Close()
    }
  `.trim();

  await execFileAsync("powershell", ["-NoProfile", "-Command", ps]);
}

/**
 * Write core.img to the BIOS Boot Partition.
 *
 * Uses PowerShell FileStream with FileShare.ReadWrite to avoid EIO errors
 * caused by Windows holding volume locks on the physical drive.
 */
async function writeBiosBootPartition(
  devicePath: string,
  coreImgPath: string,
  partitionNumber: number
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);

  // PowerShell script that:
  // 1. Finds the byte offset of the BIOS boot partition
  // 2. Opens the physical drive with ReadWrite sharing
  // 3. Writes core.img (sector-aligned) at that offset
  const ps = `
    $offset = (Get-Partition -DiskNumber ${diskNum} -PartitionNumber ${partitionNumber}).Offset
    $coreImg = [System.IO.File]::ReadAllBytes('${coreImgPath.replace(/\\/g, "\\\\")}')
    $sectorSize = 512
    $paddedLen = [Math]::Ceiling($coreImg.Length / $sectorSize) * $sectorSize
    $padded = New-Object byte[] $paddedLen
    [System.Array]::Copy($coreImg, $padded, $coreImg.Length)
    $stream = [System.IO.FileStream]::new(
      '${devicePath.replace(/\\/g, "\\\\")}',
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::ReadWrite
    )
    try {
      $stream.Position = $offset
      $stream.Write($padded, 0, $padded.Length)
      $stream.Flush()
    } finally {
      $stream.Close()
    }
  `.trim();

  await execFileAsync("powershell", ["-NoProfile", "-Command", ps]);
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
