// The command registry: every user-visible action is a command here, and the UI, the
// control channel, the CLI and the MCP server all dispatch through the same `dispatch`
// call. Docs/mcp-architecture.md carries the design.
//
// Envelope contract (AGENTS.md §3): `{ ok: true, result }` or
// `{ ok: false, error: { code, message, hint? } }`. Dispatch never throws.
//
// The schema validator is a deliberately small JSON-Schema subset (type, properties,
// required, additionalProperties, enum, items, min/max for numbers and strings, arrays)
// — enough to validate command params at the boundary without pulling a dependency.

"use strict";

const EVENTS_CAPACITY = 500;
const RISKS = ["read", "write", "destructive"];
const ERROR_CODES = [
  "unknown_command",
  "invalid_params",
  "destructive_refused",
  "needs_ui",
  "timeout",
  "internal",
];

/** The typed error handlers throw when a verb genuinely needs the renderer or the WPF host. */
function needsUi(message, hint) {
  const error = new Error(message);
  error.code = "needs_ui";
  if (hint) error.hint = hint;
  return error;
}

function createRegistry() {
  const commands = new Map();
  const subscribers = new Set();
  const events = [];

  function emit(name, data) {
    const event = { name, data, at: Date.now() };
    events.push(event);
    if (events.length > EVENTS_CAPACITY) events.splice(0, events.length - EVENTS_CAPACITY);
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        // A broken subscriber must not break dispatch; log and move on.
        console.error(`[registry] event subscriber for ${name} failed:`, error?.message ?? error);
      }
    }
  }

  function register(specs) {
    const registered = [];
    for (const spec of specs ?? []) {
      const id = String(spec?.id ?? "");
      if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_-]+)+$/.test(id)) {
        throw new Error(`registry: command id "${id}" must be dot-separated (domain.action)`);
      }
      if (!RISKS.includes(spec?.risk)) {
        throw new Error(`registry: command "${id}" must declare risk read|write|destructive`);
      }
      if (typeof spec?.run !== "function") {
        throw new Error(`registry: command "${id}" must declare a run function`);
      }
      if (commands.has(id)) {
        throw new Error(`registry: duplicate command id "${id}"`);
      }
      const command = {
        id,
        title: String(spec.title ?? id),
        description: String(spec.description ?? ""),
        params: spec.params && typeof spec.params === "object" ? spec.params : { type: "object" },
        risk: spec.risk,
        domain: spec.domain ?? id.slice(0, id.indexOf(".")),
        run: spec.run,
      };
      commands.set(id, command);
      registered.push(command);
    }
    if (registered.length > 0) emit("registry.changed", { added: registered.map((c) => c.id) });
    return registered;
  }

  function unregister(prefix) {
    const removed = [];
    for (const id of [...commands.keys()]) {
      if (id === prefix || id.startsWith(prefix)) {
        commands.delete(id);
        removed.push(id);
      }
    }
    if (removed.length > 0) emit("registry.changed", { removed });
    return removed;
  }

  function get(id) {
    return commands.get(String(id ?? "")) ?? null;
  }

  function list({ filter, domain } = {}) {
    const needle = typeof filter === "string" ? filter.toLowerCase() : null;
    const out = [];
    for (const command of commands.values()) {
      if (domain && command.domain !== domain) continue;
      if (needle) {
        const haystack = `${command.id} ${command.title} ${command.description}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      out.push({
        id: command.id,
        title: command.title,
        description: command.description,
        risk: command.risk,
        domain: command.domain,
      });
    }
    return out;
  }

  function describe(id) {
    const command = get(id);
    if (!command) return null;
    return {
      id: command.id,
      title: command.title,
      description: command.description,
      params: command.params,
      risk: command.risk,
      domain: command.domain,
    };
  }

  // ---- Validation ---------------------------------------------------------------------------

  function typeOf(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";
    return typeof value;
  }

  function validate(value, schema, path, errors) {
    const where = path || "params";
    const expected = schema.type;
    if (expected) {
      const kinds = Array.isArray(expected) ? expected : [expected];
      const actual = typeOf(value);
      const matches = kinds.some((kind) =>
        kind === "number" ? actual === "number" || actual === "integer" : kind === actual,
      );
      if (!matches) {
        errors.push(`${where} must be of type ${kinds.join("|")}, got ${actual}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.some((option) => option === value)) {
      errors.push(`${where} must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}`);
    }
    if ((expected === "string" || typeOf(value) === "string") && typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${where} must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${where} must be at most ${schema.maxLength} characters`);
      }
    }
    if ((expected === "number" || expected === "integer") && typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${where} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${where} must be <= ${schema.maximum}`);
      }
    }
    if (typeOf(value) === "object" && !Array.isArray(value)) {
      const properties = schema.properties ?? {};
      for (const [key, child] of Object.entries(properties)) {
        if (value[key] !== undefined) validate(value[key], child, `${where}.${key}`, errors);
      }
      for (const key of schema.required ?? []) {
        if (value[key] === undefined) errors.push(`${where}.${key} is required`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) errors.push(`${where}.${key} is not an accepted field`);
        }
      }
    }
    if (typeOf(value) === "array" && schema.items) {
      value.forEach((item, index) => validate(item, schema.items, `${where}[${index}]`, errors));
    }
  }

  // ---- Dispatch -----------------------------------------------------------------------------

  /** Runs a command and always resolves with the envelope; never throws. */
  async function dispatch(id, params, { allowDestructive = false, source = "registry" } = {}) {
    const command = get(id);
    if (!command) {
      return {
        ok: false,
        error: {
          code: "unknown_command",
          message: `no such command: ${id}`,
          hint: "call list_commands (optionally with a text filter) to discover ids",
        },
      };
    }
    const typedParams = params ?? {};
    if (typeOf(typedParams) !== "object" || Array.isArray(typedParams)) {
      return {
        ok: false,
        error: {
          code: "invalid_params",
          message: "params must be a JSON object",
          hint: `see describe_command ${id} for the schema`,
        },
      };
    }
    const errors = [];
    validate(typedParams, command.params, "params", errors);
    if (errors.length > 0) {
      return {
        ok: false,
        error: {
          code: "invalid_params",
          message: errors.join("; "),
          hint: `see describe_command ${id} for the schema`,
        },
      };
    }
    if (command.risk === "destructive" && !allowDestructive) {
      return {
        ok: false,
        error: {
          code: "destructive_refused",
          message: `command "${id}" is destructive and was refused`,
          hint: "repeat the call with allowDestructive: true to confirm",
        },
      };
    }
    emit("command.started", { id, source, params: typedParams });
    const startedAt = Date.now();
    try {
      const result = await command.run(typedParams, { source, allowDestructive });
      emit("command.finished", { id, source, durationMs: Date.now() - startedAt });
      return { ok: true, result: result === undefined ? null : result };
    } catch (error) {
      const envelopeError =
        error && typeof error === "object" && ERROR_CODES.includes(error.code)
          ? { code: error.code, message: String(error.message ?? "failed"), hint: error.hint }
          : {
              code: "internal",
              message: String((error && error.message) || error),
            };
      emit("command.failed", { id, source, error: envelopeError, durationMs: Date.now() - startedAt });
      return { ok: false, error: envelopeError };
    }
  }

  /** Runs a command for callers that use the throw convention (named pipe, CLI). */
  async function runOrThrow(id, params, options) {
    const envelope = await dispatch(id, params, options);
    if (!envelope.ok) {
      const error = new Error(envelope.error.message);
      error.code = envelope.error.code;
      throw error;
    }
    return envelope.result;
  }

  function subscribe(handler) {
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  function recentEvents({ since, limit = 200 } = {}) {
    const filtered = typeof since === "number" ? events.filter((event) => event.at > since) : events;
    return filtered.slice(-limit);
  }

  return { register, unregister, get, list, describe, dispatch, runOrThrow, emit, subscribe, recentEvents };
}

module.exports = { createRegistry, needsUi, RISKS };
