import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Versioned framing: sorted UTF-8 relative file paths, NUL, byte length, NUL, bytes.
 * No symlinks (even internal ones) or special files are approved in schema 1.
 * There are none in the audited baseline; rejecting them also avoids cycles.
 */
export function fingerprintResources(directory: string) {
  const root = realpathSync(directory);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink())
        throw new Error(`Unsupported symbolic link: ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile())
        files.push(relative(root, path).split(sep).join("/"));
      else throw new Error(`Unsupported resource type: ${path}`);
    }
  };
  walk(root);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    const bytes = readFileSync(join(root, path));
    hash
      .update(path)
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(bytes);
  }
  return { digest: `sha256:${hash.digest("hex")}`, files };
}
