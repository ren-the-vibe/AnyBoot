import { runCommand } from "../utils/command-runner";

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
  await runCommand("mkfs.fat", ["-F", "32", "-n", "EFI", esp], {
    asRoot: true,
  });

  // Format Data Partition as NTFS (supports ISO files larger than 4GB)
  await runCommand("mkfs.ntfs", ["-f", "-L", "BOOTANY", data], {
    asRoot: true,
  });
}

export { partitionPath };
