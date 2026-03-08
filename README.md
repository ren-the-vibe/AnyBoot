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
- **GRUB binaries must be bundled** - Run `scripts/build-grub-binaries.sh` on a Linux machine first to generate the GRUB bootloader files, then include them in `resources/grub/`

On Windows, AnyBoot uses native tools:
- `diskpart` for partitioning and formatting
- PowerShell for USB device detection and partition management
- Bundled GRUB2 binaries (copied directly, no `grub-install` needed)

## Getting Started

```bash
npm install
npm start       # builds and launches the app
npm run dev     # same, for development
npm run dist    # package as distributable (AppImage/deb)
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
