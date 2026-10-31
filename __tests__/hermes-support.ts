import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HermesMetadata, HermesReview } from "../src/hermes-catalog.js";
import { fingerprintResources } from "../src/resource-tree.js";

export function hermesFixture(root: string) {
  mkdirSync(join(root, "skills"), { recursive: true });
  mkdirSync(join(root, "optional-skills"), { recursive: true });
  execFileSync("git", ["init", "--quiet", root]);
  const metadata: HermesMetadata = {
    schemaVersion: 1,
    upstream: "https://github.com/NousResearch/hermes-agent.git",
    revision: "a".repeat(40),
    entries: [],
  };
  const add = (name: string, changes: Partial<HermesReview> = {}) => {
    const path = `skills/examples/${name}`;
    const directory = join(root, path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Synthetic ${name}\n---\nInstructions ${name}.`,
    );
    writeFileSync(
      join(directory, "helper.py"),
      "# reviewed synthetic helper\n",
    );
    metadata.entries.push({
      path,
      name,
      description: `Synthetic ${name}`,
      category: "examples",
      origin: "built-in",
      decision: "portable",
      reason: "Standalone synthetic instructions",
      evidence: ["Fixture body and helper reviewed"],
      digest: fingerprintResources(directory).digest,
      platforms: [process.platform],
      prerequisites: ["Example CLI (not installed by loader)"],
      dependencies: [],
      ...changes,
    });
    return join(directory, "SKILL.md");
  };
  return { metadata, add };
}
