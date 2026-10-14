// Test-support entry for flowkey-adapter.test.mjs: bundles the vendored FlowKey library and the
// worker adapter into one CJS file so a plain `require` gets matching module instances (the same
// aliasing the worker build uses). `h` re-exports React's createElement from that same bundle.
import { createElement } from "react";
import { ActionPanel, Action, Detail, Form, Grid, List, ReactRoot } from "@flowkey-mini/react-ui";
import { uiTreeToRenderModel } from "../../../../flowkey/worker/adapter.js";

export { ReactRoot, List, Detail, Grid, Form, ActionPanel, Action, uiTreeToRenderModel };
export const h = createElement;
