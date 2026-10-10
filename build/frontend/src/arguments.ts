// Arguments system for Raycast extensions
// Handles argument definitions, validation, and UI rendering

export type ArgumentType = "text" | "dropdown" | "password";

export interface ArgumentDefinition {
  name: string;
  title: string;
  type: ArgumentType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ title: string; value: string }>;
}

export interface ArgumentValues {
  [key: string]: string;
}

export interface CommandWithArguments {
  arguments?: ArgumentDefinition[];
}

// Default arguments for extension commands
export function getCommandArguments(command: any): ArgumentDefinition[] {
  return command.arguments ?? [];
}

// Validate argument values
export function validateArguments(
  args: ArgumentDefinition[],
  values: ArgumentValues
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const arg of args) {
    const value = values[arg.name] ?? "";
    
    if (arg.required && (!value || value.trim().length === 0)) {
      errors.push(`Required argument "${arg.title}" is missing`);
    }
    
    if (arg.type === "dropdown" && arg.options && value) {
      const validOption = arg.options.some((opt) => opt.value === value);
      if (!validOption) {
        errors.push(`Invalid value for "${arg.title}": ${value}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// Get default argument values
export function getDefaultArgumentValues(args: ArgumentDefinition[]): ArgumentValues {
  const values: ArgumentValues = {};
  for (const arg of args) {
    if (arg.defaultValue !== undefined) {
      values[arg.name] = arg.defaultValue;
    }
  }
  return values;
}

// Argument history storage
const ARGUMENT_HISTORY_KEY = "raycast-mini:argument-history";

export interface ArgumentHistoryEntry {
  commandId: string;
  argumentName: string;
  value: string;
  timestamp: number;
}

export function loadArgumentHistory(): ArgumentHistoryEntry[] {
  try {
    const stored = localStorage.getItem(ARGUMENT_HISTORY_KEY);
    if (stored) {
      return JSON.parse(stored) as ArgumentHistoryEntry[];
    }
  } catch {
    // Ignore errors
  }
  return [];
}

export function saveArgumentHistory(history: ArgumentHistoryEntry[]): void {
  try {
    localStorage.setItem(ARGUMENT_HISTORY_KEY, JSON.stringify(history.slice(-100))); // Keep last 100
  } catch {
    // Ignore errors
  }
}

export function addArgumentHistory(commandId: string, argumentName: string, value: string): void {
  if (!value || value.trim().length === 0) return;
  
  const history = loadArgumentHistory();
  const entry: ArgumentHistoryEntry = {
    commandId,
    argumentName,
    value: value.trim(),
    timestamp: Date.now(),
  };
  
  // Remove duplicates
  const filtered = history.filter(
    (h) => !(h.commandId === commandId && h.argumentName === argumentName && h.value === value)
  );
  
  saveArgumentHistory([entry, ...filtered]);
}

export function getArgumentHistory(commandId: string, argumentName: string): string[] {
  const history = loadArgumentHistory();
  return history
    .filter((h) => h.commandId === commandId && h.argumentName === argumentName)
    .map((h) => h.value)
    .slice(0, 10); // Last 10 values
}

// Check if a command has arguments
export function hasArguments(command: any): boolean {
  return Array.isArray(command.arguments) && command.arguments.length > 0;
}

// Get argument suggestions (history + defaults)
export function getArgumentSuggestions(
  commandId: string,
  argumentName: string,
  args: ArgumentDefinition[]
): string[] {
  const history = getArgumentHistory(commandId, argumentName);
  const argDef = args.find((a) => a.name === argumentName);
  const defaults = argDef?.options?.map((o) => o.value) ?? [];
  
  return [...new Set([...history, ...defaults])];
}