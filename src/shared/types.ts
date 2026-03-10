export interface UsbDevice {
  name: string;
  path: string;
  size: string;
  model: string;
  label: string;
  partitions: Partition[];
}

export interface Partition {
  name: string;
  path: string;
  size: string;
  mountpoint: string | null;
  label: string | null;
  fstype: string | null;
}

export interface IsoFile {
  name: string;
  size: number;
  sizeHuman: string;
  distroFamily: DistroFamily;
}

export type DistroFamily =
  | "ubuntu"
  | "fedora"
  | "arch"
  | "opensuse"
  | "debian"
  | "generic"
  | "unknown";

export interface ProgressEvent {
  phase: string;
  percent: number;
  message: string;
}

export interface PrepareResult {
  success: boolean;
  error?: string;
}

export interface SystemCheck {
  tool: string;
  available: boolean;
  path?: string;
}
