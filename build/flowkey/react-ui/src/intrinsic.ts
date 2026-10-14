import { createElement, type Attributes, type ReactElement } from 'react';

const intrinsicTypes = new WeakMap<Function, string>();

export function intrinsic<P>(type: string): (props: P) => ReactElement {
  const fn = (props: P): ReactElement => createElement(type, props as Attributes);
  intrinsicTypes.set(fn, type);
  return fn;
}

export function resolveIntrinsic(type: unknown): string | undefined {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return intrinsicTypes.get(type);
  return undefined;
}
