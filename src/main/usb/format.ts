import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function partitionPath(devicePath: string, partNum: number): string {
  // Handle /dev/sdX vs /dev/nvmeXnYpZ naming
  if (/\d$/.test(devicePath)) {
    return `${devicePath}p${partNum}`;
  }
  return `${devicePath}${partNum}`;
}

export async function formatDrive(devicePath: string): Promise<void> {
  const esp = partitionPath(devicePath, 1);
  // Partition 2 (BIOS Boot) does not get formatted
  const data = partitionPath(devicePath, 3);

  // Format EFI System Partition as FAT32
  await execFileAsync("pkexec", [
    "mkfs.fat",
    "-F",
    "32",
    "-n",
    "EFI",
    esp,
  ]);

  // Format Data Partition as FAT32
  await execFileAsync("pkexec", [
    "mkfs.fat",
    "-F",
    "32",
    "-n",
    "ANYBOOT",
    data,
  ]);
}

export { partitionPath };
