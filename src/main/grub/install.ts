import { join, resolve } from "path";
import { writeFile as fsWriteFile, unlink as fsUnlink } from "fs/promises";
import { tmpdir } from "os";
import { partitionPath } from "../usb/format";
import {
  mountPartition,
  unmountPartition,
  createTempMountpoint,
  removeMountpoint,
} from "../usb/mount";
import { getGrubBootstrapCfgPath, generateGrubCfg } from "./config";
import { runCommand } from "../utils/command-runner";
import { isWindows, toWslPath } from "../utils/platform";

function getGrubResourcesDir(): string {
  const isDev = !process.resourcesPath?.includes("app.asar");
  if (isDev) {
    return resolve(__dirname, "..", "..", "..", "resources", "grub");
  }
  return join(process.resourcesPath, "resources", "grub");
}

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

    // Overwrite UEFI binaries with Secure Boot-signed chain
    onProgress?.("Installing Secure Boot binaries...");
    const grubResDir = getGrubResourcesDir();
    const uefiSrc = join(grubResDir, "x86_64-efi");
    const efiBootDir = join(espMount, "EFI", "BOOT");
    const efiUbuntuDir = join(espMount, "EFI", "ubuntu");

    await runCommand("mkdir", ["-p", efiUbuntuDir], { asRoot: true });
    await runCommand(
      "cp",
      [join(uefiSrc, "shimx64.efi.signed"), join(efiBootDir, "BOOTx64.EFI")],
      { asRoot: true }
    );
    await runCommand(
      "cp",
      [join(uefiSrc, "grubx64.efi.signed"), join(efiBootDir, "grubx64.efi")],
      { asRoot: true }
    );
    await runCommand(
      "cp",
      [join(uefiSrc, "mmx64.efi"), join(efiBootDir, "mmx64.efi")],
      { asRoot: true }
    );

    // Redirect config for signed GRUB's hardcoded /EFI/ubuntu prefix
    let bootstrapCfg = getGrubBootstrapCfgPath();
    if (isWindows()) {
      bootstrapCfg = toWslPath(bootstrapCfg);
    }
    await runCommand(
      "cp",
      [bootstrapCfg, join(efiUbuntuDir, "grub.cfg")],
      { asRoot: true }
    );

    // Copy GRUB modules to ESP so the bootstrap can insmod ntfs before searching
    // Signed GRUB prefix is /EFI/ubuntu, so insmod looks at /EFI/ubuntu/x86_64-efi/
    const espModDir = join(espMount, "EFI", "ubuntu", "x86_64-efi");
    await runCommand("mkdir", ["-p", espModDir], { asRoot: true });
    for (const mod of ["ntfs.mod", "ntfscomp.mod", "part_gpt.mod"]) {
      await runCommand(
        "cp",
        [join(uefiSrc, mod), join(espModDir, mod)],
        { asRoot: true }
      );
    }

    // Generate initial grub.cfg (no ISOs yet — menu rebuilt when ISOs are added)
    onProgress?.("Installing GRUB configuration...");
    const grubCfgPath = join(dataMount, "boot", "grub", "grub.cfg");
    const cfg = generateGrubCfg([]);
    const tmpPath = join(tmpdir(), `bootany-grubcfg-${Date.now()}.cfg`);
    await fsWriteFile(tmpPath, cfg, "utf-8");
    try {
      await runCommand("cp", [tmpPath, grubCfgPath], { asRoot: true });
    } finally {
      try { await fsUnlink(tmpPath); } catch {}
    }

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
