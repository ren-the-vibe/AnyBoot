import { DistroFamily } from "../../shared/types";

const DISTRO_PATTERNS: { pattern: RegExp; family: DistroFamily }[] = [
  { pattern: /ubuntu/i, family: "ubuntu" },
  { pattern: /linux\s*mint/i, family: "ubuntu" },
  { pattern: /elementary/i, family: "ubuntu" },
  { pattern: /pop[\-_]?os/i, family: "ubuntu" },
  { pattern: /kubuntu|xubuntu|lubuntu/i, family: "ubuntu" },
  { pattern: /debian/i, family: "debian" },
  { pattern: /kali/i, family: "debian" },
  { pattern: /tails/i, family: "debian" },
  { pattern: /fedora/i, family: "fedora" },
  { pattern: /centos/i, family: "fedora" },
  { pattern: /rocky/i, family: "fedora" },
  { pattern: /alma/i, family: "fedora" },
  { pattern: /rhel/i, family: "fedora" },
  { pattern: /arch/i, family: "arch" },
  { pattern: /manjaro/i, family: "arch" },
  { pattern: /endeavour/i, family: "arch" },
  { pattern: /opensuse|suse/i, family: "opensuse" },
];

export function probeIsoByFilename(filename: string): DistroFamily {
  for (const { pattern, family } of DISTRO_PATTERNS) {
    if (pattern.test(filename)) {
      return family;
    }
  }
  return "unknown";
}
