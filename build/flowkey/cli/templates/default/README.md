# **EXTENSION_NAME**

A [FlowKey](https://github.com/GabrielSantos23/flowkey-launcher) extension.

## Develop

```bash
pnpm install
pnpm dev       # build + install into FlowKey + watch for changes
```

Restart FlowKey after `pnpm dev` to load the new build.

## Share

```bash
pnpm package   # produces <id>-<version>.flowkey
```

Send the `.flowkey` file to users: in FlowKey, open **Settings → Extensions →
Install from file…** and pick the package. FlowKey shows the extension's
capabilities for consent before it runs.
