// Extension commands in the registry: `extensions.list/reload/run` plus one
// `ext.<extension>.<command>` command per installed FlowKey extension command, with metadata
// derived from the extension manifest (AGENTS.md §9). Reloading re-scans the extensions root
// and emits `registry.changed`.

"use strict";

const RUN_TIMEOUT_MS = 30_000;

function withTimeout(promise, ms, id) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`extension command ${id} timed out after ${ms}ms`);
        error.code = "timeout";
        error.hint = "the extension sidecar may be hung; retry or reload the extension";
        reject(error);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createExtensionCommands({ registry, backend }) {
  function extPrefixFor(extension) {
    const name = String(extension.id ?? extension.uuid ?? "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    return `ext.${name}.`;
  }

  async function registerInstalled() {
    const extensions = await backend.allExtensions();
    const registered = [];
    for (const extension of extensions) {
      const prefix = extPrefixFor(extension);
      registry.unregister(prefix);
      for (const command of extension.commands ?? []) {
        if (!command.name || command.disabledReason) continue;
        registered.push({
          id: `${prefix}${command.name}`,
          title: command.title ?? `${extension.title} ${command.name}`,
          description:
            command.description ||
            `Runs the "${command.name}" command of the "${extension.title}" extension.`,
          risk: "write",
          domain: "ext",
          params: { type: "object" },
          run: (params) =>
            withTimeout(
              backend.dispatchMessage("backend", "extensionHost.loadCommand", {
                extension: { uuid: extension.uuid },
                command: { name: command.name },
                preferences: {},
                props: { ...(params ?? {}), launchType: "userInitiated" },
              }),
              RUN_TIMEOUT_MS,
              `${prefix}${command.name}`,
            ),
        });
      }
    }
    registry.register(registered);
    return { extensions: extensions.length, commands: registered.length };
  }

  registry.register([
    {
      id: "extensions.list",
      title: "extensions list",
      description: "List installed extensions with their commands (title, description, mode).",
      risk: "read",
      domain: "extensions",
      params: { type: "object" },
      run: async () => ({ extensions: await backend.allExtensions() }),
    },
    {
      id: "extensions.reload",
      title: "extensions reload",
      description:
        "Rescan the extensions root and refresh the registry's ext.* commands. Call after installing or editing an extension.",
      risk: "write",
      domain: "extensions",
      params: { type: "object" },
      run: async () => {
        const summary = await registerInstalled();
        registry.emit("registry.changed", { reloaded: true, ...summary });
        return summary;
      },
    },
    {
      id: "extensions.run",
      title: "extensions run",
      description:
        "Run an installed extension command by its ext.<extension>.<command> registry id and return the session id. View commands render into the launcher window; headless callers get a needs_ui error for them.",
      risk: "write",
      domain: "extensions",
      params: {
        type: "object",
        properties: { id: { type: "string" }, params: { type: "object" } },
        required: ["id"],
        additionalProperties: false,
      },
      run: async (args) => {
        const command = registry.get(args.id);
        if (!command || command.domain !== "ext") {
          const error = new Error(`no such extension command: ${args.id}`);
          error.code = "unknown_command";
          error.hint = "run extensions.reload, then list_commands with a filter";
          throw error;
        }
        return command.run(args.params ?? {}, { source: "extensions.run" });
      },
    },
  ]);

  return { registerInstalled };
}

module.exports = { createExtensionCommands };
