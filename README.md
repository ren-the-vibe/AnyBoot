# AnyBoot

A tool to create a multiboot USB drive. When booted, the USB shows a GRUB2 menu listing all ISO images on the drive, allowing you to select which one to boot.

## Features

- **Multiboot support** - Add multiple ISO files to a single USB drive
- **BIOS + UEFI** - Boots on both legacy BIOS and modern UEFI systems
- **Dynamic ISO detection** - GRUB2 automatically scans for ISO files at boot time
- **Distro-aware** - Supports Ubuntu, Debian, Fedora, Arch, openSUSE, and more
- **Electron GUI** - Simple graphical interface for drive preparation and ISO management
- **Cross-platform** - Runs natively on both Linux and Windows (no WSL needed)

## Requirements

### Linux

Install these system tools:

```bash
# Ubuntu/Debian
sudo apt install gdisk dosfstools grub2-common grub-pc-bin grub-efi-amd64-bin parted

# Fedora
sudo dnf install gdisk dosfstools grub2-tools grub2-pc-modules grub2-efi-x64-modules parted

# Arch
sudo pacman -S gptfdisk dosfstools grub parted
```

### Windows

- **Run as Administrator** (required for disk operations)
- **GRUB binaries must be built first** (see below)

On Windows, AnyBoot uses native tools:
- `diskpart` for partitioning and formatting
- PowerShell for device detection and partition management
- Bundled GRUB2 binaries (copied directly, no `grub-install` needed)

## Getting Started

```bash
npm install
npm run build-grub   # build GRUB binaries (requires Linux or WSL)
npm start            # builds and launches the app
npm run dev          # same, for development
npm run dist         # package as distributable (AppImage/deb)
```

### Building GRUB Binaries

GRUB2 bootloader binaries must be built before the "Prepare Drive" feature will work. This only needs to be done once.

**On Linux:**

```bash
# Install GRUB packages first
# Ubuntu/Debian:
sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common
# Fedora:
sudo dnf install grub2-pc-modules grub2-efi-x64-modules grub2-tools

# Build the binaries
npm run build-grub
```

**On Windows (via WSL):**

The build script requires a Debian/Ubuntu-based WSL distro with `apt`. It will automatically detect and use an Ubuntu/Debian distro even if it's not your default WSL distro.

```powershell
# 1. Install Ubuntu WSL if you don't have it
wsl --install -d Ubuntu

# 2. Install GRUB packages
wsl -d Ubuntu sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common

# 3. Build the binaries (auto-detects the right WSL distro)
npm run build-grub
```

The binaries are output to `resources/grub/` and are included automatically when the app runs.

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
