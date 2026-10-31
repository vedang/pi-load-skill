import childProcess from "node:child_process";
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
    process.env.PI_LOAD_SKILL_TEST_PACKAGE ??
      fileURLToPath(new URL("../../", import.meta.url)),
    "src/index.ts",
  );
  const catalogRoot = join(getAgentDir(), "catalog");
  const hermesRoot = join(getAgentDir(), "hermes");
  const metadataPath = resolve(
    packageEntry,
    "../../resources/hermes-catalog.json",
  );
  const originalRead = fs.readFileSync;
  const originalReaddir = fs.readdirSync;
  const originalFetch = globalThis.fetch;
  let catalogReads = 0;
  let networkAttempts = 0;
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    if (
      args
        .flat()
        .some(
          (value) =>
            String(value).includes("NousResearch/hermes-agent") ||
            value === "clone",
        )
    ) {
      networkAttempts++;
      throw new Error("Smoke test blocks cloning.");
    }
    return originalSpawn(...args);
  }) as typeof childProcess.spawn;
  const inspect = (path: unknown) => {
    const value = path instanceof URL ? fileURLToPath(path) : String(path);
    if (
      value.startsWith(catalogRoot) ||
      value.startsWith(hermesRoot) ||
      value === metadataPath
    )
      catalogReads++;
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
      prompt.includes(hermesRoot) ||
      prompt.includes("private-smoke-skill")
    ) {
      throw new Error(
        "Unexpected startup discovery, advertisement, tool exposure, or network access.",
      );
    }
    process.stderr.write(`${SMOKE_MARKER}\n`);
  });
  pi.on("session_shutdown", () => {
    childProcess.spawn = originalSpawn;
    fs.readFileSync = originalRead;
    fs.readdirSync = originalReaddir;
    syncBuiltinESMExports();
    globalThis.fetch = originalFetch;
  });
}
