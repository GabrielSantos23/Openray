import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import type { WebCommandProps } from './bridge';
import { createWebCapabilities } from './bridge';

interface WebView2Host {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message',
    handler: (event: { data: Record<string, unknown> }) => void,
  ): void;
}

function getWebviewHost(): WebView2Host {
  const webview = (
    window as unknown as {
      chrome?: { webview?: WebView2Host };
    }
  ).chrome?.webview;
  if (!webview) {
    throw new Error('FlowKey web commands must run inside the FlowKey WebView2 host');
  }
  return webview;
}

/**
 * Mounts a web command component into the shell's WebView2 host page. The
 * extension's web entry calls this once with its root component; props,
 * capability results, theme tokens and dispose flow through the host page's
 * message pump (`flowkey-message` DOM events).
 */
export function mountWebCommand(
  component: ComponentType<WebCommandProps>,
  options?: { root?: HTMLElement },
): void {
  const container = options?.root ?? document.getElementById('root');
  if (!container) {
    throw new Error('FlowKey web command mount point missing (#root)');
  }
  const webview = getWebviewHost();

  const capabilities = createWebCapabilities({
    post: (message) => {
      if (message.type === 'webCall' || message.type === 'webAbort') {
        // attribute the call to the mounted extension; the host validates it
        message.extensionId = window.__FLOWKEY_EXTENSION_ID__ ?? '';
      }
      webview.postMessage(message);
    },
    addResultHandler: (handler) => {
      webview.addEventListener('message', (event) => {
        const message = event.data;
        if (message && typeof message === 'object' && message.type === 'result') {
          handler(message as unknown as Parameters<typeof handler>[0]);
        }
      });
    },
  });

  let root: Root | null = null;
  let currentProps: WebCommandProps | null = null;
  const render = (): void => {
    if (!currentProps) return;
    root ??= createRoot(container);
    root.render(createElement(component, currentProps));
  };

  webview.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'props':
        currentProps = {
          query: (message.query as string) ?? '',
          filterValue: (message.filterValue as string | undefined) ?? undefined,
          arguments: (message.arguments as Record<string, string> | undefined) ?? undefined,
          preferences: (message.preferences as Record<string, unknown>) ?? {},
          environment: message.environment as WebCommandProps['environment'],
          capabilities,
          theme: (message.theme as Record<string, string>) ?? {},
        };
        render();
        break;
      case 'dispose':
        root?.unmount();
        root = null;
        currentProps = null;
        break;
    }
  });

  webview.postMessage({ type: 'ready' });
}

declare global {
  // eslint-disable-next-line no-var
  var __FLOWKEY_EXTENSION_ID__: string | undefined;
}

export { createWebCapabilities } from './bridge';
export type { WebCommandProps, WebHostLink } from './bridge';
