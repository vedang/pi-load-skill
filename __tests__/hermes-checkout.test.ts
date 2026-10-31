import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureHermesCheckout } from "../src/hermes-checkout.js";
import { hermesFixture } from "./hermes-support.js";

let dir: string;
let upstream: string;
let revision: string;
let realGit: string;
let log: string;
const git = (...args: string[]) =>
  execFileSync(realGit, args, { encoding: "utf8" }).trim();
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hermes-checkout-"));
  realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  upstream = join(dir, "upstream");
  const f = hermesFixture(upstream);
  f.add("example");
  writeFileSync(join(upstream, "optional-skills/.keep"), "fixture");
  git("-C", upstream, "add", ".");
  git(
    "-C",
    upstream,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  revision = git("-C", upstream, "rev-parse", "HEAD");
  writeFileSync(join(upstream, "later.txt"), "must not be in audited checkout");
  git("-C", upstream, "add", ".");
  git(
    "-C",
    upstream,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "later",
  );
  const bin = join(dir, "bin");
  mkdirSync(bin);
  log = join(dir, "git-calls.jsonl");
  const executable = join(bin, "git");
  // Only the fixed remote is mapped to an offline fixture. Real Git owns clone,
  // checkout, worktree validation and object identity; this wrapper controls
  // subprocess failures/races at the executable boundary, not inside production.
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs'); const cp=require('node:child_process');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,prompt:process.env.GIT_TERMINAL_PROMPT,askpass:process.env.GIT_ASKPASS,global:process.env.GIT_CONFIG_GLOBAL})+'\\n');
if(args.includes('clone')) {
 if(process.env.FIXTURE_MODE==='timeout') { fs.writeFileSync(${JSON.stringify(join(dir, "ready"))},'ready'); setInterval(()=>{},1000); return; }
 if(process.env.FIXTURE_MODE==='failure') { fs.mkdirSync(args.at(-1),{recursive:true}); fs.writeFileSync(args.at(-1)+'/partial','partial'); process.stderr.write('offline fixture failure'); process.exit(1); }
 const index=args.indexOf('https://github.com/NousResearch/hermes-agent.git');
 if(index<0) throw new Error('unexpected upstream'); args[index]=${JSON.stringify(upstream)};
}
const result=cp.spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit',env:process.env});
if(args.includes('clone') && process.env.FIXTURE_MODE==='race') { fs.mkdirSync(process.env.FIXTURE_DESTINATION); fs.writeFileSync(process.env.FIXTURE_DESTINATION+'/survivor','concurrent data'); }
process.exit(result.status ?? 1);
`,
  );
  chmodSync(executable, 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
const calls = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const stages = () =>
  readdirSync(dir).filter((name) => name.startsWith(".destination-clone-"));

it("clones only the audited revision through noninteractive argv and reuses it without a second clone", async () => {
  const destination = join(dir, "destination");
  const progress = vi.fn();
  await ensureHermesCheckout(destination, revision, progress);
  expect(git("-C", destination, "rev-parse", "HEAD")).toBe(revision);
  expect(existsSync(join(destination, "later.txt"))).toBe(false);
  expect(progress).toHaveBeenCalledWith(
    expect.stringContaining("Cloning Hermes"),
  );
  const clone = calls().find((call) => call.args.includes("clone"));
  expect(clone).toMatchObject({ prompt: "0", askpass: "" });
  expect(clone.args).toContain("--no-recurse-submodules");
  expect(clone.args).toContain(
    "https://github.com/NousResearch/hermes-agent.git",
  );
  writeFileSync(join(destination, "user-change.txt"), "do not touch");
  const before = git("-C", destination, "status", "--porcelain");
  await ensureHermesCheckout(destination, "b".repeat(40));
  expect(git("-C", destination, "status", "--porcelain")).toBe(before);
  expect(git("-C", destination, "rev-parse", "HEAD")).toBe(revision);
  expect(calls().filter((call) => call.args.includes("clone"))).toHaveLength(1);
  expect(stages()).toEqual([]);
});

it("accepts a normal Git worktree but rejects an ancestor repository and preexisting partial paths without modification", async () => {
  const worktree = join(dir, "worktree");
  git("-C", upstream, "worktree", "add", "--detach", worktree, revision);
  expect(await ensureHermesCheckout(worktree, revision)).toBe(
    realpathSync(worktree),
  );
  const subdirectory = join(upstream, "nested");
  mkdirSync(subdirectory);
  await expect(ensureHermesCheckout(subdirectory, revision)).rejects.toThrow(
    /not the checkout root/,
  );
  const partial = join(dir, "partial");
  mkdirSync(partial);
  writeFileSync(join(partial, "survivor"), "keep");
  await expect(ensureHermesCheckout(partial, revision)).rejects.toThrow();
  const file = join(dir, "file");
  writeFileSync(file, "keep file");
  await expect(ensureHermesCheckout(file, revision)).rejects.toThrow();
  expect(readFileSync(join(partial, "survivor"), "utf8")).toBe("keep");
  expect(readFileSync(file, "utf8")).toBe("keep file");
  expect(calls().some((call) => call.args.includes("clone"))).toBe(false);
});

it.each(["failure", "race"])(
  "cleans only its staging clone after %s and never overwrites a concurrent destination",
  async (mode) => {
    const destination = join(dir, "destination");
    vi.stubEnv("FIXTURE_MODE", mode);
    vi.stubEnv("FIXTURE_DESTINATION", destination);
    await expect(ensureHermesCheckout(destination, revision)).rejects.toThrow();
    expect(stages()).toEqual([]);
    if (mode === "race")
      expect(readFileSync(join(destination, "survivor"), "utf8")).toBe(
        "concurrent data",
      );
    else expect(existsSync(destination)).toBe(false);
  },
);

it("reports a missing Git executable and cleans its owned temporary directory", async () => {
  vi.stubEnv("PATH", "");
  await expect(
    ensureHermesCheckout(join(dir, "destination"), revision),
  ).rejects.toThrow(/ENOENT/);
  expect(stages()).toEqual([]);
});

it("bounds a hung clone and cleans its partial staging tree", async () => {
  vi.stubEnv("FIXTURE_MODE", "timeout");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const ready = new Promise<void>((resolve) => {
    const watcher = watch(dir, () => {
      if (existsSync(join(dir, "ready"))) {
        watcher.close();
        resolve();
      }
    });
  });
  const result = expect(
    ensureHermesCheckout(join(dir, "destination"), revision),
  ).rejects.toThrow(/timed out/);
  await ready;
  await vi.advanceTimersByTimeAsync(120_000);
  await result;
  expect(stages()).toEqual([]);
  expect(existsSync(join(dir, "destination"))).toBe(false);
});
