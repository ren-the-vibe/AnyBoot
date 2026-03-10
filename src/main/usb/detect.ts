import { UsbDevice, Partition } from "../../shared/types";
import { runCommand } from "../utils/command-runner";

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

/**
 * List all disk devices on Linux using lsblk.
 */
export async function listUsbDevices(): Promise<UsbDevice[]> {
  const { stdout } = await runCommand("lsblk", [
    "-J",
    "-o",
    "NAME,SIZE,TYPE,MOUNTPOINT,LABEL,MODEL,TRAN,FSTYPE",
  ]);

  const data: LsblkOutput = JSON.parse(stdout);
  const devices: UsbDevice[] = [];

  for (const dev of data.blockdevices) {
    if (dev.type !== "disk") continue;

    const partitions: Partition[] = (dev.children || []).map((child) => ({
      name: child.name,
      path: `/dev/${child.name}`,
      size: child.size,
      mountpoint: child.mountpoint,
      label: child.label,
      fstype: child.fstype,
    }));

    const transport = dev.tran ? ` [${dev.tran}]` : "";
    devices.push({
      name: dev.name,
      path: `/dev/${dev.name}`,
      size: dev.size,
      model: (dev.model?.trim() || "Unknown Device") + transport,
      label: dev.label || "",
      partitions,
    });
  }

  return devices;
}
