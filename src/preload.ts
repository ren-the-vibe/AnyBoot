import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("anyboot", {
  listDevices: () => ipcRenderer.invoke("list-devices"),
  prepareDevice: (devicePath: string) =>
    ipcRenderer.invoke("prepare-device", devicePath),
  addIso: (isoPath: string, devicePath: string) =>
    ipcRenderer.invoke("add-iso", isoPath, devicePath),
  removeIso: (isoName: string, devicePath: string) =>
    ipcRenderer.invoke("remove-iso", isoName, devicePath),
  listIsos: (devicePath: string) =>
    ipcRenderer.invoke("list-isos", devicePath),
  checkDependencies: () => ipcRenderer.invoke("check-dependencies"),
  selectIsoFile: () => ipcRenderer.invoke("select-iso-file"),

  onProgress: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on("progress", callback);
    return () => ipcRenderer.removeListener("progress", callback);
  },
});
