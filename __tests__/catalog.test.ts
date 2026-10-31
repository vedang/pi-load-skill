import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalog } from "../src/catalog.js";

let agentDir: string;
beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-load-skill-catalog-"));
});
afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

function settings(value: unknown) {
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ load_specific_skills: value }),
  );
}
function skill(
  root: string,
  directory: string,
  frontmatter = "name: shared\ndescription: Useful instructions",
) {
  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nBody.`);
  return join(dir, "SKILL.md");
}

describe("private catalog configuration and native discovery", () => {
  it.each([
    ["package", "package"],
    ["git:github.com/example/package.git@v1", "git/github.com/example/package"],
    ["npm:@example/package@1.2.3", "npm/node_modules/@example/package"],
  ])(
    "discovers declared skills from installed source %s without activating extensions",
    async (source, installedDirectory) => {
      const root = join(agentDir, installedDirectory);
      const selected = skill(join(root, ".agents/skills"), "included");
      skill(join(root, ".agents/skills"), "excluded");
      skill(root, "not-declared");
      const marker = join(agentDir, "extension-executed");
      writeFileSync(
        join(root, "extension.ts"),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "must not execute"); throw new Error("must not activate");`,
      );
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          name: "@example/package",
          version: "1.2.3",
          pi: {
            extensions: ["./extension.ts"],
            skills: ["./.agents/skills/*", "!.agents/skills/excluded/**"],
          },
        }),
      );
      settings({ specific_packages: [source] });
      const catalog = await readCatalog(agentDir);
      expect(catalog.skills.map((entry) => entry.filePath)).toEqual([selected]);
      expect(catalog.diagnostics).toEqual([]);
      expect(existsSync(marker)).toBe(false);
    },
  );

  it("combines both keys, deduplicates identical files, and respects native conventional package skills", async () => {
    const packageRoot = join(agentDir, "package");
    const packaged = skill(join(packageRoot, "skills"), "packaged");
    const direct = skill(join(agentDir, "direct"), "local");
    settings({
      specific_skills: ["direct", "package/skills"],
      specific_packages: ["package"],
    });
    const catalog = await readCatalog(agentDir);
    expect(catalog.skills.map((entry) => entry.filePath).sort()).toEqual(
      [direct, packaged].sort(),
    );
    expect(catalog.skills.map((entry) => entry.name)).toEqual([
      "shared",
      "shared",
    ]);
    expect(catalog.diagnostics).toEqual([]);
  });

  it("reports uninstalled packages without fetching them and keeps other package skills usable", async () => {
    const selected = skill(join(agentDir, "package/skills"), "included");
    settings({
      specific_packages: ["git:github.com/example/missing", "package"],
    });
    const catalog = await readCatalog(agentDir);
    expect(catalog.skills.map((entry) => entry.filePath)).toEqual([selected]);
    expect(catalog.diagnostics.join("\n")).toContain(
      "Package is not installed locally",
    );
    expect(existsSync(join(agentDir, "git"))).toBe(false);
  });

  it("does not treat an extension-only package as a skill collection", async () => {
    const root = join(agentDir, "package");
    skill(root, "not-declared");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ pi: { extensions: ["./extension.ts"] } }),
    );
    writeFileSync(
      join(root, "extension.ts"),
      "throw new Error('must not execute');",
    );
    settings({ specific_packages: ["package"] });
    expect(await readCatalog(agentDir)).toEqual({
      skills: [],
      diagnostics: [],
    });
  });

  it.each([{}, { specific_skills: [] }, { specific_packages: [] }])(
    "gives setup guidance without inferring a catalog: %j",
    async (config) => {
      settings(config);
      await expect(readCatalog(agentDir)).rejects.toThrow(
        /specific_skills.*settings.json/,
      );
    },
  );

  it.each([
    { specific_skills: "skills" },
    { specific_skills: [""] },
    { specific_skills: [42] },
    { specific_skills: ["npm:skills"] },
    { specific_packages: "git:github.com/example/skills" },
    { specific_packages: [""] },
    { specific_packages: [42] },
  ])(
    "diagnoses an invalid source without discarding healthy sources: %j",
    async (config) => {
      const valid = skill(join(agentDir, "healthy/skills"), "one");
      settings({ ...config, specific_packages: ["healthy"] });
      if ("specific_packages" in config)
        settings({ ...config, specific_skills: ["healthy/skills"] });
      const result = await readCatalog(agentDir);
      expect(result.skills.map((s) => s.filePath)).toEqual([valid]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );

  it("ignores obsolete top-level sources with actionable diagnostics and isolates malformed Hermes settings", async () => {
    skill(join(agentDir, "obsolete"), "must-not-load");
    const healthy = skill(join(agentDir, "healthy"), "current");
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        specific_skills: ["obsolete"],
        specific_packages: ["obsolete"],
        load_specific_skills: {
          specific_skills: ["healthy"],
          hermes_agent_skills: "https://example.invalid/repo.git",
        },
      }),
    );
    const catalog = await readCatalog(agentDir);
    expect(catalog.skills.map((entry) => entry.filePath)).toEqual([healthy]);
    expect(catalog.diagnostics.join("\n")).toContain(
      "move it into load_specific_skills.specific_skills",
    );
    expect(catalog.diagnostics.join("\n")).toContain(
      "move it into load_specific_skills.specific_packages",
    );
    expect(catalog.diagnostics.join("\n")).toContain("hermes_agent_skills");
    expect(catalog.diagnostics.join("\n")).toContain(
      "Not a local directory path",
    );
  });

  it("reports missing settings and invalid JSON without silently falling back", async () => {
    await expect(readCatalog(agentDir)).rejects.toThrow(
      /Add load_specific_skills/,
    );
    writeFileSync(join(agentDir, "settings.json"), "{broken");
    await expect(readCatalog(agentDir)).rejects.toThrow(/Cannot read settings/);
  });

  it("keeps distinct same-name skills while deduplicating symlinks and overlapping roots", async () => {
    const root = join(agentDir, "catalog");
    const first = skill(root, "one");
    const second = skill(root, "two");
    symlinkSync(join(root, "one"), join(root, "alias"), "dir");
    settings({ specific_skills: ["catalog", root, join(root, "one")] });
    const catalog = await readCatalog(agentDir);
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.skills.map((entry) => entry.name)).toEqual([
      "shared",
      "shared",
    ]);
    // Native ordering may choose the alias, but neither distinct file is lost.
    expect(new Set(catalog.skills.map((entry) => entry.baseDir)).size).toBe(2);
    expect(catalog.skills.some((entry) => entry.filePath === second)).toBe(
      true,
    );
    expect(
      catalog.skills.some(
        (entry) =>
          entry.filePath === first ||
          entry.filePath === join(root, "alias", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("preserves native warning/exclusion rules, ignores standalone files, and survives bad roots", async () => {
    const root = join(agentDir, "catalog");
    const valid = skill(root, "valid");
    const warned = skill(
      root,
      "warned",
      "name: Invalid-Name\ndescription: Still loadable",
    );
    skill(root, "missing-description", "name: excluded");
    skill(root, "malformed", "name: [broken");
    const ignored = skill(root, "ignored");
    writeFileSync(join(root, ".gitignore"), "ignored/\n");
    writeFileSync(
      join(root, "standalone.md"),
      "---\nname: standalone\ndescription: Not in this catalog\n---\nBody.",
    );
    settings({
      specific_skills: [
        join(agentDir, "missing"),
        join(root, "standalone.md"),
        "catalog",
      ],
    });
    const catalog = await readCatalog(agentDir);
    expect(catalog.skills.map((entry) => entry.filePath).sort()).toEqual(
      [valid, warned].sort(),
    );
    expect(catalog.skills.some((entry) => entry.filePath === ignored)).toBe(
      false,
    );
    expect(catalog.diagnostics.join("\n")).toMatch(/Cannot read catalog root/);
    expect(catalog.diagnostics.join("\n")).toMatch(/description is required/);
    expect(catalog.diagnostics.join("\n")).toMatch(/invalid characters/);
  });
});
