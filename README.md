# AnyBoot

A tool to create a multiboot USB drive. When booted, the USB shows a GRUB2 menu listing all ISO images on the drive, allowing you to select which one to boot.

## Features

- **Multiboot support** - Add multiple ISO files to a single USB drive
- **BIOS + UEFI** - Boots on both legacy BIOS and modern UEFI systems
- **Dynamic ISO detection** - GRUB2 automatically scans for ISO files at boot time
- **Distro-aware** - Supports Ubuntu, Debian, Fedora, Arch, openSUSE, and more
- **Electron GUI** - Simple graphical interface for drive preparation and ISO management
- **Windows support** - Runs on Windows via WSL (Windows Subsystem for Linux)

## Requirements

### System tools (must be installed on your Linux host)

- `sgdisk` (from `gdisk` package) - GPT partitioning
- `mkfs.fat` (from `dosfstools` package) - FAT32 formatting
- `grub-install` (from `grub2` package) - GRUB2 bootloader
- `partprobe` (from `parted` package) - Kernel partition table reload
- `lsblk` (from `util-linux`) - Device enumeration

### Install dependencies (Ubuntu/Debian)

```bash
sudo apt install gdisk dosfstools grub2-common grub-pc-bin grub-efi-amd64-bin parted
```

### Install dependencies (Fedora)

```bash
sudo dnf install gdisk dosfstools grub2-tools grub2-pc-modules grub2-efi-x64-modules parted
```

### Install dependencies (Arch)

```bash
sudo pacman -S gptfdisk dosfstools grub parted
```

### Running on Windows (via WSL)

AnyBoot can run on Windows by delegating system operations to WSL. You need:

1. **WSL2** installed and running (`wsl --install` in an admin PowerShell)
2. **Required tools installed inside WSL** (see Ubuntu/Debian instructions above)
3. **Run AnyBoot as Administrator** (needed for `wsl --mount` to attach USB disks)

When running on Windows, AnyBoot will:
- Detect USB drives via PowerShell
- Attach the selected drive to WSL using `wsl --mount --bare`
- Run all partitioning, formatting, and GRUB installation inside WSL
- Translate file paths between Windows and WSL automatically

## Build & Run

```bash
npm install
npm start
```

## How It Works

1. **Prepare**: AnyBoot partitions the USB drive with a GPT layout:
   - EFI System Partition (200 MB, FAT32) - for UEFI boot
   - BIOS Boot Partition (1 MB) - for legacy BIOS boot
   - Data Partition (remaining space, FAT32) - stores ISOs and GRUB config

2. **Add ISOs**: Copy ISO files to the USB drive through the GUI

3. **Boot**: When you boot from the USB, GRUB2 scans the `/iso/` directory and presents a menu with all available ISOs

## Supported Distributions

The GRUB2 configuration auto-detects kernel/initrd paths for:

- Ubuntu, Linux Mint, elementary OS, Pop!_OS (casper-based)
- Debian, Kali, Tails (live-based)
- Fedora, CentOS, Rocky, AlmaLinux
- Arch Linux, Manjaro, EndeavourOS
- openSUSE
- Generic Linux ISOs with standard boot layouts

## License

GPL-3.0
