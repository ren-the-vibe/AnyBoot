import { execFile } from "child_process";
import { promisify } from "util";
import { UsbDevice, Partition } from "../../shared/types";

const execFileAsync = promisify(execFile);

interface PSDisk {
  Number: number;
  FriendlyName: string;
  Size: number;
  BusType: number | string;
  MediaType: string;
  PartitionStyle: string;
  IsSystem: boolean;
  IsBoot: boolean;
}

interface PSPartition {
  DiskNumber: number;
  PartitionNumber: number;
  DriveLetter: string | null;
  Size: number;
  Type: string;
}

export async function listUsbDevicesWindows(): Promise<UsbDevice[]> {
  // List all disks - users creating multiboot drives know what they're doing
  const { stdout: diskJson } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Get-Disk | Where-Object { $_.Size -gt 0 } | Select-Object Number,FriendlyName,Size,BusType,MediaType,PartitionStyle,IsSystem,IsBoot | ConvertTo-Json -Compress`,
  ]);

  if (!diskJson.trim() || diskJson.trim() === "") return [];

  let parsed: any;
  try {
    parsed = JSON.parse(diskJson);
  } catch {
    return [];
  }

  const disks: PSDisk[] = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (d) => d && d.IsSystem !== true && d.IsBoot !== true
  );
  const devices: UsbDevice[] = [];

  for (const disk of disks) {
    if (!disk) continue;

    // Get partitions for this disk
    let partitions: Partition[] = [];
    try {
      const { stdout: partJson } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Get-Partition -DiskNumber ${disk.Number} -ErrorAction SilentlyContinue | ` +
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
      // Disk may have no partitions (uninitialized)
    }

    devices.push({
      name: `disk${disk.Number}`,
      path: `\\\\.\\PhysicalDrive${disk.Number}`,
      size: formatSize(disk.Size),
      model: `${disk.FriendlyName || "Unknown Device"} [${disk.BusType}]`,
      label: "",
      partitions,
    });
  }

  return devices;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0B";
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)}M`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
