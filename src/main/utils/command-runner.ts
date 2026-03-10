import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { isWindows, toWslPath } from "./platform";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  asRoot?: boolean;
  timeout?: number;
}

/**
 * Run a command, automatically routing through WSL on Windows.
 * On Linux, runs directly. On Windows, wraps with `wsl`.
 * If asRoot is true, uses `pkexec` on Linux or `wsl sudo` on Windows.
 */
export async function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<CommandResult> {
  const { asRoot = false, timeout = 60000 } = opts;

  if (isWindows()) {
    return runViaWsl(cmd, args, asRoot, timeout);
  } else {
    return runNative(cmd, args, asRoot, timeout);
  }
}

async function runNative(
  cmd: string,
  args: string[],
  asRoot: boolean,
  timeout: number
): Promise<CommandResult> {
  if (asRoot) {
    const { stdout, stderr } = await execFileAsync("pkexec", [cmd, ...args], {
      timeout,
    });
    return { stdout, stderr };
  }

  const { stdout, stderr } = await execFileAsync(cmd, args, { timeout });
  return { stdout, stderr };
}

async function runViaWsl(
  cmd: string,
  args: string[],
  asRoot: boolean,
  timeout: number
): Promise<CommandResult> {
  const wslArgs: string[] = [];

  if (asRoot) {
    wslArgs.push("sudo", cmd, ...args);
  } else {
    wslArgs.push(cmd, ...args);
  }

  const { stdout, stderr } = await execFileAsync("wsl", wslArgs, { timeout });
  return { stdout, stderr };
}

/**
 * Spawn a long-running command with streaming output.
 * Returns the ChildProcess for progress monitoring.
 */
export function spawnCommand(
  cmd: string,
  args: string[],
  asRoot: boolean = false
): ChildProcess {
  if (isWindows()) {
    const wslArgs: string[] = [];
    if (asRoot) {
      wslArgs.push("sudo", cmd, ...args);
    } else {
      wslArgs.push(cmd, ...args);
    }
    return spawn("wsl", wslArgs);
  }

  if (asRoot) {
    return spawn("pkexec", [cmd, ...args]);
  }

  return spawn(cmd, args);
}

/**
 * Translate a file path for use in commands.
 * On Windows, converts to WSL path so commands inside WSL can access it.
 * On Linux, returns the path unchanged.
 */
export function translatePath(filePath: string): string {
  if (isWindows()) {
    return toWslPath(filePath);
  }
  return filePath;
}
