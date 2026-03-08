import { unmountAllPartitions } from "./mount";
import { runCommand } from "../utils/command-runner";

export async function partitionDrive(devicePath: string): Promise<void> {
  // Unmount all existing partitions first
  await unmountAllPartitions(devicePath);

  // Wipe existing partition table and create new GPT
  await runCommand("sgdisk", ["--zap-all", devicePath], { asRoot: true });

  // Create partitions:
  // 1. EFI System Partition (200MB, type EF00)
  // 2. BIOS Boot Partition (1MB, type EF02)
  // 3. Data Partition (remaining space, type 0700)
  await runCommand(
    "sgdisk",
    [
      "--new=1:0:+200M",
      "--typecode=1:EF00",
      "--change-name=1:EFI",
      "--new=2:0:+1M",
      "--typecode=2:EF02",
      "--change-name=2:BIOS",
      "--new=3:0:0",
      "--typecode=3:0700",
      "--change-name=3:ANYBOOT",
      devicePath,
    ],
    { asRoot: true }
  );

  // Create hybrid MBR for legacy BIOS compatibility
  await runCommand("sgdisk", ["--hybrid=1:2:3", devicePath], { asRoot: true });

  // Inform the kernel about partition table changes
  await runCommand("partprobe", [devicePath], { asRoot: true });

  // Wait briefly for kernel to register new partitions
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
