#!/bin/bash
# Build GRUB2 binaries for bundling with AnyBoot.
# Run this on a Linux system with grub2 packages installed.
# Output goes to resources/grub/{i386-pc,x86_64-efi}/
#
# Required packages (Ubuntu/Debian):
#   sudo apt install grub-pc-bin grub-efi-amd64-bin grub-common
#
# Required packages (Fedora):
#   sudo dnf install grub2-pc-modules grub2-efi-x64-modules grub2-tools

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/resources/grub"

# GRUB modules to include in core.img and the standalone EFI binary
MODULES="
  part_gpt part_msdos fat iso9660 loopback
  linux normal search search_label search_fs_uuid
  configfile echo test regexp
  all_video gfxterm font
  boot chain
"

# Find the GRUB tools
GRUB_MKIMAGE=""
for cmd in grub-mkimage grub2-mkimage; do
  if command -v "$cmd" &>/dev/null; then
    GRUB_MKIMAGE="$cmd"
    break
  fi
done

if [ -z "$GRUB_MKIMAGE" ]; then
  echo "Error: grub-mkimage or grub2-mkimage not found."
  echo "Install GRUB2 tools first."
  exit 1
fi

# Find GRUB module directories
BIOS_MOD_DIR=""
for dir in /usr/lib/grub/i386-pc /usr/lib/grub2/i386-pc /usr/share/grub2/i386-pc; do
  if [ -d "$dir" ]; then
    BIOS_MOD_DIR="$dir"
    break
  fi
done

EFI_MOD_DIR=""
for dir in /usr/lib/grub/x86_64-efi /usr/lib/grub2/x86_64-efi /usr/share/grub2/x86_64-efi; do
  if [ -d "$dir" ]; then
    EFI_MOD_DIR="$dir"
    break
  fi
done

echo "=== Building GRUB2 Binaries for AnyBoot ==="
echo "Output: $OUTPUT_DIR"
echo "BIOS modules: $BIOS_MOD_DIR"
echo "EFI modules: $EFI_MOD_DIR"
echo ""

# --- BIOS (i386-pc) ---
if [ -n "$BIOS_MOD_DIR" ]; then
  echo "--- Building BIOS binaries ---"
  mkdir -p "$OUTPUT_DIR/i386-pc"

  # Copy boot.img (MBR boot code)
  cp "$BIOS_MOD_DIR/boot.img" "$OUTPUT_DIR/i386-pc/boot.img"

  # Build core.img with embedded modules
  # The prefix tells GRUB where to find its config and additional modules
  $GRUB_MKIMAGE \
    --format=i386-pc \
    --output="$OUTPUT_DIR/i386-pc/core.img" \
    --prefix="(,gpt3)/boot/grub" \
    --directory="$BIOS_MOD_DIR" \
    $MODULES

  # Copy essential module files
  for mod in $MODULES; do
    if [ -f "$BIOS_MOD_DIR/${mod}.mod" ]; then
      cp "$BIOS_MOD_DIR/${mod}.mod" "$OUTPUT_DIR/i386-pc/"
    fi
  done

  # Copy additional needed files
  for f in normal.mod terminal.mod crypto.mod extcmd.mod boot.mod; do
    if [ -f "$BIOS_MOD_DIR/$f" ]; then
      cp "$BIOS_MOD_DIR/$f" "$OUTPUT_DIR/i386-pc/"
    fi
  done

  echo "BIOS: boot.img ($(wc -c < "$OUTPUT_DIR/i386-pc/boot.img") bytes)"
  echo "BIOS: core.img ($(wc -c < "$OUTPUT_DIR/i386-pc/core.img") bytes)"
else
  echo "WARNING: BIOS GRUB modules not found. Skipping BIOS build."
fi

# --- UEFI (x86_64-efi) ---
if [ -n "$EFI_MOD_DIR" ]; then
  echo "--- Building UEFI binaries ---"
  mkdir -p "$OUTPUT_DIR/x86_64-efi"

  # Build standalone EFI binary with embedded config
  $GRUB_MKIMAGE \
    --format=x86_64-efi \
    --output="$OUTPUT_DIR/x86_64-efi/grubx64.efi" \
    --prefix="(,gpt3)/boot/grub" \
    --directory="$EFI_MOD_DIR" \
    $MODULES

  # Copy essential module files
  for mod in $MODULES; do
    if [ -f "$EFI_MOD_DIR/${mod}.mod" ]; then
      cp "$EFI_MOD_DIR/${mod}.mod" "$OUTPUT_DIR/x86_64-efi/"
    fi
  done

  echo "UEFI: grubx64.efi ($(wc -c < "$OUTPUT_DIR/x86_64-efi/grubx64.efi") bytes)"
else
  echo "WARNING: UEFI GRUB modules not found. Skipping UEFI build."
fi

echo ""
echo "=== Done ==="
echo "GRUB binaries are in: $OUTPUT_DIR"
echo ""
echo "Directory contents:"
find "$OUTPUT_DIR" -type f | sort | while read f; do
  echo "  $f ($(wc -c < "$f") bytes)"
done
