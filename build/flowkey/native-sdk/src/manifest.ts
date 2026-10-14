import type { ExtensionManifest, ManifestCommand, PreferenceSchema } from './types';

export interface ManifestIssue {
  /** Dotted path to the offending field, e.g. `commands[0].id`. */
  field: string;
  /** Stable machine-readable code shared with the C# validator. */
  code: string;
  message: string;
}

export interface ManifestValidationResult {
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
}

/** Extension ids become directory names, so they are strict slugs. */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** Entry is a single bundled .js filename relative to the package root. */
const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const OAUTH_PROVIDER_PATTERN = /^[a-z0-9-]+$/;
const PREFERENCE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const HTTP_HOST_PATTERN =
  /^(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::\d{1,5})?$/;

export const DEFAULT_ENTRY = 'main.js';
export const MIN_COMMAND_INTERVAL_SECONDS = 60;
export const MAX_COMMAND_ARGUMENTS = 8;
export const RESERVED_COMMAND_IDS: readonly string[] = ['__open__'];
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_COMMAND_TITLE_LENGTH = 80;
const MAX_HTTP_HOSTS = 64;
const MAX_COMMANDS = 128;
const MAX_NATIVE_METHODS = 128;
const MAX_PREFERENCES = 32;

/** Icon values ending in an image extension are asset paths shipped with the extension package. */
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp|ico|bmp)$/i;

export function isImageFileName(value: string): boolean {
  return IMAGE_FILE_PATTERN.test(value);
}

/**
 * Icon values are either an emoji/lucide name (any non-empty string) or a
 * relative image path inside the extension package — which must stay inside it.
 */
export function isValidIconValue(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (!isImageFileName(value)) {
    return true;
  }
  return (
    !value.includes('\\') && !value.includes('..') && !value.startsWith('/') && !value.includes(':')
  );
}

const MAX_FS_PATHS = 16;
const FS_SCOPE_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^*?\n]|\*\*?|\?)*(?:\*.*)?$/;

/**
 * Filesystem scopes are absolute path globs — or a glob that STARTS with a
 * `{{name}}` preference placeholder (the placeholder supplies the root, e.g.
 * a user-configured vault path). No traversal, no newlines.
 */
export function isValidFsScope(value: string): boolean {
  if (value.length === 0 || value.length > 512) {
    return false;
  }
  if (value.startsWith('{{')) {
    const closing = value.indexOf('}}');
    if (closing < 0 || !/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/.test(value)) {
      return false;
    }
    const rest = value.slice(closing + 2);
    return !rest.includes('..') && !rest.includes('\n') && !rest.includes('\\');
  }
  const withoutPlaceholders = value.replace(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g, 'x');
  if (withoutPlaceholders.includes('..') || withoutPlaceholders.includes('\n')) {
    return false;
  }
  return FS_SCOPE_PATTERN.test(withoutPlaceholders);
}

export function resolveEntry(manifest: ExtensionManifest): string {
  return manifest.entry ?? DEFAULT_ENTRY;
}

function isValidNativeMethod(value: string): boolean {
  const segments = value.split('.');
  if (segments.length < 2) return false;
  const last = segments[segments.length - 1];
  const leading = segments.slice(0, -1);
  const leadingOk = leading.every((s) => /^[a-z][a-zA-Z0-9]*$/.test(s));
  const lastOk = last === '*' || /^[a-zA-Z0-9]+$/.test(last);
  return leadingOk && lastOk;
}

/**
 * Structural manifest validation shared by the sidecar loader, the CLI and
 * (mirrored in C#) the shell's package installer. The `contract/manifest.fixture.json`
 * fixture pins both implementations to identical accept/reject behavior.
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: ManifestIssue[] = [];
  const warnings: ManifestIssue[] = [];
  const error = (field: string, code: string, message: string) =>
    errors.push({ field, code, message });
  const warn = (field: string, code: string, message: string) =>
    warnings.push({ field, code, message });

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return {
      errors: [{ field: '', code: 'notAnObject', message: 'manifest must be a JSON object' }],
      warnings,
    };
  }
  const m = manifest as Record<string, unknown>;

  // id
  if (typeof m.id !== 'string' || m.id.length === 0) {
    error('id', 'required', 'id is required');
  } else if (m.id.includes('..')) {
    error('id', 'pathUnsafe', 'id must not contain ".."');
  } else if (m.id.length > MAX_ID_LENGTH) {
    error('id', 'tooLong', `id must be at most ${MAX_ID_LENGTH} characters`);
  } else if (!ID_PATTERN.test(m.id)) {
    error('id', 'format', 'id must match ^[a-z0-9][a-z0-9._-]*$ (lowercase slug)');
  }

  // name
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
    error('name', 'required', 'name is required');
  } else {
    const trimmed = m.name.trim();
    if (trimmed.length < 2 || trimmed.length > MAX_NAME_LENGTH) {
      error('name', 'length', `name must be between 2 and ${MAX_NAME_LENGTH} characters`);
    }
  }

  // version
  if (typeof m.version !== 'string' || m.version.length === 0) {
    error('version', 'required', 'version is required');
  } else if (!VERSION_PATTERN.test(m.version)) {
    error(
      'version',
      'format',
      'version must be semver (major.minor.patch with optional pre-release/build)',
    );
  }

  // description
  if (m.description === undefined) {
    warn('description', 'missing', 'description is recommended');
  } else if (typeof m.description !== 'string') {
    error('description', 'format', 'description must be a string');
  } else if (m.description.length > MAX_DESCRIPTION_LENGTH) {
    error(
      'description',
      'tooLong',
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }

  // icon — emoji, lucide name, or an image path shipped with the package
  if (m.icon !== undefined) {
    if (typeof m.icon !== 'string' || !isValidIconValue(m.icon)) {
      error(
        'icon',
        'format',
        "icon must be a non-empty emoji/lucide name or a safe image path (e.g. 'command-icon.png', no '..' or absolute paths)",
      );
    }
  } else {
    warn('icon', 'missing', 'icon is recommended');
  }

  // entry
  if (m.entry !== undefined) {
    if (typeof m.entry !== 'string' || m.entry.length === 0) {
      error('entry', 'format', 'entry must be a non-empty string');
    } else if (m.entry.includes('/') || m.entry.includes('\\') || m.entry.includes('..')) {
      error('entry', 'pathUnsafe', 'entry must be a single filename, not a path');
    } else if (!ENTRY_PATTERN.test(m.entry)) {
      error('entry', 'format', 'entry must be a bundled .js filename (e.g. main.js)');
    }
  }

  // commands
  if (!Array.isArray(m.commands) || m.commands.length === 0) {
    error('commands', 'required', 'at least one command is required');
  } else {
    if (m.commands.length > MAX_COMMANDS) {
      error('commands', 'tooMany', `at most ${MAX_COMMANDS} commands are allowed`);
    }
    const seen = new Set<string>();
    m.commands.forEach((c: unknown, i: number) => {
      const field = `commands[${i}]`;
      if (typeof c !== 'object' || c === null) {
        error(field, 'format', 'command must be an object');
        return;
      }
      const command = c as Record<string, unknown>;
      if (typeof command.id !== 'string' || command.id.length === 0) {
        error(`${field}.id`, 'required', 'command id is required');
      } else if (RESERVED_COMMAND_IDS.includes(command.id)) {
        error(`${field}.id`, 'reserved', `command id '${command.id}' is reserved by the shell`);
      } else if (!COMMAND_ID_PATTERN.test(command.id)) {
        error(
          `${field}.id`,
          'format',
          `command id '${command.id}' must match ^[a-z0-9][a-z0-9._-]*$`,
        );
      } else if (seen.has(command.id)) {
        error(`${field}.id`, 'duplicate', `duplicate command id '${command.id}'`);
      } else {
        seen.add(command.id);
      }
      if (typeof command.title !== 'string' || command.title.trim().length === 0) {
        error(`${field}.title`, 'required', 'command title is required');
      } else if (command.title.length > MAX_COMMAND_TITLE_LENGTH) {
        error(
          `${field}.title`,
          'tooLong',
          `command title must be at most ${MAX_COMMAND_TITLE_LENGTH} characters`,
        );
      }
      if (command.mode !== undefined && command.mode !== 'view' && command.mode !== 'background') {
        error(`${field}.mode`, 'format', "command mode must be 'view' or 'background'");
      }
      if (command.keywords !== undefined) {
        if (
          !Array.isArray(command.keywords) ||
          command.keywords.some((k) => typeof k !== 'string')
        ) {
          error(`${field}.keywords`, 'format', 'keywords must be an array of strings');
        }
      }
      if (command.subtitle !== undefined) {
        if (typeof command.subtitle !== 'string') {
          error(`${field}.subtitle`, 'format', 'command subtitle must be a string');
        } else if (command.subtitle.length > MAX_COMMAND_TITLE_LENGTH) {
          error(
            `${field}.subtitle`,
            'tooLong',
            `command subtitle must be at most ${MAX_COMMAND_TITLE_LENGTH} characters`,
          );
        }
      }
      if (
        command.disabledByDefault !== undefined &&
        typeof command.disabledByDefault !== 'boolean'
      ) {
        error(
          `${field}.disabledByDefault`,
          'format',
          'command disabledByDefault must be a boolean',
        );
      }
      if (command.ui !== undefined) {
        if (command.ui !== 'web' && command.ui !== 'tree') {
          error(`${field}.ui`, 'format', "command ui must be 'tree' or 'web'");
        } else if (command.ui === 'web' && command.mode !== 'view') {
          error(`${field}.ui`, 'format', "command ui 'web' requires mode 'view'");
        }
      }
      if (command.webEntry !== undefined) {
        if (typeof command.webEntry !== 'string' || !ENTRY_PATTERN.test(command.webEntry)) {
          error(
            `${field}.webEntry`,
            'format',
            'command webEntry must be a bundled .js filename (e.g. main.web.js)',
          );
        } else if (command.ui !== undefined && command.ui !== 'web') {
          error(`${field}.webEntry`, 'format', "command webEntry requires ui 'web'");
        }
      }
      if (command.interval !== undefined) {
        if (typeof command.interval !== 'number' || !Number.isInteger(command.interval)) {
          error(
            `${field}.interval`,
            'format',
            'command interval must be an integer number of seconds',
          );
        } else if (command.interval < MIN_COMMAND_INTERVAL_SECONDS) {
          error(
            `${field}.interval`,
            'format',
            `command interval must be at least ${MIN_COMMAND_INTERVAL_SECONDS} seconds`,
          );
        } else if (command.mode !== 'background') {
          error(`${field}.interval`, 'format', 'command interval requires mode background');
        }
      }
      if (command.arguments !== undefined) {
        if (!Array.isArray(command.arguments)) {
          error(`${field}.arguments`, 'format', 'command arguments must be an array');
        } else {
          if (command.arguments.length > MAX_COMMAND_ARGUMENTS) {
            error(
              `${field}.arguments`,
              'tooMany',
              `at most ${MAX_COMMAND_ARGUMENTS} command arguments are allowed`,
            );
          }
          const seenArgumentNames = new Set<string>();
          command.arguments.forEach((argument: unknown, argumentIndex: number) => {
            const argumentField = `${field}.arguments[${argumentIndex}]`;
            if (typeof argument !== 'object' || argument === null) {
              error(argumentField, 'format', 'command argument must be an object');
              return;
            }
            const arg = argument as Record<string, unknown>;
            if (typeof arg.name !== 'string' || !PREFERENCE_NAME_PATTERN.test(arg.name)) {
              error(
                `${argumentField}.name`,
                'format',
                'argument name must match ^[a-zA-Z_][a-zA-Z0-9_]*$',
              );
            } else if (seenArgumentNames.has(arg.name)) {
              error(`${argumentField}.name`, 'duplicate', `duplicate argument name '${arg.name}'`);
            } else {
              seenArgumentNames.add(arg.name);
            }
            if (arg.type !== 'text' && arg.type !== 'password' && arg.type !== 'dropdown') {
              error(
                `${argumentField}.type`,
                'format',
                "argument type must be 'text' | 'password' | 'dropdown'",
              );
            } else if (arg.type === 'dropdown') {
              const dataOk =
                Array.isArray(arg.data) &&
                arg.data.length > 0 &&
                arg.data.some(
                  (o) =>
                    typeof o === 'object' &&
                    o !== null &&
                    typeof (o as Record<string, unknown>).value === 'string' &&
                    typeof (o as Record<string, unknown>).title === 'string',
                );
              if (!dataOk) {
                error(
                  `${argumentField}.data`,
                  'required',
                  'dropdown argument requires data with value and title',
                );
              }
            }
            if (typeof arg.placeholder !== 'string' || arg.placeholder.trim().length === 0) {
              error(`${argumentField}.placeholder`, 'required', 'argument placeholder is required');
            }
            if (arg.required !== undefined && typeof arg.required !== 'boolean') {
              error(`${argumentField}.required`, 'format', 'argument required must be a boolean');
            }
          });
        }
      }
    });
  }

  // nativeMethods
  if (!Array.isArray(m.nativeMethods)) {
    error('nativeMethods', 'required', 'nativeMethods is required (use [] to declare none)');
  } else {
    if (m.nativeMethods.length > MAX_NATIVE_METHODS) {
      error('nativeMethods', 'tooMany', `at most ${MAX_NATIVE_METHODS} native methods are allowed`);
    }
    m.nativeMethods.forEach((method: unknown, i: number) => {
      if (typeof method !== 'string' || !isValidNativeMethod(method)) {
        error(
          `nativeMethods[${i}]`,
          'format',
          `native method '${String(method)}' must look like 'namespace.method' with an optional trailing '.*' wildcard`,
        );
      }
    });
  }

  // httpHosts
  if (!Array.isArray(m.httpHosts)) {
    error('httpHosts', 'required', 'httpHosts is required (use [] to declare none)');
  } else {
    if (m.httpHosts.length > MAX_HTTP_HOSTS) {
      error('httpHosts', 'tooMany', `at most ${MAX_HTTP_HOSTS} http hosts are allowed`);
    }
    m.httpHosts.forEach((host: unknown, i: number) => {
      if (typeof host !== 'string' || !HTTP_HOST_PATTERN.test(host)) {
        error(
          `httpHosts[${i}]`,
          'format',
          `http host '${String(host)}' must be a hostname (e.g. api.example.com), a '.suffix' wildcard, with an optional :port`,
        );
      }
    });
  }

  // oauth
  if (m.oauth !== undefined) {
    if (!Array.isArray(m.oauth)) {
      error('oauth', 'format', 'oauth must be an array of provider ids');
    } else {
      m.oauth.forEach((provider: unknown, i: number) => {
        if (typeof provider !== 'string' || !OAUTH_PROVIDER_PATTERN.test(provider)) {
          error(`oauth[${i}]`, 'format', "oauth provider must be a lowercase id like 'spotify'");
        }
      });
    }
  }

  // fsPaths — absolute path globs granting filesystem access; {{name}}
  // interpolates a preference value at call time.
  if (m.fsPaths !== undefined) {
    if (!Array.isArray(m.fsPaths)) {
      error('fsPaths', 'format', 'fsPaths must be an array of absolute path globs');
    } else {
      if (m.fsPaths.length > MAX_FS_PATHS) {
        error('fsPaths', 'tooMany', `at most ${MAX_FS_PATHS} fs scopes are allowed`);
      }
      m.fsPaths.forEach((scope: unknown, i: number) => {
        if (typeof scope !== 'string' || !isValidFsScope(scope)) {
          error(
            `fsPaths[${i}]`,
            'format',
            `fs scope '${String(scope)}' must be an absolute path glob (e.g. 'C:\vault\**\*.md' or '{{vaultPath}}/**/*.md') without traversal`,
          );
        }
      });
    }
  }

  // uriSchemes — additional schemes shell.openUrl may open
  if (m.uriSchemes !== undefined) {
    if (!Array.isArray(m.uriSchemes)) {
      error('uriSchemes', 'format', 'uriSchemes must be an array of scheme names');
    } else {
      m.uriSchemes.forEach((scheme: unknown, i: number) => {
        if (typeof scheme !== 'string' || !OAUTH_PROVIDER_PATTERN.test(scheme)) {
          error(
            `uriSchemes[${i}]`,
            'format',
            "uri scheme must be a lowercase name like 'obsidian'",
          );
        }
      });
    }
  }

  // preferences
  if (m.preferences !== undefined) {
    if (!Array.isArray(m.preferences)) {
      error('preferences', 'format', 'preferences must be an array');
    } else {
      if (m.preferences.length > MAX_PREFERENCES) {
        error('preferences', 'tooMany', `at most ${MAX_PREFERENCES} preferences are allowed`);
      }
      const seen = new Set<string>();
      m.preferences.forEach((p: unknown, i: number) => {
        const field = `preferences[${i}]`;
        if (typeof p !== 'object' || p === null) {
          error(field, 'format', 'preference must be an object');
          return;
        }
        const preference = p as Record<string, unknown>;
        if (typeof preference.name !== 'string' || !PREFERENCE_NAME_PATTERN.test(preference.name)) {
          error(`${field}.name`, 'format', 'preference name must match ^[a-zA-Z_][a-zA-Z0-9_]*$');
        } else if (seen.has(preference.name)) {
          error(`${field}.name`, 'duplicate', `duplicate preference name '${preference.name}'`);
        } else {
          seen.add(preference.name);
        }
        const type = preference.type;
        if (
          type !== 'text' &&
          type !== 'password' &&
          type !== 'checkbox' &&
          type !== 'dropdown' &&
          type !== 'file' &&
          type !== 'directory' &&
          type !== 'appPicker'
        ) {
          error(
            `${field}.type`,
            'format',
            "preference type must be 'text' | 'password' | 'checkbox' | 'dropdown' | 'file' | 'directory' | 'appPicker'",
          );
        } else if (type === 'dropdown') {
          if (
            !Array.isArray(preference.options) ||
            preference.options.length === 0 ||
            preference.options.some(
              (o) =>
                typeof o !== 'object' ||
                o === null ||
                typeof (o as Record<string, unknown>).value !== 'string' ||
                typeof (o as Record<string, unknown>).title !== 'string',
            )
          ) {
            error(
              `${field}.options`,
              'required',
              'dropdown preference requires options with value and title',
            );
          }
        }
        if (typeof preference.title !== 'string' || preference.title.trim().length === 0) {
          error(`${field}.title`, 'required', 'preference title is required');
        }
        if (preference.default !== undefined) {
          if (type === 'checkbox' && typeof preference.default !== 'boolean') {
            error(`${field}.default`, 'format', 'checkbox preference default must be a boolean');
          }
          if (type !== 'checkbox' && typeof preference.default !== 'string') {
            error(`${field}.default`, 'format', 'preference default must be a string');
          }
        }
        if (preference.label !== undefined && typeof preference.label !== 'string') {
          error(`${field}.label`, 'format', 'checkbox preference label must be a string');
        }
        if (preference.placeholder !== undefined && typeof preference.placeholder !== 'string') {
          error(`${field}.placeholder`, 'format', 'preference placeholder must be a string');
        }
      });
    }
  }

  return { errors, warnings };
}

/** Convenience for loaders: true when the manifest is structurally valid. */
export function isManifestValid(manifest: unknown): boolean {
  return validateManifest(manifest).errors.length === 0;
}

export type { ExtensionManifest, ManifestCommand, PreferenceSchema };
