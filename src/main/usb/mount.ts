import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

export async function mountPartition(
  device: string,
  mountpoint?: string
): Promise<string> {
  const target =
    mountpoint || (await mkdtemp(join(tmpdir(), "anyboot-mount-")));

  await execFileAsync("pkexec", ["mount", device, target]);
  return target;
}

export async function unmountPartition(mountpoint: string): Promise<void> {
  try {
    await execFileAsync("pkexec", ["umount", mountpoint]);
  } catch {
    // Try lazy unmount if regular unmount fails
    await execFileAsync("pkexec", ["umount", "-l", mountpoint]);
  }
}

export async function unmountAllPartitions(
  devicePath: string
): Promise<void> {
  const { stdout } = await execFileAsync("lsblk", [
    "-J",
    "-o",
    "NAME,MOUNTPOINT",
    devicePath,
  ]);

  const data = JSON.parse(stdout);
  const device = data.blockdevices[0];

  if (device.mountpoint) {
    await unmountPartition(device.mountpoint);
  }

  for (const child of device.children || []) {
    if (child.mountpoint) {
      await unmountPartition(child.mountpoint);
    }
  }
}

export async function createTempMountpoint(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `anyboot-${prefix}-`));
}

export async function removeMountpoint(mountpoint: string): Promise<void> {
  try {
    await rmdir(mountpoint);
  } catch {
    // Ignore if directory is not empty or doesn't exist
  }
}
