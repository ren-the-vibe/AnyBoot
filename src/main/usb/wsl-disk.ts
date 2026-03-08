import { execFile } from "child_process";
import { promisify } from "util";
import { isWindows } from "../utils/platform";

const execFileAsync = promisify(execFile);

/**
 * On Windows, physical disks need to be attached to WSL before they can
 * be accessed as /dev/sdX block devices inside WSL.
 *
 * This requires:
 * - Windows 11 or Windows 10 build 22000+ with WSL2
 * - Running as Administrator (or with elevation)
 * - The `wsl --mount` command
 *
 * Physical disk IDs can be found via `wmic diskdrive list brief` or
 * `Get-Disk` in PowerShell.
 */

export interface WindowsDisk {
  deviceId: string; // e.g., \\.\PHYSICALDRIVE1
  model: string;
  size: string;
  mediaType: string;
}

/**
 * List physical disks on Windows using PowerShell.
 * Returns disks that appear to be removable/USB.
 */
export async function listWindowsDisks(): Promise<WindowsDisk[]> {
  if (!isWindows()) return [];

  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-Disk | Where-Object { $_.BusType -eq 'USB' } | Select-Object Number,FriendlyName,Size,MediaType | ConvertTo-Json`,
    ]);

    const parsed = JSON.parse(stdout);
    const disks = Array.isArray(parsed) ? parsed : [parsed];

    return disks
      .filter((d: any) => d !== null)
      .map((d: any) => ({
        deviceId: `\\\\.\\PHYSICALDRIVE${d.Number}`,
        model: d.FriendlyName || "Unknown",
        size: formatWindowsSize(d.Size),
        mediaType: d.MediaType || "Unknown",
      }));
  } catch {
    return [];
  }
}

/**
 * Attach a Windows physical disk to WSL so it appears as a block device.
 * Must be run as Administrator.
 * Returns the WSL device path (e.g., /dev/sdb).
 */
export async function attachDiskToWsl(
  physicalDriveId: string
): Promise<string> {
  // wsl --mount \\.\PHYSICALDRIVE1 --bare
  // --bare mounts the raw disk without auto-mounting partitions
  await execFileAsync("wsl", ["--mount", physicalDriveId, "--bare"]);

  // After mounting, find the new device in WSL
  const { stdout } = await execFileAsync("wsl", [
    "lsblk",
    "-J",
    "-o",
    "NAME,SIZE,TYPE,TRAN",
  ]);

  const data = JSON.parse(stdout);
  // The newly mounted disk should be the last one or the one matching
  // We look for the most recently added disk device
  const disks = data.blockdevices.filter(
    (d: any) => d.type === "disk" && d.name.startsWith("sd")
  );

  if (disks.length > 0) {
    // Return the last disk (most likely the newly attached one)
    return `/dev/${disks[disks.length - 1].name}`;
  }

  throw new Error("Could not find attached disk in WSL");
}

/**
 * Detach a disk from WSL.
 */
export async function detachDiskFromWsl(
  physicalDriveId: string
): Promise<void> {
  await execFileAsync("wsl", ["--unmount", physicalDriveId]);
}

function formatWindowsSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
