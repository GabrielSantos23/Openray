import { createElement, type ComponentType } from 'react';
import Reconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants';
import type { UiTree } from '@flowkey-mini/native-sdk';
import { hostConfig } from './hostConfig';
import { HostContext } from './hostContext';
import { commitHooks, type HostContainer } from './node';
import { ActionRegistry } from './registry';
import { serializeUiTree } from './serialize';
import type { CommandProps } from './defineReactExtension';

const reconciler = Reconciler(hostConfig);

export interface ReactRootHooks {
  onCommit: (tree: UiTree, json: string, registry: ActionRegistry) => void;
  onError: (error: unknown) => void;
}

export interface CommittedGeneration {
  tree: UiTree;
  json: string;
  registry: ActionRegistry;
}

export class ReactRoot {
  private readonly container = { children: [] } as HostContainer;
  private readonly fiberRoot: unknown;
  private inSyncUpdate = false;
  private syncError: unknown;

  private generation: CommittedGeneration | null = null;

  constructor(
    private readonly component: ComponentType<CommandProps>,
    private readonly hooks: ReactRootHooks,
  ) {
    this.fiberRoot = reconciler.createContainer(
      this.container,
      ConcurrentRoot,
      null,
      false,
      false,
      '',
      (error) => this.handleUncaught(error),
      (error) => this.handleUncaught(error),
      (error) => this.handleUncaught(error),
      () => {},
    );
    commitHooks.set(this.container, () => this.onCommitEvent());
  }

  get current(): CommittedGeneration | null {
    return this.generation;
  }

  update(props: CommandProps): CommittedGeneration | null {
    this.inSyncUpdate = true;
    this.syncError = undefined;
    try {
      reconciler.updateContainerSync(
        createElement(
          HostContext.Provider,
          {
            value: {
              native: props.native,
              capabilities: props.capabilities,
              environment: props.environment,
            },
          },
          createElement(this.component, props),
        ),
        this.fiberRoot,
        null,
        null,
      );
      reconciler.flushSyncWork();
    } finally {
      this.inSyncUpdate = false;
    }
    if (this.syncError !== undefined) {
      const error = this.syncError;
      this.syncError = undefined;
      throw error;
    }
    return this.generation;
  }

  flushEffects(): void {
    reconciler.flushPassiveEffects();
  }

  unmount(): void {
    commitHooks.delete(this.container);
    this.generation = null;
    reconciler.updateContainerSync(null, this.fiberRoot, null, null);
    reconciler.flushSyncWork();
    reconciler.flushPassiveEffects();
  }

  private handleUncaught(error: unknown): void {
    if (this.inSyncUpdate) {
      this.syncError ??= error;
      return;
    }
    this.hooks.onError(error);
  }

  private onCommitEvent(): void {
    const registry = new ActionRegistry();
    try {
      const tree = serializeUiTree(this.container, registry);
      this.generation = { tree, json: JSON.stringify(tree), registry };
      this.hooks.onCommit(tree, this.generation.json, registry);
    } catch (error) {
      if (this.inSyncUpdate) {
        this.syncError ??= error;
      } else {
        this.hooks.onError(error);
      }
    }
  }
}
