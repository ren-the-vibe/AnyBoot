import { platform } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function isWindows(): boolean {
  return platform() === "win32";
}

export function isLinux(): boolean {
  return platform() === "linux";
}

let wslAvailable: boolean | null = null;

export async function isWslAvailable(): Promise<boolean> {
  if (!isWindows()) return false;
  if (wslAvailable !== null) return wslAvailable;

  try {
    await execFileAsync("wsl", ["--status"]);
    wslAvailable = true;
  } catch {
    wslAvailable = false;
  }
  return wslAvailable;
}

/**
 * Convert a Windows path to a WSL path.
 * e.g., "C:\Users\foo\file.iso" → "/mnt/c/Users/foo/file.iso"
 */
export function toWslPath(windowsPath: string): string {
  // Handle UNC paths
  if (windowsPath.startsWith("\\\\")) {
    return windowsPath;
  }

  // Convert drive letter paths: C:\... → /mnt/c/...
  const match = windowsPath.match(/^([A-Za-z]):[\\\/](.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, "/");
    return `/mnt/${drive}/${rest}`;
  }

  // Already a Unix-style path or relative path
  return windowsPath.replace(/\\/g, "/");
}

/**
 * Convert a WSL path back to a Windows path.
 * e.g., "/mnt/c/Users/foo/file.iso" → "C:\Users\foo\file.iso"
 */
export function toWindowsPath(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, "\\");
    return `${drive}:\\${rest}`;
  }
  return wslPath;
}
