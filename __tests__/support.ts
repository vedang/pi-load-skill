import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  KeybindingsManager as AppKeybindingsManager,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  MessageRenderer,
  RegisteredCommand,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  KeybindingsManager,
  type TUI,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { vi } from "vitest";
import extension from "../src/index.js";

const plainTheme = {
  fg: (_color: string, value: string) => value,
  bold: (value: string) => value,
} as unknown as Theme;

export function createHarness() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-load-skill-command-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  let handler: RegisteredCommand["handler"] | undefined;
  let renderer: MessageRenderer | undefined;
  let component: (Component & Partial<Focusable>) | undefined;
  const terminal = { rows: 30, columns: 80 };
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const sendMessage = vi.fn();
  const sendUserMessage = vi.fn();
  const notify = vi.fn();
  const setEditorText = vi.fn();
  const requestRender = vi.fn();
  const ui = {
    notify,
    setEditorText,
    getEditorText: () => "Draft that must not be replaced",
    custom: vi.fn(
      <T>(factory: Parameters<ExtensionUIContext["custom"]>[0]) =>
        new Promise<T>((resolve, reject) => {
          Promise.resolve(
            factory(
              { terminal, requestRender } as unknown as TUI,
              plainTheme,
              keybindings as unknown as AppKeybindingsManager,
              resolve as (value: unknown) => void,
            ),
          )
            .then((value) => {
              component = value;
              if ("focused" in value) value.focused = true;
            })
            .catch(reject);
        }),
    ),
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui,
    isIdle: vi.fn(() => true),
  } as unknown as ExtensionCommandContext;
  const registerCommand = vi.fn(
    (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
      if (name === "load-skill") handler = command.handler;
    },
  );
  const registerMessageRenderer = vi.fn(
    (_type: string, value: MessageRenderer) => {
      renderer = value;
    },
  );
  // Missing methods deliberately throw: the extension must not grow startup
  // hooks, tools, resource registration, or an event-bus loading API.
  const api = new Proxy(
    { registerCommand, registerMessageRenderer, sendMessage, sendUserMessage },
    {
      get(target, property) {
        if (!(property in target))
          throw new Error(
            `Unexpected extension API access: ${String(property)}`,
          );
        return Reflect.get(target, property);
      },
    },
  );
  extension(api as unknown as ExtensionAPI);

  function writeSkill(
    directory: string,
    name: string,
    body = `Instructions for ${name}.`,
    description = `Description for ${name}.`,
  ) {
    const dir = join(agentDir, "catalog", directory);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(
      path,
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body}`,
    );
    return path;
  }
  const mountedComponent = () => component;
  return {
    agentDir,
    ctx,
    ui,
    keybindings,
    terminal,
    sendMessage,
    sendUserMessage,
    notify,
    setEditorText,
    registerCommand,
    registerMessageRenderer,
    writeSkill,
    configure(value: unknown = { specific_skills: ["catalog"] }) {
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
    },
    run(query = "") {
      if (!handler) throw new Error("Command not registered");
      return handler(query, ctx);
    },
    async open(query = "") {
      component = undefined;
      const completion = this.run(query);
      await vi.waitFor(() => {
        if (!component) throw new Error("Picker not opened");
      });
      const mounted = mountedComponent();
      if (!mounted) throw new Error("Picker not opened");
      return { component: mounted, completion };
    },
    renderMessage() {
      if (!renderer) throw new Error("Renderer not registered");
      return renderer(
        { ...sendMessage.mock.calls[0][0], role: "custom", timestamp: 0 },
        { expanded: false, outputPad: 0 },
        plainTheme,
      )
        ?.render(80)
        .join("\n");
    },
    dispose() {
      rmSync(agentDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    },
  };
}
