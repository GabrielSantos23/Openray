export interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
}

export interface HostContainer {
  children: HostNode[];
}

export function createHostNode(type: string, props: Record<string, unknown>): HostNode {
  return { type, props, children: [] };
}

export const NO_CONTEXT: Record<string, never> = {};

export const commitHooks = new WeakMap<HostContainer, () => void>();
