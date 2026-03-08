import { join } from "path";
import { partitionPath } from "../usb/format";
import {
  mountPartition,
  unmountPartition,
  createTempMountpoint,
  removeMountpoint,
} from "../usb/mount";
import { getGrubCfgSourcePath } from "./config";
import { runCommand } from "../utils/command-runner";
import { isWindows, toWslPath } from "../utils/platform";

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
    await runCommand(
      "mkdir",
      [
        "-p",
        join(dataMount, "boot", "grub"),
        join(dataMount, "iso"),
        join(espMount, "EFI", "BOOT"),
      ],
      { asRoot: true }
    );

    // Install GRUB for BIOS (i386-pc)
    onProgress?.("Installing GRUB2 for BIOS...");
    try {
      await runCommand(
        "grub-install",
        [
          "--target=i386-pc",
          `--boot-directory=${join(dataMount, "boot")}`,
          "--removable",
          devicePath,
        ],
        { asRoot: true }
      );
    } catch {
      // grub-install might not be available, try grub2-install (Fedora/RHEL)
      await runCommand(
        "grub2-install",
        [
          "--target=i386-pc",
          `--boot-directory=${join(dataMount, "boot")}`,
          "--removable",
          devicePath,
        ],
        { asRoot: true }
      );
    }

    // Install GRUB for UEFI (x86_64-efi)
    onProgress?.("Installing GRUB2 for UEFI...");
    try {
      await runCommand(
        "grub-install",
        [
          "--target=x86_64-efi",
          `--efi-directory=${espMount}`,
          `--boot-directory=${join(dataMount, "boot")}`,
          "--removable",
        ],
        { asRoot: true }
      );
    } catch {
      await runCommand(
        "grub2-install",
        [
          "--target=x86_64-efi",
          `--efi-directory=${espMount}`,
          `--boot-directory=${join(dataMount, "boot")}`,
          "--removable",
        ],
        { asRoot: true }
      );
    }

    // Install grub.cfg
    onProgress?.("Installing GRUB configuration...");
    let grubCfgSource = getGrubCfgSourcePath();
    // On Windows, translate the source path so WSL can read it
    if (isWindows()) {
      grubCfgSource = toWslPath(grubCfgSource);
    }
    await runCommand(
      "cp",
      [grubCfgSource, join(dataMount, "boot", "grub", "grub.cfg")],
      { asRoot: true }
    );

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
