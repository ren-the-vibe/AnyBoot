import { writeFile } from "fs/promises";
import { IsoFile, DistroFamily } from "../../shared/types";

/**
 * Generate a grub.cfg with explicit menu entries for each ISO.
 * Replaces the old dynamic for-loop scanning which doesn't work
 * reliably under Secure Boot's signed GRUB.
 */
export function generateGrubCfg(isos: IsoFile[]): string {
  const lines: string[] = [
    `# BootAny GRUB2 Configuration`,
    `# Generated menu — rebuilt when ISOs are added or removed`,
    ``,
    `set timeout=30`,
    `set default=0`,
    `set pager=1`,
    ``,
    `# Load modules only on BIOS — the signed UEFI GRUB binary has`,
    `# everything built in, and insmod is blocked by Secure Boot lockdown.`,
    `if [ "$grub_platform" = "pc" ]; then`,
    `    insmod all_video`,
    `    insmod loopback`,
    `    insmod iso9660`,
    `    insmod fat`,
    `    insmod ntfs`,
    `    insmod ntfscomp`,
    `    insmod part_gpt`,
    `    insmod part_msdos`,
    `fi`,
    ``,
    `search --no-floppy --label BOOTANY --set=root`,
    ``,
    `set menu_color_normal=white/black`,
    `set menu_color_highlight=black/light-gray`,
    ``,
  ];

  if (isos.length === 0) {
    lines.push(`menuentry "BootAny - No ISOs installed" --unrestricted {`);
    lines.push(`    echo "Add ISOs using the BootAny application."`);
    lines.push(`}`);
    lines.push(``);
  }

  for (const iso of isos) {
    const isoPath = `/iso/${iso.name}`;
    lines.push(...generateMenuEntry(iso.name, isoPath, iso.distroFamily));
    lines.push(``);
  }

  lines.push(`menuentry "---" --unrestricted { true }`);
  lines.push(`menuentry "Reboot" { reboot }`);
  lines.push(`menuentry "Shutdown" { halt }`);
  lines.push(``);

  return lines.join("\n");
}

function generateMenuEntry(
  label: string,
  isoPath: string,
  family: DistroFamily
): string[] {
  const chain = buildDetectionChain(family, isoPath);

  return [
    `menuentry "Boot: ${label}" {`,
    `    set isofile="${isoPath}"`,
    `    echo "Loading \${isofile}..."`,
    `    loopback loop "\${isofile}"`,
    ...chain.map((l) => `    ${l}`),
    `}`,
  ];
}

/**
 * Build an if/elif chain that probes the ISO for known kernel layouts.
 * The expected family's layout is tried first for faster boot.
 */
function buildDetectionChain(family: DistroFamily, isoPath: string): string[] {
  const casper = [
    `linux (loop)/casper/vmlinuz boot=casper iso-scan/filename=${isoPath} noprompt noeject quiet splash`,
    `if [ -f (loop)/casper/initrd ]; then`,
    `    initrd (loop)/casper/initrd`,
    `elif [ -f (loop)/casper/initrd.lz ]; then`,
    `    initrd (loop)/casper/initrd.lz`,
    `elif [ -f (loop)/casper/initrd.gz ]; then`,
    `    initrd (loop)/casper/initrd.gz`,
    `fi`,
  ];

  const live = [
    `linux (loop)/live/vmlinuz boot=live findiso=${isoPath} noprompt noeject quiet splash`,
    `if [ -f (loop)/live/initrd.img ]; then`,
    `    initrd (loop)/live/initrd.img`,
    `elif [ -f (loop)/live/initrd ]; then`,
    `    initrd (loop)/live/initrd`,
    `fi`,
  ];

  const isolinux = [
    `linux (loop)/isolinux/vmlinuz iso-scan/filename=${isoPath} rd.live.image quiet`,
    `if [ -f (loop)/isolinux/initrd.img ]; then`,
    `    initrd (loop)/isolinux/initrd.img`,
    `elif [ -f (loop)/isolinux/initrd ]; then`,
    `    initrd (loop)/isolinux/initrd`,
    `fi`,
  ];

  const pxeboot = [
    `linux (loop)/images/pxeboot/vmlinuz iso-scan/filename=${isoPath} rd.live.image quiet`,
    `initrd (loop)/images/pxeboot/initrd.img`,
  ];

  const archBoot = [
    `linux (loop)/arch/boot/x86_64/vmlinuz-linux img_dev=/dev/disk/by-label/BOOTANY img_loop=${isoPath} earlymodules=loop`,
    `initrd (loop)/arch/boot/x86_64/initramfs-linux.img`,
  ];

  const suseBoot = [
    `linux (loop)/boot/x86_64/loader/linux iso-scan/filename=${isoPath} splash=silent quiet`,
    `initrd (loop)/boot/x86_64/loader/initrd`,
  ];

  const genericBoot = [
    `linux (loop)/boot/vmlinuz iso-scan/filename=${isoPath} quiet`,
    `if [ -f (loop)/boot/initrd.img ]; then`,
    `    initrd (loop)/boot/initrd.img`,
    `elif [ -f (loop)/boot/initrd ]; then`,
    `    initrd (loop)/boot/initrd`,
    `fi`,
  ];

  const all: { id: string; test: string; cmds: string[] }[] = [
    { id: "casper", test: "(loop)/casper/vmlinuz", cmds: casper },
    { id: "live", test: "(loop)/live/vmlinuz", cmds: live },
    { id: "isolinux", test: "(loop)/isolinux/vmlinuz", cmds: isolinux },
    { id: "pxeboot", test: "(loop)/images/pxeboot/vmlinuz", cmds: pxeboot },
    { id: "arch", test: "(loop)/arch/boot/x86_64/vmlinuz-linux", cmds: archBoot },
    { id: "suse", test: "(loop)/boot/x86_64/loader/linux", cmds: suseBoot },
    { id: "generic", test: "(loop)/boot/vmlinuz", cmds: genericBoot },
  ];

  // Priority order based on distro family
  const priorityMap: Record<string, string[]> = {
    ubuntu: ["casper", "live", "isolinux", "pxeboot", "arch", "suse", "generic"],
    debian: ["live", "casper", "isolinux", "pxeboot", "arch", "suse", "generic"],
    fedora: ["isolinux", "pxeboot", "casper", "live", "arch", "suse", "generic"],
    arch: ["arch", "casper", "live", "isolinux", "pxeboot", "suse", "generic"],
    opensuse: ["suse", "casper", "live", "isolinux", "pxeboot", "arch", "generic"],
  };

  const order = priorityMap[family] || priorityMap.ubuntu!;
  const ordered = order.map((id) => all.find((a) => a.id === id)!);

  // Build if/elif/else chain
  const result: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const { test, cmds } = ordered[i];
    const keyword = i === 0 ? "if" : "elif";
    result.push(`${keyword} [ -f ${test} ]; then`);
    for (const cmd of cmds) {
      result.push(`    ${cmd}`);
    }
  }
  result.push(`else`);
  result.push(`    echo "Could not find kernel in \${isofile}"`);
  result.push(`    echo "This ISO may not support loopback booting."`);
  result.push(`    echo "Returning to menu in 5 seconds..."`);
  result.push(`    sleep 5`);
  result.push(`fi`);

  return result;
}

/**
 * Write a generated grub.cfg to the specified path.
 */
export async function writeGeneratedGrubCfg(
  grubCfgPath: string,
  isos: IsoFile[]
): Promise<void> {
  const cfg = generateGrubCfg(isos);
  await writeFile(grubCfgPath, cfg, "utf-8");
}
