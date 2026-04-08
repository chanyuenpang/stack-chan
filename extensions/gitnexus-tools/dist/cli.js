/**
 * GitNexus CLI execution helper
 */
import { spawn } from "child_process";

const GITNEXUS_CLI = "gitnexus";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run a gitnexus CLI command and return stdout.
 * @param args - CLI arguments (e.g. ["query", "some search", "--content"])
 * @param options - Optional: cwd, timeoutMs
 */
export function runGitNexus(args, options = {}) {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    const cli = spawn(GITNEXUS_CLI, args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    cli.stdout.on("data", (d) => (stdout += d.toString()));
    cli.stderr.on("data", (d) => (stderr += d.toString()));
    cli.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`gitnexus exited with code ${code}: ${stderr.trim()}`));
      }
    });
    cli.on("error", (err) => reject(err));
  });
}
