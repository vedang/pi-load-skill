import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import {
  loadSkillsFromDir,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import type { CatalogEntry } from "./catalog.js";

/** Synchronous so the caller can recheck idle and deliver without yielding. */
export function prepareSkillMessage(selected: CatalogEntry[]) {
  const prepared: ReturnType<typeof prepareOne>[] = [];
  const failures: string[] = [];
  for (const entry of selected) {
    try {
      prepared.push(prepareOne(entry));
    } catch (error) {
      failures.push(`${entry.name} (${entry.filePath}): ${String(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `Batch preparation failed; nothing loaded.\n${failures.join("\n")}`,
    );
  return {
    message: {
      customType: "pi-load-skill",
      content: prepared.map((item) => item.content).join("\n\n"),
      display: true,
      details: { skills: prepared.map((item) => item.details) },
    },
    diagnostics: prepared.flatMap((item) => item.diagnostics),
  };
}

function prepareOne(selected: CatalogEntry) {
  if (realpathSync(selected.filePath) !== selected.identity)
    throw new Error(
      `Selected file identity changed: ${selected.filePath}. Reopen /load-skill.`,
    );
  if (selected.policy) {
    const eligibility = selected.policy.evaluate(selected.filePath);
    if (eligibility.reason)
      throw new Error(
        `${selected.name}: ${eligibility.reason}. Reopen /load-skill.`,
      );
  } else if (selected.reason)
    throw new Error(`${selected.name}: ${selected.reason}`);
  if (basename(selected.filePath) !== "SKILL.md") {
    throw new Error("Only SKILL.md entries can be loaded.");
  }
  // Fail on deletion before invoking native discovery, which could otherwise
  // recurse into bundled directories when the selected SKILL.md disappears.
  if (!statSync(selected.filePath).isFile())
    throw new Error(`Not a skill file: ${selected.filePath}`);
  accessSync(selected.filePath, constants.R_OK);
  const result = loadSkillsFromDir({ dir: selected.baseDir, source: "path" });
  const skill = result.skills.find(
    (entry) => resolve(entry.filePath) === resolve(selected.filePath),
  );
  if (!skill) {
    const reason = result.diagnostics.map((item) => item.message).join("; ");
    throw new Error(
      `Selected skill is no longer loadable: ${selected.filePath}${reason ? ` (${reason})` : ""}. Reopen /load-skill.`,
    );
  }
  const body = stripFrontmatter(readFileSync(skill.filePath, "utf8"));
  return {
    content: `<skill name="${escapeAttribute(skill.name)}" location="${escapeAttribute(skill.filePath)}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`,
    details: {
      name: skill.name,
      filePath: skill.filePath,
      origin: selected.label,
    },
    diagnostics: result.diagnostics.map(
      (item) => `${item.path}: ${item.message}`,
    ),
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
