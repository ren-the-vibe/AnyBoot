// Type declarations for the anyboot API exposed via preload
interface AnyBootAPI {
  listDevices: () => Promise<any[]>;
  prepareDevice: (devicePath: string) => Promise<{ success: boolean; error?: string }>;
  addIso: (isoPath: string, devicePath: string) => Promise<{ success: boolean; error?: string }>;
  removeIso: (isoName: string, devicePath: string) => Promise<{ success: boolean; error?: string }>;
  listIsos: (devicePath: string) => Promise<any[]>;
  checkDependencies: () => Promise<any[]>;
  selectIsoFile: () => Promise<string | null>;
  onProgress: (callback: (event: any, data: any) => void) => () => void;
}

const anyboot = (window as any).anyboot as AnyBootAPI;

// DOM elements
const deviceSelect = document.getElementById("device-select") as HTMLSelectElement;
const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const deviceInfo = document.getElementById("device-info") as HTMLDivElement;
const prepareBtn = document.getElementById("prepare-btn") as HTMLButtonElement;
const addIsoBtn = document.getElementById("add-iso-btn") as HTMLButtonElement;
const isoList = document.getElementById("iso-list") as HTMLDivElement;
const progressContainer = document.getElementById("progress-container") as HTMLDivElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLParagraphElement;
const depBanner = document.getElementById("dep-banner") as HTMLDivElement;
const depMessage = document.getElementById("dep-message") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

let selectedDevice: string = "";
let isOperationRunning = false;

// Progress listener
anyboot.onProgress((_event, data) => {
  showProgress(data.message, data.percent);
});

// Event listeners
refreshBtn.addEventListener("click", refreshDevices);
deviceSelect.addEventListener("change", onDeviceSelected);
prepareBtn.addEventListener("click", prepareDrive);
addIsoBtn.addEventListener("click", addIsoFile);

// Initialize
checkDependencies();
refreshDevices();

async function checkDependencies(): Promise<void> {
  const results = await anyboot.checkDependencies();
  const missing = results.filter((r: any) => !r.available);

  if (missing.length > 0) {
    const tools = missing.map((r: any) => r.tool).join(", ");
    depBanner.className = "banner error";
    depMessage.textContent = `Missing required tools: ${tools}. Install them before using AnyBoot.`;
    depBanner.classList.remove("hidden");
  }
}

async function refreshDevices(): Promise<void> {
  statusText.textContent = "Scanning for USB devices...";
  const devices = await anyboot.listDevices();

  // Clear current options (keep placeholder)
  while (deviceSelect.options.length > 1) {
    deviceSelect.remove(1);
  }

  for (const dev of devices) {
    const option = document.createElement("option");
    option.value = dev.path;
    option.textContent = `${dev.path} - ${dev.model} (${dev.size})`;
    deviceSelect.appendChild(option);
  }

  if (devices.length === 0) {
    statusText.textContent = "No USB devices found.";
  } else {
    statusText.textContent = `Found ${devices.length} USB device(s).`;
  }

  // Reset selection
  deviceSelect.value = "";
  onDeviceSelected();
}

function onDeviceSelected(): void {
  selectedDevice = deviceSelect.value;
  const hasDevice = selectedDevice !== "";

  prepareBtn.disabled = !hasDevice || isOperationRunning;
  addIsoBtn.disabled = !hasDevice || isOperationRunning;

  if (hasDevice) {
    deviceInfo.textContent = `Selected: ${selectedDevice}`;
    deviceInfo.classList.remove("hidden");
    refreshIsoList();
  } else {
    deviceInfo.classList.add("hidden");
  }
}

async function prepareDrive(): Promise<void> {
  if (!selectedDevice) return;

  const confirmed = confirm(
    `WARNING: This will ERASE ALL DATA on ${selectedDevice}!\n\n` +
    `The drive will be partitioned and formatted for multiboot use.\n\n` +
    `Are you sure you want to continue?`
  );

  if (!confirmed) return;

  setOperationRunning(true);
  showProgress("Starting drive preparation...", 0);

  const result = await anyboot.prepareDevice(selectedDevice);

  if (result.success) {
    hideProgress();
    statusText.textContent = "Drive prepared successfully!";
    refreshIsoList();
  } else {
    hideProgress();
    statusText.textContent = `Error: ${result.error}`;
    alert(`Failed to prepare drive:\n${result.error}`);
  }

  setOperationRunning(false);
}

async function addIsoFile(): Promise<void> {
  if (!selectedDevice) return;

  const isoPath = await anyboot.selectIsoFile();
  if (!isoPath) return;

  setOperationRunning(true);
  showProgress("Adding ISO...", 0);

  const result = await anyboot.addIso(isoPath, selectedDevice);

  if (result.success) {
    hideProgress();
    statusText.textContent = "ISO added successfully!";
    refreshIsoList();
  } else {
    hideProgress();
    statusText.textContent = `Error: ${result.error}`;
    alert(`Failed to add ISO:\n${result.error}`);
  }

  setOperationRunning(false);
}

async function removeIsoFile(isoName: string): Promise<void> {
  if (!selectedDevice) return;

  const confirmed = confirm(`Remove ${isoName} from the USB drive?`);
  if (!confirmed) return;

  setOperationRunning(true);
  statusText.textContent = `Removing ${isoName}...`;

  const result = await anyboot.removeIso(isoName, selectedDevice);

  if (result.success) {
    statusText.textContent = `${isoName} removed.`;
    refreshIsoList();
  } else {
    statusText.textContent = `Error: ${result.error}`;
  }

  setOperationRunning(false);
}

async function refreshIsoList(): Promise<void> {
  if (!selectedDevice) return;

  try {
    const isos = await anyboot.listIsos(selectedDevice);

    if (isos.length === 0) {
      isoList.innerHTML = '<p class="empty-state">No ISOs on this drive. Click "Add ISO" to add one.</p>';
      return;
    }

    isoList.innerHTML = "";
    for (const iso of isos) {
      const item = document.createElement("div");
      item.className = "iso-item";

      const name = document.createElement("span");
      name.className = "iso-name";
      name.textContent = iso.name;

      const meta = document.createElement("span");
      meta.className = "iso-meta";
      meta.textContent = `${iso.sizeHuman} | ${iso.distroFamily}`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "danger";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeIsoFile(iso.name));

      item.appendChild(name);
      item.appendChild(meta);
      item.appendChild(removeBtn);
      isoList.appendChild(item);
    }
  } catch {
    isoList.innerHTML = '<p class="empty-state">Could not read ISOs. Prepare the drive first.</p>';
  }
}

function showProgress(message: string, percent: number): void {
  progressContainer.classList.remove("hidden");
  progressText.textContent = message;
  if (percent >= 0) {
    progressFill.style.width = `${percent}%`;
  }
}

function hideProgress(): void {
  progressContainer.classList.add("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "";
}

function setOperationRunning(running: boolean): void {
  isOperationRunning = running;
  prepareBtn.disabled = running || !selectedDevice;
  addIsoBtn.disabled = running || !selectedDevice;
  refreshBtn.disabled = running;
}
