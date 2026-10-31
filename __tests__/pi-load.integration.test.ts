import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SMOKE_MARKER } from "./fixtures/registration-probe.js";

function smoke(packageOverride?: string) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-load-skill-smoke-"));
  const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
  const packageRoot = resolve(
    packageOverride ?? process.env.PI_LOAD_SKILL_TEST_PACKAGE ?? root,
  );
  // Overrides let the same isolated smoke exercise an installed package/host.
  const cli =
    process.env.PI_LOAD_SKILL_TEST_CLI ??
    join(
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
      JSON.stringify({
        load_specific_skills: {
          specific_skills: ["catalog"],
          hermes_agent_skills: join(agentDir, "hermes"),
        },
      }),
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
        packageRoot,
        "--offline",
        "--no-session",
        "--no-skills",
        "--no-prompt-templates",
        "--mode",
        "rpc",
      ],
      {
        cwd: agentDir,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: "1",
          PI_LOAD_SKILL_TEST_PACKAGE: packageRoot,
        },
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
}

it(
  "loads the package in real offline Pi without discovery, advertisement, or checkout access",
  () => smoke(),
  15_000,
);

it("publishes metadata but no Hermes code and loads the unpacked package in real offline Pi", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-load-skill-pack-"));
  try {
    const archive = join(dir, "package.tgz");
    const pack = spawnSync("pnpm", ["pack", "--out", archive], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(pack.status, pack.stderr).toBe(0);
    const list = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
    expect(list.status, list.stderr).toBe(0);
    const files = list.stdout.trim().split("\n");
    expect(files).toContain("package/resources/hermes-catalog.json");
    expect(
      files.some((path) =>
        /(^|\/)SKILL\.md$|\.(py|sh)$|node_modules|optional-skills\//.test(path),
      ),
    ).toBe(false);
    const extract = spawnSync("tar", ["-xzf", archive, "-C", dir], {
      encoding: "utf8",
    });
    expect(extract.status, extract.stderr).toBe(0);
    const unpacked = join(dir, "package");
    const manifest = JSON.parse(
      readFileSync(join(unpacked, "package.json"), "utf8"),
    );
    expect(manifest.pi.skills).toBeUndefined();
    const catalog = JSON.parse(
      readFileSync(join(unpacked, "resources/hermes-catalog.json"), "utf8"),
    );
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(catalog.entries.length).toBeGreaterThan(0);
    smoke(unpacked);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
