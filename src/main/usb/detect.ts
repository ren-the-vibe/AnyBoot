import { UsbDevice, Partition } from "../../shared/types";
import { runCommand } from "../utils/command-runner";
import { isWindows } from "../utils/platform";

interface LsblkDevice {
  name: string;
  size: string;
  type: string;
  mountpoint: string | null;
  label: string | null;
  model: string | null;
  tran: string | null;
  fstype: string | null;
  children?: LsblkDevice[];
}

interface LsblkOutput {
  blockdevices: LsblkDevice[];
}

export async function listUsbDevices(): Promise<UsbDevice[]> {
  if (isWindows()) {
    return listUsbDevicesWsl();
  }
  return listUsbDevicesNative();
}

async function listUsbDevicesNative(): Promise<UsbDevice[]> {
  const { stdout } = await runCommand("lsblk", [
    "-J",
    "-o",
    "NAME,SIZE,TYPE,MOUNTPOINT,LABEL,MODEL,TRAN,FSTYPE",
  ]);

  return parseLsblkOutput(stdout);
}

async function listUsbDevicesWsl(): Promise<UsbDevice[]> {
  // On Windows, USB drives must be attached to WSL via `wsl --mount`
  // before they appear as block devices. We check both:
  // 1. Disks already attached to WSL (via lsblk)
  // 2. Windows USB disks not yet attached (via PowerShell)
  const devices: UsbDevice[] = [];

  // Check WSL-attached disks
  try {
    const { stdout } = await runCommand("lsblk", [
      "-J",
      "-o",
      "NAME,SIZE,TYPE,MOUNTPOINT,LABEL,MODEL,TRAN,FSTYPE",
    ]);
    devices.push(...parseLsblkOutput(stdout));
  } catch {
    // lsblk may fail if no disks are mounted in WSL yet
  }

  // Also list Windows USB disks not yet attached
  try {
    const { listWindowsDisks } = await import("./wsl-disk");
    const winDisks = await listWindowsDisks();
    for (const disk of winDisks) {
      // Skip if already attached (would show up in lsblk)
      const alreadyAttached = devices.some((d) => d.model === disk.model);
      if (!alreadyAttached) {
        devices.push({
          name: disk.deviceId,
          path: disk.deviceId, // Windows physical drive path
          size: disk.size,
          model: `${disk.model} (not attached to WSL)`,
          label: "",
          partitions: [],
        });
      }
    }
  } catch {
    // PowerShell may not be available
  }

  return devices;
}

function parseLsblkOutput(stdout: string): UsbDevice[] {
  const data: LsblkOutput = JSON.parse(stdout);
  const usbDevices: UsbDevice[] = [];

  for (const dev of data.blockdevices) {
    if (dev.type !== "disk") continue;
    if (dev.tran !== "usb") continue;

    const partitions: Partition[] = (dev.children || []).map((child) => ({
      name: child.name,
      path: `/dev/${child.name}`,
      size: child.size,
      mountpoint: child.mountpoint,
      label: child.label,
      fstype: child.fstype,
    }));

    usbDevices.push({
      name: dev.name,
      path: `/dev/${dev.name}`,
      size: dev.size,
      model: dev.model?.trim() || "Unknown USB Device",
      label: dev.label || "",
      partitions,
    });
  }

  return usbDevices;
}

export async function isUsbDevice(devicePath: string): Promise<boolean> {
  const devices = await listUsbDevices();
  return devices.some((d) => d.path === devicePath);
}
