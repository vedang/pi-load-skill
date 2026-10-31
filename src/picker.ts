import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { Input, SelectList, truncateToWidth } from "@earendil-works/pi-tui";

export function showSkillPicker(ctx: ExtensionContext, skills: Skill[], query: string): Promise<Skill | undefined> {
  return ctx.ui.custom<Skill | undefined>((tui, theme, keybindings, done) => {
    const input = new Input();
    input.setValue(query);
    const createList = () => new SelectList(skills.filter((skill) => `${skill.name} ${skill.description} ${skill.filePath}`.toLowerCase().includes(input.getValue().toLowerCase())).map((skill) => ({ value: skill.filePath, label: skill.name, description: skill.description })), 6, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    let list = createList();
    return {
      get focused() { return input.focused; },
      set focused(value: boolean) { input.focused = value; },
      render(width) {
        const selected = skills.find((skill) => skill.filePath === list.getSelectedItem()?.value);
        return [theme.fg("accent", "Load skill"), ...input.render(Math.max(1, width)), ...list.render(Math.max(4, width)), selected?.filePath ?? "No matches. Edit the search or Escape to cancel.", theme.fg("dim", "↑/↓ navigate · Enter load · Escape cancel")].map((line) => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (keybindings.matches(data, "tui.select.cancel")) { done(undefined); return; }
        if (keybindings.matches(data, "tui.select.confirm")) {
          const selected = skills.find((skill) => skill.filePath === list.getSelectedItem()?.value);
          if (selected) done(selected);
          return;
        }
        if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
          list.handleInput(data);
        } else {
          input.handleInput(data);
          list = createList();
        }
        tui.requestRender();
      },
      invalidate() { input.invalidate(); list.invalidate(); },
    };
  });
}
