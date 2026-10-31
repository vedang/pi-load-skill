import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { fingerprintResources } from "../src/resource-tree.js";

const roots: string[] = [];
const root = () => {
  const path = mkdtempSync(join(tmpdir(), "hermes-resources-"));
  roots.push(path);
  return path;
};
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

it("fingerprints resource bytes and relative paths independently of creation order or absolute checkout", () => {
  const a = root();
  const b = root();
  for (const [dir, names] of [
    [a, ["SKILL.md", "helper.py"]],
    [b, ["helper.py", "SKILL.md"]],
  ] as const) {
    for (const name of names) writeFileSync(join(dir, name), name);
  }
  const initial = fingerprintResources(a).digest;
  expect(fingerprintResources(b).digest).toBe(initial);
  writeFileSync(join(a, "helper.py"), "changed helper, unchanged instructions");
  expect(fingerprintResources(a).digest).not.toBe(initial);
  mkdirSync(join(b, "nested"));
  writeFileSync(join(b, "nested", "added.txt"), "new resource");
  expect(fingerprintResources(b).digest).not.toBe(initial);
});

it("refuses symbolic resource links rather than approving an escape or recursing through a cycle", () => {
  const dir = root();
  const outside = root();
  writeFileSync(join(outside, "outside.py"), "unreviewed");
  symlinkSync(outside, join(dir, "linked"), "dir");
  expect(() => fingerprintResources(dir)).toThrow(/symbolic link/);
});
