import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

/**
 * Extract disk number from a physical drive path.
 * e.g., "\\.\PhysicalDrive2" → 2
 */
export function getDiskNumber(devicePath: string): number {
  const match = devicePath.match(/PhysicalDrive(\d+)/i);
  if (!match) throw new Error(`Invalid device path: ${devicePath}`);
  return parseInt(match[1], 10);
}

/**
 * Partition a USB drive using diskpart on Windows.
 * Creates: ESP (200MB FAT32), BIOS-compat partition (1MB), Data (remaining FAT32).
 *
 * Note: diskpart on Windows creates MBR-compatible GPT by default.
 * The BIOS Boot Partition (EF02) isn't natively supported by diskpart,
 * so we create a small "reserved" partition and set its type via PowerShell.
 */
export async function partitionDriveWindows(
  devicePath: string
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);

  // First, take the disk offline and clean it, then set up GPT partitions
  const script = [
    `select disk ${diskNum}`,
    `clean`,
    `convert gpt`,
    // Create EFI System Partition (200 MB)
    `create partition efi size=200`,
    `format fs=fat32 label="EFI" quick`,
    // Create a small partition for BIOS boot (1 MB)
    // diskpart doesn't support EF02 type, so we create a primary partition
    // and change its type via PowerShell afterward
    `create partition primary size=1`,
    // Create Data Partition (remaining space)
    `create partition primary`,
    `format fs=fat32 label="ANYBOOT" quick`,
  ].join("\n");

  const scriptPath = join(tmpdir(), `anyboot-diskpart-${Date.now()}.txt`);
  await writeFile(scriptPath, script, "utf-8");

  try {
    await execFileAsync("diskpart", ["/s", scriptPath]);
    // Only clean up on success so the file can be inspected on failure
    try { await unlink(scriptPath); } catch {}
  } catch (err: any) {
    const detail = err.stderr || err.stdout || err.message || String(err);
    throw new Error(
      `diskpart failed (script: ${scriptPath}):\n${detail}\n\n` +
      `Make sure the application is running as Administrator.`
    );
  }

  // Set the BIOS boot partition type to EF02 using PowerShell
  // Partition 2 is the 1MB partition we created
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Partition -DiskNumber ${diskNum} -PartitionNumber 2 ` +
        `-GptType '{21686148-6449-6E6F-744E-656564454649}'`,
    ]);
  } catch {
    // If this fails, BIOS boot may not work but UEFI will still be fine
    console.warn("Could not set BIOS boot partition type. UEFI boot will still work.");
  }
}
