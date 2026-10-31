import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { CatalogEntry } from "./catalog.js";

export function showSkillPicker(
  ctx: ExtensionContext,
  skills: CatalogEntry[],
  query: string,
): Promise<CatalogEntry[] | undefined> {
  return ctx.ui.custom<CatalogEntry[] | undefined>(
    (tui, theme, keybindings, done) => {
      const input = new Input();
      input.handleInput(query);
      const checked = new Set<string>();
      let matches: CatalogEntry[] = [];
      let index = 0;
      let detailOffset = 0;
      let detailPageSize = 1;
      let detailLineCount = 0;
      let closed = false;
      const clean = (text: string) =>
        stripTerminalSequences(text).replaceAll("\r", "");
      const selected = () => matches[index];
      const finish = (value: CatalogEntry[] | undefined) => {
        if (!closed) {
          closed = true;
          done(value);
        }
      };
      const search = () => {
        const found = new Set(
          fuzzyFilter(
            skills,
            input.getValue(),
            (skill) =>
              `${skill.name} ${skill.description} ${basename(skill.baseDir)} ${skill.label} ${skill.category ?? ""}`,
          ),
        );
        // Search membership changes, never section/display order or checked identity.
        matches = skills.filter((skill) => found.has(skill));
        index = 0;
        detailOffset = 0;
      };
      const keys = (action: Parameters<typeof keybindings.getKeys>[0]) =>
        keybindings.getKeys(action).join("/") || "unbound";
      const status = (skill: CatalogEntry) =>
        skill.reason ? `Unavailable: ${skill.reason}` : "Eligible";
      const row = (skill: CatalogEntry, active: boolean) =>
        theme.fg(
          skill.reason ? "dim" : active ? "accent" : "text",
          `${active ? ">" : " "} ${skill.reason ? "[-]" : checked.has(skill.identity) ? "[x]" : "[ ]"} ${clean(skill.name)} · ${clean(skill.label)}${skill.category ? ` · ${clean(skill.category)}` : ""}${skill.reason ? " · unavailable" : ""}`,
        );
      search();
      return {
        get focused() {
          return input.focused;
        },
        set focused(value: boolean) {
          input.focused = value;
        },
        render(width) {
          if (width < 1) return [];
          const height = Math.max(1, Math.min(24, tui.terminal.rows - 5));
          const hidden = [...checked].filter(
            (identity) => !matches.some((skill) => skill.identity === identity),
          ).length;
          const title = `Load skill · ${matches.length}/${skills.length} · ${checked.size} checked (${hidden} hidden)`;
          const help = wrapTextWithAnsi(
            `${keys("tui.select.up")}/${keys("tui.select.down")} navigate · Tab toggle · Space search · ${keys("tui.select.confirm")} load checked · ${keys("tui.select.cancel")} cancel`,
            width,
          );
          const skill = selected();
          if (height < 10)
            return [
              ...input.render(Math.max(4, width)),
              title,
              skill ? row(skill, true) : "No matches",
              skill ? clean(status(skill)) : "Keep typing or cancel",
              ...help,
            ]
              .slice(0, height)
              .map((line) => truncateToWidth(line, width));
          const helpLines = help.slice(0, Math.min(3, height - 6));
          const available = height - 3 - helpLines.length;
          // Reserve two heading slots so mixed-section views stay bounded.
          const count = Math.max(1, Math.min(6, Math.floor(available / 2) - 1));
          const start = Math.max(
            0,
            Math.min(index - Math.floor(count / 2), matches.length - count),
          );
          const rows: string[] = [];
          let group: CatalogEntry["origin"] | undefined;
          for (const entry of matches.slice(start, start + count)) {
            if (entry.origin !== group) {
              group = entry.origin;
              rows.push(
                theme.fg(
                  "muted",
                  theme.bold(
                    group === "personal" ? "Personal skills" : "Hermes skills",
                  ),
                ),
              );
            }
            rows.push(row(entry, entry === skill));
          }
          if (!matches.length)
            rows.push(theme.fg("muted", "No matches. Keep typing or cancel."));
          const details = skill
            ? [
                status(skill),
                skill.filePath,
                skill.description,
                ...(skill.prerequisites.length
                  ? [
                      `Prerequisites (not probed): ${skill.prerequisites.join("; ")}`,
                    ]
                  : []),
              ].flatMap((text) => wrapTextWithAnsi(clean(text), width))
            : [];
          detailLineCount = details.length;
          detailPageSize = Math.max(1, available - rows.length - 1);
          detailOffset = Math.min(
            detailOffset,
            Math.max(0, detailLineCount - detailPageSize),
          );
          const detailView = details
            .slice(detailOffset, detailOffset + detailPageSize)
            .map((line) => theme.fg("muted", line));
          if (detailLineCount > detailPageSize)
            detailView.push(
              theme.fg(
                "dim",
                `${keys("tui.select.pageUp")}/${keys("tui.select.pageDown")} details ${detailOffset + 1}–${Math.min(detailOffset + detailPageSize, detailLineCount)}/${detailLineCount}`,
              ),
            );
          return [
            theme.fg("accent", theme.bold(title)),
            ...input.render(Math.max(4, width)),
            ...rows,
            "",
            ...detailView,
            ...helpLines.map((line) => theme.fg("dim", line)),
          ]
            .slice(0, height)
            .map((line) => truncateToWidth(line, width));
        },
        handleInput(data) {
          if (closed) return;
          if (keybindings.matches(data, "tui.select.cancel")) {
            finish(undefined);
            return;
          }
          if (matchesKey(data, Key.tab)) {
            const skill = selected();
            if (skill && !skill.reason) {
              if (checked.has(skill.identity)) checked.delete(skill.identity);
              else checked.add(skill.identity);
            } else if (skill) detailOffset = 0;
          } else if (keybindings.matches(data, "tui.select.confirm")) {
            if (checked.size)
              finish(skills.filter((skill) => checked.has(skill.identity)));
            return;
          } else if (
            keybindings.matches(data, "tui.select.up") ||
            keybindings.matches(data, "tui.select.down")
          ) {
            if (matches.length)
              index =
                (index +
                  (keybindings.matches(data, "tui.select.up") ? -1 : 1) +
                  matches.length) %
                matches.length;
            detailOffset = 0;
          } else if (keybindings.matches(data, "tui.select.pageUp"))
            detailOffset = Math.max(0, detailOffset - detailPageSize);
          else if (keybindings.matches(data, "tui.select.pageDown"))
            detailOffset = Math.min(
              Math.max(0, detailLineCount - detailPageSize),
              detailOffset + detailPageSize,
            );
          else {
            const previous = input.getValue();
            input.handleInput(data);
            if (input.getValue() !== previous) search();
          }
          tui.requestRender();
        },
        invalidate() {
          input.invalidate();
        },
      };
    },
  );
}
