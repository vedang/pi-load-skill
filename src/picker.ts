import { basename } from "node:path";
import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, SelectList, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function showSkillPicker(ctx: ExtensionContext, skills: Skill[], query: string): Promise<Skill | undefined> {
  return ctx.ui.custom<Skill | undefined>((tui, theme, keybindings, done) => {
    const input = new Input();
    input.setValue(query);
    const ordered = [...skills].sort((a, b) => a.name.localeCompare(b.name) || a.filePath.localeCompare(b.filePath));
    let matches: Skill[] = [];
    let list: SelectList;
    let listHeight = 6;
    let detailOffset = 0;
    let detailPageSize = 1;
    let detailLineCount = 0;
    let closed = false;
    const clean = (text: string) => stripTerminalSequences(text).replaceAll("\r", "");
    const selected = () => matches.find((skill) => skill.filePath === list.getSelectedItem()?.value);
    const finish = (skill: Skill | undefined) => {
      if (closed) return;
      closed = true;
      done(skill);
    };
    const rebuildList = (preserveSelection: boolean) => {
      const previous = preserveSelection ? list?.getSelectedItem()?.value : undefined;
      list = new SelectList(matches.map((skill) => ({
        value: skill.filePath,
        label: clean(skill.name),
        description: clean(skill.description),
      })), listHeight, {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      if (previous) list.setSelectedIndex(Math.max(0, matches.findIndex((skill) => skill.filePath === previous)));
    };
    const search = () => {
      matches = fuzzyFilter(ordered, input.getValue(), (skill) => `${skill.name} ${skill.description} ${basename(skill.baseDir)}`);
      detailOffset = 0;
      rebuildList(false);
    };
    const keys = (action: Parameters<typeof keybindings.getKeys>[0]) => keybindings.getKeys(action).join("/") || "unbound";
    search();

    return {
      get focused() { return input.focused; },
      set focused(value: boolean) { input.focused = value; },
      render(width) {
        if (width < 1) return [];
        const height = Math.max(1, Math.min(24, tui.terminal.rows - 5));
        const help = wrapTextWithAnsi(`${keys("tui.select.up")}/${keys("tui.select.down")} navigate · ${keys("tui.select.confirm")} load · ${keys("tui.select.cancel")} cancel`, width);
        // Keep input usable even on an unusually short terminal. On normal
        // terminals reserve room for details and keyboard help before the list.
        if (height < 10) {
          if (listHeight !== 1) { listHeight = 1; rebuildList(true); }
          const skill = selected();
          return [...input.render(Math.max(4, width)), skill ? clean(skill.name) : "No matches", skill ? clean(skill.filePath) : "Keep typing or cancel", ...help].slice(0, height).map((line) => truncateToWidth(line, width));
        }
        const helpLines = help.slice(0, Math.min(3, height - 5));
        const available = height - 3 - helpLines.length;
        const nextListHeight = Math.max(1, Math.min(6, Math.floor(available / 2)));
        if (nextListHeight !== listHeight) {
          listHeight = nextListHeight;
          rebuildList(true);
        }
        const skill = selected();
        const resultLines = matches.length > 0
          ? list.render(Math.max(4, width))
          : [theme.fg("muted", "No matches. Keep typing or cancel.")];
        const detailLines = skill ? [
          ...wrapTextWithAnsi(clean(skill.filePath), width),
          ...wrapTextWithAnsi(clean(skill.description), width),
        ] : [];
        detailLineCount = detailLines.length;
        // One details-help line remains available whenever the preview needs
        // paging. The whole source path and description are reachable, not cut.
        const detailBudget = Math.max(1, available - resultLines.length);
        detailPageSize = Math.max(1, detailBudget - 1);
        detailOffset = Math.min(detailOffset, Math.max(0, detailLineCount - detailPageSize));
        const detailView = detailLines.slice(detailOffset, detailOffset + detailPageSize).map((line) => theme.fg("muted", line));
        if (detailLineCount > detailPageSize) {
          detailView.push(theme.fg("dim", `${keys("tui.select.pageUp")}/${keys("tui.select.pageDown")} details ${detailOffset + 1}–${Math.min(detailOffset + detailPageSize, detailLineCount)}/${detailLineCount}`));
        }
        return [
          theme.fg("accent", theme.bold(`Load skill · ${matches.length}/${skills.length}`)),
          ...input.render(Math.max(4, width)),
          ...resultLines,
          "",
          ...detailView,
          ...helpLines.map((line) => theme.fg("dim", line)),
        ].map((line) => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (closed) return;
        if (keybindings.matches(data, "tui.select.cancel")) { finish(undefined); return; }
        if (keybindings.matches(data, "tui.select.confirm")) {
          const skill = selected();
          if (skill) finish(skill);
          return;
        }
        if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
          if (matches.length > 0) {
            const index = matches.findIndex((skill) => skill.filePath === selected()?.filePath);
            const delta = keybindings.matches(data, "tui.select.up") ? -1 : 1;
            // SelectList's input handler reads global keybindings. Use its public
            // selection API so this interaction respects the injected manager.
            list.setSelectedIndex((index + delta + matches.length) % matches.length);
            detailOffset = 0;
          }
        } else if (keybindings.matches(data, "tui.select.pageUp")) {
          detailOffset = Math.max(0, detailOffset - detailPageSize);
        } else if (keybindings.matches(data, "tui.select.pageDown")) {
          detailOffset = Math.min(Math.max(0, detailLineCount - detailPageSize), detailOffset + detailPageSize);
        } else {
          const previous = input.getValue();
          input.handleInput(data);
          if (input.getValue() !== previous) search();
        }
        tui.requestRender();
      },
      invalidate() { input.invalidate(); list.invalidate(); },
    };
  });
}
