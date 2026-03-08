import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getDiskNumber } from "./partition";

const execFileAsync = promisify(execFile);

/**
 * On Windows, formatting is done as part of diskpart partitioning.
 * This function is a no-op since partitionDriveWindows already formats.
 *
 * It's kept for API compatibility with the Linux implementation.
 * If the partitions need re-formatting independently, this can be used.
 */
export async function formatDriveWindows(devicePath: string): Promise<void> {
  // Formatting is handled during partitioning by diskpart.
  // This function exists for API parity with the Linux side.
  // If needed, individual partition formatting can be done here.
}

/**
 * Get the drive letter assigned to a partition.
 * Returns null if no drive letter is assigned.
 */
export async function getPartitionDriveLetter(
  devicePath: string,
  partitionNumber: number
): Promise<string | null> {
  const diskNum = getDiskNumber(devicePath);

  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-Partition -DiskNumber ${diskNum} -PartitionNumber ${partitionNumber}).DriveLetter`,
    ]);

    const letter = stdout.trim();
    if (letter && letter.length === 1) {
      return letter;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Assign a drive letter to a partition using diskpart.
 */
export async function assignDriveLetter(
  devicePath: string,
  partitionNumber: number,
  letter?: string
): Promise<string> {
  const diskNum = getDiskNumber(devicePath);

  if (letter) {
    // Assign specific letter
    const script = [
      `select disk ${diskNum}`,
      `select partition ${partitionNumber}`,
      `assign letter=${letter}`,
    ].join("\n");

    const scriptPath = join(tmpdir(), `anyboot-assign-${Date.now()}.txt`);
    await writeFile(scriptPath, script, "utf-8");

    try {
      await execFileAsync("diskpart", ["/s", scriptPath]);
    } finally {
      try {
        await unlink(scriptPath);
      } catch {}
    }

    return letter;
  }

  // Auto-assign using PowerShell
  await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Add-PartitionAccessPath -DiskNumber ${diskNum} -PartitionNumber ${partitionNumber} -AssignDriveLetter`,
  ]);

  // Read back the assigned letter
  const assigned = await getPartitionDriveLetter(devicePath, partitionNumber);
  if (!assigned) throw new Error("Failed to assign drive letter");
  return assigned;
}

/**
 * Remove a drive letter from a partition.
 */
export async function removeDriveLetter(
  devicePath: string,
  partitionNumber: number
): Promise<void> {
  const diskNum = getDiskNumber(devicePath);
  const letter = await getPartitionDriveLetter(devicePath, partitionNumber);
  if (!letter) return;

  const script = [
    `select disk ${diskNum}`,
    `select partition ${partitionNumber}`,
    `remove letter=${letter}`,
  ].join("\n");

  const scriptPath = join(tmpdir(), `anyboot-remove-${Date.now()}.txt`);
  await writeFile(scriptPath, script, "utf-8");

  try {
    await execFileAsync("diskpart", ["/s", scriptPath]);
  } finally {
    try {
      await unlink(scriptPath);
    } catch {}
  }
}
