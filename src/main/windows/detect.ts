import { execFile } from "child_process";
import { promisify } from "util";
import { UsbDevice, Partition } from "../../shared/types";

const execFileAsync = promisify(execFile);

interface PSDisk {
  Number: number;
  FriendlyName: string;
  Size: number;
  BusType: string;
  PartitionStyle: string;
}

interface PSPartition {
  DiskNumber: number;
  PartitionNumber: number;
  DriveLetter: string | null;
  Size: number;
  Type: string;
}

interface PSVolume {
  DriveLetter: string | null;
  FileSystemLabel: string;
  FileSystem: string;
  Size: number;
  ObjectId: string;
}

export async function listUsbDevicesWindows(): Promise<UsbDevice[]> {
  // Get USB disks
  const { stdout: diskJson } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Get-Disk | Where-Object { $_.BusType -eq 'USB' } | ` +
      `Select-Object Number,FriendlyName,Size,BusType,PartitionStyle | ` +
      `ConvertTo-Json -Compress`,
  ]);

  if (!diskJson.trim() || diskJson.trim() === "") return [];

  const parsed = JSON.parse(diskJson);
  const disks: PSDisk[] = Array.isArray(parsed) ? parsed : [parsed];

  const devices: UsbDevice[] = [];

  for (const disk of disks) {
    if (!disk) continue;

    // Get partitions for this disk
    let partitions: Partition[] = [];
    try {
      const { stdout: partJson } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Get-Partition -DiskNumber ${disk.Number} | ` +
          `Select-Object DiskNumber,PartitionNumber,DriveLetter,Size,Type | ` +
          `ConvertTo-Json -Compress`,
      ]);

      if (partJson.trim()) {
        const parts = JSON.parse(partJson);
        const partArray: PSPartition[] = Array.isArray(parts)
          ? parts
          : [parts];
        partitions = partArray
          .filter((p) => p !== null)
          .map((p) => ({
            name: `Disk${disk.Number}Part${p.PartitionNumber}`,
            path: p.DriveLetter ? `${p.DriveLetter}:` : "",
            size: formatSize(p.Size),
            mountpoint: p.DriveLetter ? `${p.DriveLetter}:\\` : null,
            label: null,
            fstype: null,
          }));
      }
    } catch {
      // Disk may have no partitions
    }

    devices.push({
      name: `disk${disk.Number}`,
      path: `\\\\.\\PhysicalDrive${disk.Number}`,
      size: formatSize(disk.Size),
      model: disk.FriendlyName || "Unknown USB Device",
      label: "",
      partitions,
    });
  }

  return devices;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)}M`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
