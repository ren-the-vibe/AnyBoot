import { copyFile } from "fs/promises";
import { join } from "path";

export function getGrubCfgSourcePath(): string {
  // In development, resources are relative to project root
  // In production (packaged), they're in the resources directory
  const isDev = !process.resourcesPath?.includes("app.asar");
  if (isDev) {
    return join(__dirname, "..", "..", "..", "resources", "grub", "grub.cfg");
  }
  return join(process.resourcesPath, "resources", "grub", "grub.cfg");
}

export async function installGrubConfig(dataMountpoint: string): Promise<void> {
  const source = getGrubCfgSourcePath();
  const target = join(dataMountpoint, "boot", "grub", "grub.cfg");
  await copyFile(source, target);
}
