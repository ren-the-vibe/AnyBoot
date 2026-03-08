import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir } from "fs/promises";
import { join } from "path";
import { partitionPath } from "../usb/format";
import {
  mountPartition,
  unmountPartition,
  createTempMountpoint,
  removeMountpoint,
} from "../usb/mount";
import { getGrubCfgSourcePath } from "./config";

const execFileAsync = promisify(execFile);

export async function installGrub(
  devicePath: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const espDevice = partitionPath(devicePath, 1);
  const dataDevice = partitionPath(devicePath, 3);

  const espMount = await createTempMountpoint("esp");
  const dataMount = await createTempMountpoint("data");

  try {
    // Mount partitions
    onProgress?.("Mounting partitions...");
    await mountPartition(espDevice, espMount);
    await mountPartition(dataDevice, dataMount);

    // Create required directories
    onProgress?.("Creating directory structure...");
    await execFileAsync("pkexec", [
      "mkdir",
      "-p",
      join(dataMount, "boot", "grub"),
      join(dataMount, "iso"),
      join(espMount, "EFI", "BOOT"),
    ]);

    // Install GRUB for BIOS (i386-pc)
    onProgress?.("Installing GRUB2 for BIOS...");
    try {
      await execFileAsync("pkexec", [
        "grub-install",
        "--target=i386-pc",
        `--boot-directory=${join(dataMount, "boot")}`,
        "--removable",
        devicePath,
      ]);
    } catch (err) {
      // grub-install might not be available, try grub2-install (Fedora/RHEL)
      await execFileAsync("pkexec", [
        "grub2-install",
        "--target=i386-pc",
        `--boot-directory=${join(dataMount, "boot")}`,
        "--removable",
        devicePath,
      ]);
    }

    // Install GRUB for UEFI (x86_64-efi)
    onProgress?.("Installing GRUB2 for UEFI...");
    try {
      await execFileAsync("pkexec", [
        "grub-install",
        "--target=x86_64-efi",
        `--efi-directory=${espMount}`,
        `--boot-directory=${join(dataMount, "boot")}`,
        "--removable",
      ]);
    } catch (err) {
      await execFileAsync("pkexec", [
        "grub2-install",
        "--target=x86_64-efi",
        `--efi-directory=${espMount}`,
        `--boot-directory=${join(dataMount, "boot")}`,
        "--removable",
      ]);
    }

    // Install grub.cfg
    onProgress?.("Installing GRUB configuration...");
    const grubCfgSource = getGrubCfgSourcePath();
    await execFileAsync("pkexec", [
      "cp",
      grubCfgSource,
      join(dataMount, "boot", "grub", "grub.cfg"),
    ]);

    onProgress?.("GRUB installation complete.");
  } finally {
    // Cleanup: unmount and remove temp dirs
    try {
      await unmountPartition(espMount);
    } catch {}
    try {
      await unmountPartition(dataMount);
    } catch {}
    await removeMountpoint(espMount);
    await removeMountpoint(dataMount);
  }
}
