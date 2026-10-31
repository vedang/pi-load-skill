#!/usr/bin/env node
// Developer-only, offline inventory/fingerprint verification. Never classifies skills.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { fingerprintResources } from "../src/resource-tree.ts";

const [command, directory, reviewPath, outputPath] = process.argv.slice(2);
if (!directory || !["inventory", "verify", "generate"].includes(command)) {
  throw new Error(
    "Usage: node scripts/hermes-catalog.mjs inventory|verify|generate CHECKOUT [REVIEW.json OUTPUT.json]",
  );
}
const root = resolve(directory);
const inventory = [];
function walk(dir) {
  if (existsSync(join(dir, "SKILL.md"))) {
    const path = relative(root, dir).replaceAll("\\", "/");
    const { frontmatter } = parseFrontmatter(
      readFileSync(join(dir, "SKILL.md"), "utf8"),
    );
    inventory.push({
      path,
      name: frontmatter.name || basename(dir),
      description: frontmatter.description || "No native description",
      category: path.split("/")[1],
      origin: path.startsWith("skills/") ? "built-in" : "official-optional",
      ...fingerprintResources(dir),
    });
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Unsupported inventory symlink: ${join(dir, entry.name)}`,
      );
    if (entry.isDirectory()) walk(join(dir, entry.name));
  }
}
for (const tree of ["skills", "optional-skills"]) walk(join(root, tree));
inventory.sort((a, b) => a.path.localeCompare(b.path));
if (command === "inventory") console.log(JSON.stringify(inventory, null, 2));
if (command === "verify") {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../resources/hermes-catalog.json", import.meta.url),
      "utf8",
    ),
  );
  const errors = [];
  for (const item of inventory) {
    const approved = catalog.entries.find((entry) => entry.path === item.path);
    if (!approved) errors.push(`${item.path}: Not reviewed`);
    else if (approved.digest !== item.digest)
      errors.push(`${item.path}: Changed since portability review`);
  }
  for (const item of catalog.entries)
    if (!inventory.some((entry) => entry.path === item.path))
      errors.push(`${item.path}: Missing`);
  console.log(
    JSON.stringify(
      { reviewedRevision: catalog.revision, entries: inventory.length, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}
if (command === "generate") {
  if (!reviewPath || !outputPath)
    throw new Error("generate requires REVIEW.json and OUTPUT.json");
  const reviews = JSON.parse(readFileSync(reviewPath, "utf8"));
  if (
    reviews.length !== inventory.length ||
    new Set(reviews.map((entry) => entry.path)).size !== inventory.length
  )
    throw new Error("Review must cover the entire inventory exactly once");
  const entries = inventory.map(({ files, ...item }) => {
    const review = reviews.find((entry) => entry.path === item.path);
    if (
      !review ||
      !["portable", "blocked"].includes(review.decision) ||
      !review.reason ||
      !review.evidence?.length ||
      !review.reviewedFiles?.includes(`${item.path}/SKILL.md`)
    )
      throw new Error(`Incomplete body review: ${item.path}`);
    if (
      !Array.isArray(review.platforms) ||
      (review.decision === "portable" && !review.platforms.length) ||
      !Array.isArray(review.prerequisites)
    )
      throw new Error(`Incomplete platform/prerequisites: ${item.path}`);
    return { ...item, ...review, digest: item.digest, resourceFiles: files };
  });
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Expected full upstream revision");
  writeFileSync(
    outputPath,
    `${JSON.stringify({ schemaVersion: 1, upstream: "https://github.com/NousResearch/hermes-agent.git", revision, reviewDate: new Date().toISOString().slice(0, 10), hashFormat: "sha256:path-NUL-byteLength-NUL-bytes; sorted relative paths; regular files only", entries }, null, 2)}\n`,
  );
  console.log(`Wrote ${entries.length} reviewed entries to ${outputPath}`);
}
