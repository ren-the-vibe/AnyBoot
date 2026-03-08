import { ipcMain, dialog, BrowserWindow } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import { listUsbDevices } from "./usb/detect";
import { partitionDrive } from "./usb/partition";
import { formatDrive } from "./usb/format";
import { installGrub } from "./grub/install";
import { addIso, removeIso, listIsos } from "./iso/manager";
import { SystemCheck } from "../shared/types";

const execFileAsync = promisify(execFile);

const REQUIRED_TOOLS = [
  "sgdisk",
  "mkfs.fat",
  "grub-install",
  "lsblk",
  "mount",
  "umount",
  "partprobe",
];

function sendProgress(message: string, percent: number = -1) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("progress", { message, percent });
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle("list-devices", async () => {
    return listUsbDevices();
  });

  ipcMain.handle("prepare-device", async (_event, devicePath: string) => {
    try {
      sendProgress("Partitioning drive...", 10);
      await partitionDrive(devicePath);

      sendProgress("Formatting partitions...", 30);
      await formatDrive(devicePath);

      sendProgress("Installing GRUB2 bootloader...", 50);
      await installGrub(devicePath, (msg) => {
        sendProgress(msg, 70);
      });

      sendProgress("Drive preparation complete!", 100);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle(
    "add-iso",
    async (_event, isoPath: string, devicePath: string) => {
      try {
        await addIso(isoPath, devicePath, (percent, message) => {
          sendProgress(message, percent);
        });
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
        await removeIso(isoName, devicePath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    }
  );

  ipcMain.handle("list-isos", async (_event, devicePath: string) => {
    try {
      return await listIsos(devicePath);
    } catch (err: any) {
      return [];
    }
  });

  ipcMain.handle("check-dependencies", async () => {
    const results: SystemCheck[] = [];
    for (const tool of REQUIRED_TOOLS) {
      try {
        const { stdout } = await execFileAsync("which", [tool]);
        results.push({ tool, available: true, path: stdout.trim() });
      } catch {
        results.push({ tool, available: false });
      }
    }
    return results;
  });

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
