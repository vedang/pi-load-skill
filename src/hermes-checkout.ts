import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Read-only verification supports ordinary clones and Git worktrees. */
export async function ensureHermesCheckout(
  path: string,
  _revision: string,
  _progress: (message: string) => void = () => {},
) {
  const root = realpathSync(path);
  if (!statSync(root).isDirectory())
    throw new Error(`Not a checkout directory: ${path}`);
  const { stdout } = await execute(
    "git",
    ["-C", root, "rev-parse", "--show-toplevel"],
    {
      timeout: 10_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
      encoding: "utf8",
    },
  );
  if (realpathSync(stdout.trim()) !== root)
    throw new Error(
      `Configured Hermes location is not the checkout root: ${path}`,
    );
  for (const dir of ["skills", "optional-skills"]) {
    if (!statSync(join(root, dir)).isDirectory())
      throw new Error(`Missing Hermes catalog directory: ${dir}`);
  }
  return root;
}
