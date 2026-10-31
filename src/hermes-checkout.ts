import { spawn } from "node:child_process";
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const UPSTREAM = "https://github.com/NousResearch/hermes-agent.git";
const TIMEOUT_MS = 120_000;

function gitEnvironment(): NodeJS.ProcessEnv {
  // Do not inherit alternate repository targets, hooks, filters, credential
  // helpers, or Git config injection. Proxy/TLS environment settings still work.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("GIT_") && !key.startsWith("GCM_"),
    ),
  );
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function runGit(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "credential.helper=",
        "-c",
        "submodule.recurse=false",
        ...args,
      ],
      {
        env: gitEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      stdout = (stdout + text).slice(-8192);
    });
    child.stderr.on("data", (text) => {
      stderr = (stderr + text).slice(-8192);
    });
    const timer = setTimeout(
      () => {
        timedOut = true;
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      },
      Math.max(1, timeout),
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(
          new Error(
            "Hermes Git operation timed out (120 second invocation limit).",
          ),
        );
      else if (code !== 0)
        reject(
          new Error(
            `Git failed (${code}): ${stderr.trim() || "no error output"}`,
          ),
        );
      else resolve(stdout.trim());
    });
  });
}

async function inspectCheckout(path: string, remaining: () => number) {
  const root = realpathSync(path);
  if (!statSync(root).isDirectory())
    throw new Error(`Not a checkout directory: ${path}`);
  const top = await runGit(
    ["-C", root, "rev-parse", "--show-toplevel"],
    remaining(),
  );
  if (realpathSync(top) !== root)
    throw new Error(
      `Configured Hermes location is not the checkout root: ${path}`,
    );
  for (const dir of ["skills", "optional-skills"]) {
    if (!statSync(join(root, dir)).isDirectory())
      throw new Error(`Missing Hermes catalog directory: ${dir}`);
  }
  return root;
}

/** Publish only into exclusively created paths, never rename over a destination.
 * On failure remove only the same inodes created here, and only empty directories.
 * Concurrently added files survive. The clone staging tree is separately owned.
 */
function publish(source: string, destination: string) {
  const owned: {
    path: string;
    ino: number;
    dev: number;
    directory: boolean;
  }[] = [];
  const remember = (path: string, directory: boolean) => {
    const { ino, dev } = lstatSync(path);
    owned.push({ path, ino, dev, directory });
  };
  const copy = (from: string, to: string) => {
    const info = lstatSync(from);
    if (info.isDirectory()) {
      mkdirSync(to);
      remember(to, true);
      for (const name of readdirSync(from))
        copy(join(from, name), join(to, name));
    } else if (info.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to);
      remember(to, false);
    } else if (info.isFile()) {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
      remember(to, false);
    } else throw new Error(`Unsupported checkout file type: ${from}`);
  };
  try {
    copy(source, destination);
  } catch (error) {
    for (const item of owned.reverse()) {
      try {
        const current = lstatSync(item.path);
        if (current.ino === item.ino && current.dev === item.dev) {
          if (item.directory) rmdirSync(item.path);
          else unlinkSync(item.path);
        }
      } catch {
        /* Leave changed/nonempty resources untouched. */
      }
    }
    throw error;
  }
}

/** Invocation only: reuse is read-only, missing destinations get the audited revision. */
export async function ensureHermesCheckout(
  path: string,
  revision: string,
  progress: (message: string) => void = () => {},
) {
  const deadline = Date.now() + TIMEOUT_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  let exists = true;
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }
  // Never reinterpret a verification failure as permission to repair/clone.
  if (exists) return inspectCheckout(path, remaining);
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid audited Hermes revision");
  mkdirSync(dirname(path), { recursive: true });
  const staging = mkdtempSync(join(dirname(path), `.${basename(path)}-clone-`));
  try {
    progress(
      `Cloning Hermes audited revision ${revision.slice(0, 12)} to ${path} (first invocation may access the network).`,
    );
    const clone = join(staging, "repository");
    await runGit(
      [
        "clone",
        "--no-checkout",
        "--no-tags",
        "--no-recurse-submodules",
        "--",
        UPSTREAM,
        clone,
      ],
      remaining(),
    );
    await runGit(
      ["-C", clone, "checkout", "--detach", revision, "--"],
      remaining(),
    );
    await inspectCheckout(clone, remaining);
    publish(clone, path);
    progress(
      `Hermes checkout ready: ${path}. Future invocations reuse it without updating.`,
    );
    return realpathSync(path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
