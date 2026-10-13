// The typed unsupported-API error (docs/store-implementation-plan.md §4).
//
// Anything the clone does not implement — out-of-scope groups (AI, OAuth, BrowserExtension,
// WindowManagement, menu-bar commands, tools) and not-implemented calls — throws this instead of
// returning empty or fake data. The constructor reports itself to the host (`commandException`
// notify, the same channel a crashed command uses) so the renderer shows a failure toast naming
// the extension and the backend logs it. Nothing is ever silent and nothing leaves the machine.

import { notify } from "./runtime/rpc";

export class UnsupportedApiError extends Error {
  readonly call: string;
  readonly extensionName: string | null;
  readonly commandName: string | null;

  constructor(call: string, options?: { extensionName?: string | null; commandName?: string | null }) {
    const extensionName = options?.extensionName ?? process.env.EXTENSION_NAME ?? null;
    const commandName = options?.commandName ?? process.env.COMMAND_NAME ?? null;
    super(`${extensionName ?? "extension"}: ${call} is not supported`);
    this.name = "UnsupportedApiError";
    this.call = call;
    this.extensionName = extensionName;
    this.commandName = commandName;
    // Report through the host so the failure is visible, never silent.
    notify("commandException", {
      title: extensionName ?? "Extension",
      name: this.name,
      message: this.message,
    });
  }
}

/** Throw an `UnsupportedApiError` for a call that is not implemented (never returns). */
export function throwUnsupported(call: string): never {
  throw new UnsupportedApiError(call);
}
