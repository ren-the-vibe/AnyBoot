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

  // "create partition efi" is not supported on removable media (USB drives),
  // so we use "create partition primary" for all partitions and set GPT
  // type GUIDs via PowerShell afterward.
  const script = [
    `select disk ${diskNum}`,
    `clean`,
    `convert gpt`,
    // Partition 1: will become EFI System Partition (200 MB)
    `create partition primary size=200`,
    `format fs=fat32 label="EFI" quick`,
    // Partition 2: will become BIOS Boot Partition (1 MB)
    `create partition primary size=1`,
    // Partition 3: Data partition (remaining space)
    `create partition primary`,
    `format fs=fat32 label="ANYBOOT" quick`,
  ].join("\n");

  const scriptPath = join(tmpdir(), `anyboot-diskpart-${Date.now()}.txt`);
  await writeFile(scriptPath, script, "utf-8");

  try {
    await execFileAsync("diskpart", ["/s", scriptPath]);
    try { await unlink(scriptPath); } catch {}
  } catch (err: any) {
    const detail = err.stderr || err.stdout || err.message || String(err);
    throw new Error(
      `diskpart failed (script: ${scriptPath}):\n${detail}\n\n` +
      `Make sure the application is running as Administrator.`
    );
  }

  // Set partition type GUIDs via PowerShell since diskpart can't on removable media.
  // Partition 1 → EFI System Partition
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Partition -DiskNumber ${diskNum} -PartitionNumber 1 ` +
        `-GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'`,
    ]);
  } catch {
    console.warn("Could not set EFI partition type. UEFI boot may not work.");
  }

  // Partition 2 → BIOS Boot Partition (EF02)
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Partition -DiskNumber ${diskNum} -PartitionNumber 2 ` +
        `-GptType '{21686148-6449-6E6F-744E-656564454649}'`,
    ]);
  } catch {
    console.warn("Could not set BIOS boot partition type. UEFI boot will still work.");
  }
}
