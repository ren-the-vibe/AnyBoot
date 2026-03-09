import { execFile } from "child_process";
import { promisify } from "util";
import { getDiskNumber } from "./partition";

const execFileAsync = promisify(execFile);

/**
 * Throw if the given device is the Windows system or boot disk.
 * Call this before any destructive operation as a safety guard.
 */
export async function assertNotSystemDisk(devicePath: string): Promise<void> {
  const diskNum = getDiskNumber(devicePath);

  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Get-Disk -Number ${diskNum} | Select-Object IsSystem,IsBoot | ConvertTo-Json -Compress`,
  ]);

  const info = JSON.parse(stdout.trim());
  if (info.IsSystem || info.IsBoot) {
    throw new Error(
      `Refusing to operate on disk ${diskNum}: it is marked as a system or boot disk.`
    );
  }
}
