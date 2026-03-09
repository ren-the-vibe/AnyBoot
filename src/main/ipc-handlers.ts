import { ipcMain, dialog, BrowserWindow } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { SystemCheck } from "../shared/types";
import { isWindows } from "./utils/platform";
import { runCommand } from "./utils/command-runner";

// Linux imports
import { listUsbDevices } from "./usb/detect";
import { partitionDrive } from "./usb/partition";
import { formatDrive } from "./usb/format";
import { installGrub } from "./grub/install";
import { addIso, removeIso, listIsos } from "./iso/manager";

// Windows imports (lazy-loaded to avoid errors on Linux)
const loadWindowsDetect = () => import("./windows/detect");
const loadWindowsPartition = () => import("./windows/partition");
const loadWindowsGrub = () => import("./windows/grub");
const loadWindowsIsoManager = () => import("./windows/iso-manager");
const loadWindowsSafety = () => import("./windows/safety");

const execFileAsync = promisify(execFile);

const LINUX_REQUIRED_TOOLS = [
  "sgdisk",
  "mkfs.fat",
  "grub-install",
  "lsblk",
  "mount",
  "umount",
  "partprobe",
];

const WINDOWS_REQUIRED_TOOLS = [
  "diskpart",
  "powershell",
];

function sendProgress(message: string, percent: number = -1) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("progress", { message, percent });
  }
}

function getGrubBinariesDir(): string {
  const isDev = !process.resourcesPath?.includes("app.asar");
  if (isDev) {
    return resolve(__dirname, "..", "..", "resources", "grub");
  }
  return join(process.resourcesPath, "resources", "grub");
}

export function registerIpcHandlers(): void {
  // --- Device listing ---
  ipcMain.handle("list-devices", async () => {
    try {
      if (isWindows()) {
        const detect = await loadWindowsDetect();
        return await detect.listUsbDevicesWindows();
      }
      return await listUsbDevices();
    } catch (err: any) {
      console.error("list-devices error:", err);
      return { error: err.message || String(err) };
    }
  });

  // --- Drive preparation ---
  ipcMain.handle("prepare-device", async (_event, devicePath: string) => {
    try {
      if (isWindows()) {
        const safety = await loadWindowsSafety();
        await safety.assertNotSystemDisk(devicePath);

        const partition = await loadWindowsPartition();
        const grub = await loadWindowsGrub();

        sendProgress("Partitioning drive...", 10);
        await partition.partitionDriveWindows(devicePath);

        // Formatting is done by diskpart during partitioning
        sendProgress("Formatting complete.", 30);

        sendProgress("Installing GRUB2 bootloader...", 50);
        await grub.installGrubWindows(devicePath, (msg) => {
          sendProgress(msg, 70);
        });

        sendProgress("Drive preparation complete!", 100);
      } else {
        sendProgress("Partitioning drive...", 10);
        await partitionDrive(devicePath);

        sendProgress("Formatting partitions...", 30);
        await formatDrive(devicePath);

        sendProgress("Installing GRUB2 bootloader...", 50);
        await installGrub(devicePath, (msg) => {
          sendProgress(msg, 70);
        });

        sendProgress("Drive preparation complete!", 100);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  // --- ISO management ---
  ipcMain.handle(
    "add-iso",
    async (_event, isoPath: string, devicePath: string) => {
      try {
        if (isWindows()) {
          const safety = await loadWindowsSafety();
          await safety.assertNotSystemDisk(devicePath);

          const isoManager = await loadWindowsIsoManager();
          await isoManager.addIsoWindows(isoPath, devicePath, (percent, message) => {
            sendProgress(message, percent);
          });
        } else {
          await addIso(isoPath, devicePath, (percent, message) => {
            sendProgress(message, percent);
          });
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    }
  );

  ipcMain.handle(
    "remove-iso",
    async (_event, isoName: string, devicePath: string) => {
      try {
        if (isWindows()) {
          const safety = await loadWindowsSafety();
          await safety.assertNotSystemDisk(devicePath);

          const isoManager = await loadWindowsIsoManager();
          await isoManager.removeIsoWindows(isoName, devicePath);
        } else {
          await removeIso(isoName, devicePath);
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    }
  );

  ipcMain.handle("list-isos", async (_event, devicePath: string) => {
    try {
      if (isWindows()) {
        const isoManager = await loadWindowsIsoManager();
        return await isoManager.listIsosWindows(devicePath);
      }
      return await listIsos(devicePath);
    } catch (err: any) {
      return [];
    }
  });

  // --- Dependency check ---
  ipcMain.handle("check-dependencies", async () => {
    const results: SystemCheck[] = [];

    if (isWindows()) {
      // Check Windows-native tools
      for (const tool of WINDOWS_REQUIRED_TOOLS) {
        try {
          const { stdout } = await execFileAsync("where", [tool]);
          results.push({ tool, available: true, path: stdout.trim().split("\n")[0] });
        } catch {
          results.push({ tool, available: false });
        }
      }

      // Check for bundled GRUB binaries
      const grubDir = getGrubBinariesDir();
      const hasUefi = existsSync(join(grubDir, "x86_64-efi", "grubx64.efi"));
      const hasBios = existsSync(join(grubDir, "i386-pc", "boot.img"));

      results.push({
        tool: "grub-uefi-binaries",
        available: hasUefi,
        path: hasUefi ? join(grubDir, "x86_64-efi") : undefined,
      });
      results.push({
        tool: "grub-bios-binaries",
        available: hasBios,
        path: hasBios ? join(grubDir, "i386-pc") : undefined,
      });

      // Check admin privileges
      try {
        await execFileAsync("net", ["session"]);
        results.push({
          tool: "admin-privileges",
          available: true,
          path: "Running as Administrator",
        });
      } catch {
        results.push({
          tool: "admin-privileges",
          available: false,
        });
      }
    } else {
      // Linux: check system tools
      for (const tool of LINUX_REQUIRED_TOOLS) {
        try {
          const { stdout } = await runCommand("which", [tool]);
          results.push({ tool, available: true, path: stdout.trim() });
        } catch {
          if (tool === "grub-install") {
            try {
              const { stdout } = await runCommand("which", ["grub2-install"]);
              results.push({
                tool,
                available: true,
                path: stdout.trim() + " (as grub2-install)",
              });
              continue;
            } catch {}
          }
          results.push({ tool, available: false });
        }
      }
    }

    return results;
  });

  // --- File dialog ---
  ipcMain.handle("select-iso-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select ISO File",
      filters: [{ name: "ISO Images", extensions: ["iso"] }],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}
