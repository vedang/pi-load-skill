import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalog } from "../src/catalog.js";

let agentDir: string;
beforeEach(() => { agentDir = mkdtempSync(join(tmpdir(), "pi-load-skill-catalog-")); });
afterEach(() => { rmSync(agentDir, { recursive: true, force: true }); });

function settings(value: unknown) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
}
function skill(root: string, directory: string, frontmatter = "name: shared\ndescription: Useful instructions") {
  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nBody.`);
  return join(dir, "SKILL.md");
}

describe("private catalog configuration and native discovery", () => {
  it.each([{}, { specific_skills: [] }, { specific_packages: ["ignored"] }])("gives setup guidance without inferring a catalog: %j", (config) => {
    settings(config);
    expect(() => readCatalog(agentDir)).toThrow(/specific_skills.*settings.json/);
  });

  it.each([null, [], { specific_skills: "skills" }, { specific_skills: [""] }, { specific_skills: [42] }, { specific_skills: ["npm:skills"] }])("rejects invalid configuration: %j", (config) => {
    settings(config);
    expect(() => readCatalog(agentDir)).toThrow();
  });

  it("reports missing settings and invalid JSON without silently falling back", () => {
    expect(() => readCatalog(agentDir)).toThrow(/Add a nonempty specific_skills/);
    writeFileSync(join(agentDir, "settings.json"), "{broken");
    expect(() => readCatalog(agentDir)).toThrow(/Cannot read settings/);
  });

  it("keeps distinct same-name skills while deduplicating symlinks and overlapping roots", () => {
    const root = join(agentDir, "catalog");
    const first = skill(root, "one");
    const second = skill(root, "two");
    symlinkSync(join(root, "one"), join(root, "alias"), "dir");
    settings({ specific_skills: ["catalog", root, join(root, "one")] });
    const catalog = readCatalog(agentDir);
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["shared", "shared"]);
    // Native ordering may choose the alias, but neither distinct file is lost.
    expect(new Set(catalog.skills.map((entry) => entry.baseDir))).toHaveLength(2);
    expect(catalog.skills.some((entry) => entry.filePath === second)).toBe(true);
    expect(catalog.skills.some((entry) => entry.filePath === first || entry.filePath === join(root, "alias", "SKILL.md"))).toBe(true);
  });

  it("preserves native warning/exclusion rules, ignores standalone files, and survives bad roots", () => {
    const root = join(agentDir, "catalog");
    const valid = skill(root, "valid");
    const warned = skill(root, "warned", "name: Invalid-Name\ndescription: Still loadable");
    skill(root, "missing-description", "name: excluded");
    skill(root, "malformed", "name: [broken");
    const ignored = skill(root, "ignored");
    writeFileSync(join(root, ".gitignore"), "ignored/\n");
    writeFileSync(join(root, "standalone.md"), "---\nname: standalone\ndescription: Not in this catalog\n---\nBody.");
    settings({ specific_skills: [join(agentDir, "missing"), join(root, "standalone.md"), "catalog"] });
    const catalog = readCatalog(agentDir);
    expect(catalog.skills.map((entry) => entry.filePath).sort()).toEqual([valid, warned].sort());
    expect(catalog.skills.some((entry) => entry.filePath === ignored)).toBe(false);
    expect(catalog.diagnostics.join("\n")).toMatch(/Cannot read catalog root/);
    expect(catalog.diagnostics.join("\n")).toMatch(/description is required/);
    expect(catalog.diagnostics.join("\n")).toMatch(/invalid characters/);
  });
});
