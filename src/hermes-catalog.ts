import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { fingerprintResources } from "./resource-tree.js";

export interface HermesReview {
  path: string;
  name: string;
  description: string;
  category: string;
  origin: "built-in" | "official-optional";
  decision: "portable" | "blocked";
  reason: string;
  evidence: string[];
  digest: string;
  platforms: string[];
  prerequisites: string[];
  dependencies: string[];
}
export interface HermesMetadata {
  schemaVersion: 1;
  upstream: string;
  revision: string;
  entries: HermesReview[];
}
export function readHermesMetadata(): HermesMetadata {
  const value = JSON.parse(
    readFileSync(
      new URL("../resources/hermes-catalog.json", import.meta.url),
      "utf8",
    ),
  ) as HermesMetadata;
  if (
    value.schemaVersion !== 1 ||
    value.upstream !== "https://github.com/NousResearch/hermes-agent.git" ||
    !/^[a-f0-9]{40}$/.test(value.revision) ||
    !Array.isArray(value.entries)
  )
    throw new Error("Invalid bundled Hermes catalog header");
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (
      !entry.path ||
      !/^(skills|optional-skills)\//.test(entry.path) ||
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      entry.path.includes("\\") ||
      seen.has(entry.path) ||
      !["portable", "blocked"].includes(entry.decision) ||
      !entry.reason ||
      !entry.name ||
      !entry.description ||
      !entry.category ||
      !["built-in", "official-optional"].includes(entry.origin) ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.digest) ||
      ![
        entry.platforms,
        entry.prerequisites,
        entry.evidence,
        entry.dependencies,
      ].every(
        (list) =>
          Array.isArray(list) && list.every((item) => typeof item === "string"),
      )
    )
      throw new Error(`Invalid bundled Hermes catalog entry: ${entry.path}`);
    seen.add(entry.path);
  }
  return value;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

/** Invocation-local policy is retained even when the Hermes source failed. */
export class HermesPolicy {
  readonly root: string;
  constructor(
    readonly configuredPath: string,
    readonly metadata?: HermesMetadata,
    readonly failure?: string,
  ) {
    try {
      this.root = realpathSync(configuredPath);
    } catch {
      this.root = resolve(configuredPath);
    }
  }
  owns(filePath: string): boolean {
    if (
      within(resolve(this.configuredPath), resolve(filePath)) ||
      within(this.root, resolve(filePath))
    )
      return true;
    try {
      return within(this.root, realpathSync(filePath));
    } catch {
      return false;
    }
  }
  evaluate(
    filePath: string,
    platform: string = process.platform,
  ): { reason?: string; review?: HermesReview } {
    if (this.failure || !this.metadata)
      return { reason: this.failure ?? "Hermes catalog unavailable" };
    try {
      const currentRoot = realpathSync(this.configuredPath);
      const identity = realpathSync(filePath);
      if (currentRoot !== this.root || !within(this.root, identity))
        return {
          reason: "Outside the configured Hermes checkout resource boundary",
        };
      const path = relative(this.root, dirname(identity)).split(sep).join("/");
      const review = this.metadata.entries.find((entry) => entry.path === path);
      if (!review) return { reason: "Not reviewed" };
      if (review.decision !== "portable")
        return { reason: review.reason, review };
      if (!review.platforms.includes(platform))
        return {
          reason: `Unsupported platform: ${platform}; reviewed for ${review.platforms.join(", ") || "none"}`,
          review,
        };
      if (fingerprintResources(dirname(identity)).digest !== review.digest)
        return { reason: "Changed since portability review", review };
      for (const name of review.dependencies) {
        const dependency = this.metadata.entries.find(
          (entry) => entry.name === name,
        );
        if (!dependency)
          return {
            reason: `Required dependency not reviewed: ${name}`,
            review,
          };
        // The initial catalog has a deliberately small, acyclic required-dependency set.
        const result = this.evaluateDependency(
          dependency,
          platform,
          new Set([review.path]),
        );
        if (result)
          return { reason: `Required dependency ${name}: ${result}`, review };
      }
      return { review };
    } catch (error) {
      return { reason: `Cannot verify reviewed resources: ${String(error)}` };
    }
  }
  private evaluateDependency(
    review: HermesReview,
    platform: string,
    seen: Set<string>,
  ): string | undefined {
    if (seen.has(review.path)) return "Cyclic required skill dependency";
    if (review.decision !== "portable") return review.reason;
    if (!review.platforms.includes(platform))
      return `Unsupported platform: ${platform}`;
    const path = resolve(this.root, review.path);
    if (!within(this.root, realpathSync(path))) return "Outside checkout";
    if (fingerprintResources(path).digest !== review.digest)
      return "Changed since portability review";
    if (
      !loadSkillsFromDir({ dir: path, source: "path" }).skills.some(
        (skill) => realpathSync(skill.filePath) === resolve(path, "SKILL.md"),
      )
    )
      return "Natively invalid required skill";
    const next = new Set([...seen, review.path]);
    for (const name of review.dependencies) {
      const dep = this.metadata?.entries.find((entry) => entry.name === name);
      if (!dep) return `Not reviewed: ${name}`;
      const reason = this.evaluateDependency(dep, platform, next);
      if (reason) return reason;
    }
    return undefined;
  }
}
