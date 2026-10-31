import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

export const SMOKE_MARKER = "PI_LOAD_SKILL_SMOKE_OK";

/** Runs before the package, in an actual isolated Pi process. */
export default function registrationProbe(pi: ExtensionAPI): void {
  const packageEntry = resolve(
    fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
  );
  const catalogRoot = join(getAgentDir(), "catalog");
  const originalRead = fs.readFileSync;
  const originalReaddir = fs.readdirSync;
  const originalFetch = globalThis.fetch;
  let catalogReads = 0;
  let networkAttempts = 0;
  const inspect = (path: unknown) => {
    if (String(path).startsWith(catalogRoot)) catalogReads++;
  };
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    inspect(args[0]);
    return originalRead(...args);
  }) as typeof fs.readFileSync;
  fs.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    inspect(args[0]);
    return originalReaddir(...args);
  }) as typeof fs.readdirSync;
  syncBuiltinESMExports();
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error("Smoke test blocks network requests.");
  };

  pi.on("session_start", (_event, ctx) => {
    const commands = pi
      .getCommands()
      .filter((command) => command.sourceInfo.path === packageEntry);
    const tools = pi
      .getAllTools()
      .filter((tool) => tool.sourceInfo.path === packageEntry);
    const prompt = ctx.getSystemPrompt();
    if (
      commands.length !== 1 ||
      commands[0]?.name !== "load-skill" ||
      tools.length !== 0 ||
      catalogReads !== 0 ||
      networkAttempts !== 0 ||
      prompt.includes(catalogRoot) ||
      prompt.includes("private-smoke-skill")
    ) {
      throw new Error(
        "Unexpected startup discovery, advertisement, tool exposure, or network access.",
      );
    }
    process.stderr.write(`${SMOKE_MARKER}\n`);
  });
  pi.on("session_shutdown", () => {
    fs.readFileSync = originalRead;
    fs.readdirSync = originalReaddir;
    syncBuiltinESMExports();
    globalThis.fetch = originalFetch;
  });
}
