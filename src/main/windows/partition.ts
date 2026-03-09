import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { assertNotSystemDisk } from "./safety";

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

export interface PartitionLayout {
  esp: number;
  biosBoot: number;
  data: number;
}

/**
 * Query actual partition numbers by size after creation.
 * Windows may insert a hidden Microsoft Reserved Partition (MSR) on some
 * drives, shifting all partition numbers. This function identifies our
 * partitions by their size so we never rely on hardcoded numbers.
 */
export async function getPartitionLayout(
  devicePath: string
): Promise<PartitionLayout | null> {
  try {
    const diskNum = getDiskNumber(devicePath);

    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-Partition -DiskNumber ${diskNum} | ` +
        `Select-Object PartitionNumber,Size,Type | ` +
        `ConvertTo-Json -Compress`,
    ]);

    const parsed = JSON.parse(stdout.trim());
    const parts: Array<{ PartitionNumber: number; Size: number; Type: string }> =
      Array.isArray(parsed) ? parsed : [parsed];

    // Filter out Microsoft Reserved (MSR) and other system partitions by type
    const candidates = parts.filter(
      (p) => p.Type !== "Reserved" && p.Type !== "Unknown"
    );

    // Sort by partition number to get creation order
    candidates.sort((a, b) => a.PartitionNumber - b.PartitionNumber);

    // Identify by size: ESP ~200MB, BIOS Boot ~1MB, Data = largest
    const MB = 1024 * 1024;
    const espPart = candidates.find(
      (p) => p.Size >= 150 * MB && p.Size <= 250 * MB
    );
    const biosPart = candidates.find((p) => p.Size <= 2 * MB);
    const dataPart = candidates.find(
      (p) => p !== espPart && p !== biosPart && p.Size > 250 * MB
    );

    if (!espPart || !biosPart || !dataPart) {
      return null;
    }

    return {
      esp: espPart.PartitionNumber,
      biosBoot: biosPart.PartitionNumber,
      data: dataPart.PartitionNumber,
    };
  } catch {
    // PowerShell error (e.g., disk has no partitions, access denied)
    return null;
  }
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
  // Last-resort safety: never partition a system/boot disk
  await assertNotSystemDisk(devicePath);

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

  // Force Windows to rescan the partition table after diskpart
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Update-Disk -Number ${diskNum}`,
    ]);
  } catch {
    // Not fatal — Get-Partition may still work without it
  }

  // Discover actual partition numbers (may differ if Windows created an MSR).
  // Retry a few times since Windows may not have updated its cache yet.
  let layout: PartitionLayout | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    layout = await getPartitionLayout(devicePath);
    if (layout) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!layout) {
    throw new Error(
      "Partitioning completed but the new partition layout could not be detected. " +
        "Please try preparing the drive again."
    );
  }

  // Set partition type GUIDs via PowerShell since diskpart can't on removable media.
  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Partition -DiskNumber ${diskNum} -PartitionNumber ${layout.esp} ` +
        `-GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'`,
    ]);
  } catch {
    console.warn("Could not set EFI partition type. UEFI boot may not work.");
  }

  try {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Partition -DiskNumber ${diskNum} -PartitionNumber ${layout.biosBoot} ` +
        `-GptType '{21686148-6449-6E6F-744E-656564454649}'`,
    ]);
  } catch {
    console.warn("Could not set BIOS boot partition type. UEFI boot will still work.");
  }
}
