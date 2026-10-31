import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readCatalog } from "../src/catalog.js";
import { readHermesMetadata } from "../src/hermes-catalog.js";
import { hermesFixture } from "./hermes-support.js";

vi.mock("../src/hermes-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/hermes-catalog.js")>()),
  readHermesMetadata: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup() {
  const agent = mkdtempSync(join(tmpdir(), "hermes-catalog-"));
  roots.push(agent);
  const root = join(agent, "hermes");
  return { agent, root, ...hermesFixture(root) };
}

it("composes native Hermes candidates with fail-closed review states and preserves policy across personal aliases", async () => {
  const f = setup();
  f.add("portable");
  const blocked = f.add("blocked", {
    decision: "blocked",
    reason: "Requires Hermes delegation",
  });
  const changed = f.add("changed");
  writeFileSync(
    join(dirname(changed), "helper.py"),
    "# changed supporting resource\n",
  );
  f.add("unsupported", {
    platforms: [process.platform === "linux" ? "darwin" : "linux"],
  });
  f.add("unknown");
  f.metadata.entries.pop();
  const invalid = f.add("invalid");
  writeFileSync(invalid, "---\nname: invalid\n---\nNo native description");
  const personal = join(f.agent, "personal");
  mkdirSync(personal);
  symlinkSync(dirname(blocked), join(personal, "alias"), "dir");
  writeFileSync(
    join(f.agent, "settings.json"),
    JSON.stringify({
      load_specific_skills: {
        specific_skills: [personal],
        hermes_agent_skills: f.root,
      },
    }),
  );
  vi.mocked(readHermesMetadata).mockReturnValue(f.metadata);
  const catalog = await readCatalog(f.agent);
  expect(catalog.skills).toHaveLength(5);
  const byName = new Map(catalog.skills.map((skill) => [skill.name, skill]));
  expect(byName.get("portable")?.reason).toBeUndefined();
  expect(byName.get("blocked")).toMatchObject({
    origin: "hermes",
    reason: "Requires Hermes delegation",
  });
  expect(byName.get("changed")?.reason).toBe(
    "Changed since portability review",
  );
  expect(byName.get("unsupported")?.reason).toContain("Unsupported platform");
  expect(byName.get("unknown")?.reason).toBe("Not reviewed");
  expect(byName.has("invalid")).toBe(false);
  expect(catalog.diagnostics.join("\n")).toContain("description is required");
});

it("keeps healthy personal sources usable but never permits a Hermes alias when metadata is unavailable", async () => {
  const f = setup();
  const blocked = f.add("blocked");
  const personal = join(f.agent, "personal");
  mkdirSync(personal);
  symlinkSync(dirname(blocked), join(personal, "alias"), "dir");
  mkdirSync(join(personal, "healthy"));
  writeFileSync(
    join(personal, "healthy/SKILL.md"),
    "---\nname: healthy\ndescription: Personal\n---\nBody",
  );
  writeFileSync(
    join(f.agent, "settings.json"),
    JSON.stringify({
      load_specific_skills: {
        specific_skills: [personal],
        hermes_agent_skills: f.root,
      },
    }),
  );
  vi.mocked(readHermesMetadata).mockImplementation(() => {
    throw new Error("Missing bundled catalog");
  });
  const result = await readCatalog(f.agent);
  expect(
    result.skills.find((skill) => skill.name === "healthy")?.reason,
  ).toBeUndefined();
  expect(
    result.skills.find((skill) => skill.name === "blocked")?.reason,
  ).toContain("Missing bundled catalog");
  expect(result.diagnostics.join("\n")).toContain("Missing bundled catalog");
});
