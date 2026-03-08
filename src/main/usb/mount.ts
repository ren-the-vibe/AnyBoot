import { mkdtemp, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runCommand } from "../utils/command-runner";
import { isWindows } from "../utils/platform";

export async function mountPartition(
  device: string,
  mountpoint?: string
): Promise<string> {
  const target =
    mountpoint || (await createTempMountpoint("mount"));

  if (isWindows()) {
    // In WSL, create mountpoint inside WSL's filesystem and mount there
    await runCommand("mkdir", ["-p", target], { asRoot: true });
  }

  await runCommand("mount", [device, target], { asRoot: true });
  return target;
}

export async function unmountPartition(mountpoint: string): Promise<void> {
  try {
    await runCommand("umount", [mountpoint], { asRoot: true });
  } catch {
    // Try lazy unmount if regular unmount fails
    await runCommand("umount", ["-l", mountpoint], { asRoot: true });
  }
}

export async function unmountAllPartitions(
  devicePath: string
): Promise<void> {
  const { stdout } = await runCommand("lsblk", [
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
  if (isWindows()) {
    // Create temp dir inside WSL filesystem
    const { stdout } = await runCommand("mktemp", [
      "-d",
      `/tmp/anyboot-${prefix}-XXXXXX`,
    ]);
    return stdout.trim();
  }
  return mkdtemp(join(tmpdir(), `anyboot-${prefix}-`));
}

export async function removeMountpoint(mountpoint: string): Promise<void> {
  try {
    if (isWindows()) {
      await runCommand("rmdir", [mountpoint], { asRoot: true });
    } else {
      await rmdir(mountpoint);
    }
  } catch {
    // Ignore if directory is not empty or doesn't exist
  }
}
