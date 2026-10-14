import { createContext } from 'react';
import { NO_CONTEXT, commitHooks, createHostNode, type HostContainer, type HostNode } from './node';

export interface HostConfigSpec {
  now: () => number;
  supportsMutation: boolean;
  supportsPersistence: boolean;
  supportsHydration: boolean;
  isPrimaryRenderer: boolean;
  warnsIfNotActing: boolean;
  noTimeout: number;
  getRootHostContext: (container: HostContainer) => Record<string, never>;
  getChildHostContext: (
    context: Record<string, never>,
    type: string,
    container: HostContainer,
  ) => Record<string, never>;
  shouldSetTextContent: (type: string, props: HostNode['props']) => boolean;
  finalizeInitialChildren: (
    instance: HostNode,
    type: string,
    props: HostNode['props'],
    container: HostContainer,
  ) => boolean;
  getPublicInstance: (instance: HostNode) => HostNode;
  createInstance: (type: string, props: HostNode['props'], container: HostContainer) => HostNode;
  createTextInstance: () => never;
  commitTextUpdate: () => never;
  appendInitialChild: (parent: HostNode, child: HostNode) => void;
  appendChild: (parent: HostNode, child: HostNode) => void;
  appendChildToContainer: (container: HostContainer, child: HostNode) => void;
  insertBefore: (parent: HostNode, child: HostNode, beforeChild: HostNode) => void;
  removeChild: (parent: HostNode, child: HostNode) => void;
  removeChildFromContainer: (container: HostContainer, child: HostNode) => void;
  clearContainer: (container: HostContainer) => void;
  commitUpdate: (
    instance: HostNode,
    type: string,
    oldProps: HostNode['props'],
    newProps: HostNode['props'],
  ) => void;
  commitMount: (instance: HostNode, type: string, props: HostNode['props']) => void;
  prepareForCommit: (container: HostContainer) => null;
  resetAfterCommit: (container: HostContainer) => void;
  preparePortalMount: () => never;
  scheduleTimeout: (fn: () => void, delay?: number) => unknown;
  cancelTimeout: (id: unknown) => void;
  getCurrentEventPriority: () => number;
  resolveUpdatePriority: () => number;
  setCurrentUpdatePriority: (priority: number) => void;
  getCurrentUpdatePriority: () => number;
  resolveEventType: () => string | null;
  resolveEventTimeStamp: () => number;
  maySuspendCommit: () => boolean;
  shouldAttemptEagerTransition: () => boolean;
  trackSchedulerEvent: () => void;
  resolveConfig: () => Record<string, unknown>;
  NotPendingTransition: null;
  HostTransitionContext: ReturnType<typeof createContext<unknown>>;
  getInstanceFromNode: () => null;
  getInstanceFromScope: () => null;
  beforeActiveInstanceBlur: () => void;
  afterActiveInstanceBlur: () => void;
  detachDeletedInstance: () => void;
  resetFormInstance: () => void;
}

export const hostConfig: HostConfigSpec = {
  now: Date.now,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: -1,

  getRootHostContext: () => NO_CONTEXT,
  getChildHostContext: () => NO_CONTEXT,
  shouldSetTextContent: () => false,
  finalizeInitialChildren: () => false,
  getPublicInstance: (instance) => instance,

  createInstance(type, props) {
    return createHostNode(type, { ...props });
  },
  createTextInstance() {
    throw new Error(
      'FlowKey UI trees do not support string children. Use props like title, subtitle or markdown instead.',
    );
  },
  commitTextUpdate() {
    throw new Error('FlowKey UI trees do not support string children.');
  },

  appendInitialChild(parent, child) {
    parent.children.push(child);
  },
  appendChild(parent, child) {
    parent.children.push(child);
  },
  appendChildToContainer(container, child) {
    container.children.push(child);
  },
  insertBefore(parent, child, beforeChild) {
    const index = parent.children.indexOf(beforeChild);
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  removeChild(parent, child) {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
  },
  removeChildFromContainer(container, child) {
    const index = container.children.indexOf(child);
    if (index >= 0) container.children.splice(index, 1);
  },
  clearContainer(container) {
    container.children.length = 0;
  },

  commitUpdate(instance, _type, _oldProps, newProps) {
    instance.props = { ...newProps };
  },
  commitMount() {},

  prepareForCommit: () => null,
  resetAfterCommit(container) {
    commitHooks.get(container)?.();
  },

  preparePortalMount() {
    throw new Error('FlowKey UI trees do not support portals.');
  },
  scheduleTimeout: setTimeout,
  cancelTimeout: (id) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),

  getCurrentEventPriority: () => 1024,
  resolveUpdatePriority: () => 1024,
  setCurrentUpdatePriority() {},
  getCurrentUpdatePriority: () => 1024,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  maySuspendCommit: () => false,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveConfig: () => ({}),
  NotPendingTransition: null,
  HostTransitionContext: createContext<unknown>(null),

  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  resetFormInstance() {},
};
