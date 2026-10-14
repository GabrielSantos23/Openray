import { ReactUiError } from './errors';

/**
 * Handlers registered against action ids. Regular actions ignore the payload;
 * a form's submit handler receives the shell-collected field values.
 */
export type ActionHandler = (payload?: unknown) => void | Promise<void>;

export type FormSubmitHandler = (values: Record<string, unknown>) => void | Promise<void>;

export class ActionRegistry {
  private handlers = new Map<string, ActionHandler>();
  private seq = 0;

  register(handler: ActionHandler): string {
    const id = `fka${this.seq++}`;
    this.handlers.set(id, handler);
    return id;
  }

  registerExplicit(id: string, handler: ActionHandler): void {
    if (this.handlers.has(id)) {
      throw new ReactUiError(`duplicate action id '${id}' in tree`);
    }
    this.handlers.set(id, handler);
  }

  resolve(id: string): ActionHandler | undefined {
    return this.handlers.get(id);
  }
}
