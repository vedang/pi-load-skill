import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SMOKE_MARKER } from "./fixtures/registration-probe.js";

it("loads the package in real offline Pi without discovering or advertising the private catalog", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-load-skill-smoke-"));
  const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
  // Resolve the installed Pi entry, not a shell or a globally installed version.
  const cli = join(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
    "cli.js",
  );
  try {
    const skillDir = join(agentDir, "catalog", "private-smoke-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: private-smoke-skill\ndescription: Do not advertise this skill\n---\nPRIVATE BODY",
    );
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ specific_skills: ["catalog"] }),
    );
    writeFileSync(join(agentDir, "auth.json"), "{}");
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "--no-extensions",
        "-e",
        join(root, "__tests__/fixtures/registration-probe.ts"),
        "-e",
        root,
        "--offline",
        "--no-session",
        "--no-skills",
        "--no-prompt-templates",
        "--mode",
        "rpc",
      ],
      {
        cwd: agentDir,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
        input: "",
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr.split(SMOKE_MARKER).length - 1, result.stderr).toBe(1);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}, 15_000);
