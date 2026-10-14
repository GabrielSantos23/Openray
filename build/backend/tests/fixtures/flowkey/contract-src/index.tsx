// Fixture extension for flowkey-contract.test.mjs: a minimal FlowKey React extension exercising
// the worker contract end to end (preferences flattening, storage round trip persisted on disk,
// action invocation with state updates, and the typed nativeCall error paths).
import { useEffect, useState } from "react";
import { Action, ActionPanel, List, defineReactExtension, type CommandProps } from "@flowkey-mini/react-ui";

export default defineReactExtension({
  manifest: { id: "contract-probe", name: "contract-probe", version: "1.0.0", commands: [] },
  component: (props: CommandProps) => {
    const [storageEcho, setStorageEcho] = useState("(pending)");
    const [count, setCount] = useState(0);
    const [secretEcho, setSecretEcho] = useState("(no secret read)");
    const [oauthEcho, setOauthEcho] = useState("(no oauth status)");

    useEffect(() => {
      let cancelled = false;
      (async () => {
        const existing = await props.capabilities.storage.get<{ n: number }>("probe");
        if (cancelled) return;
        setStorageEcho(existing ? JSON.stringify(existing) : "(empty)");
        if (!existing) await props.capabilities.storage.set("probe", { n: 42 });
      })().catch(() => {
        if (!cancelled) setStorageEcho("(storage failed)");
      });
      return () => {
        cancelled = true;
      };
    }, [props.capabilities]);

    return (
      <List searchBarPlaceholder="Probe…">
        <List.Item
          id="env"
          title="Environment"
          subtitle={`${props.environment.extensionName}|${props.environment.commandId}|${props.environment.commandMode}`}
        />
        <List.Item id="prefs" title="Preferences" subtitle={String(props.preferences.sampleText)} />
        <List.Item id="storage" title="Storage" subtitle={storageEcho} keywords={["persist"]} />
        <List.Item
          id="counter"
          title={`Count ${count}`}
          accessories={[{ text: `count=${count}`, color: "accent" }]}
          actions={
            <ActionPanel>
              <Action title="Increment" onAction={() => setCount((value) => value + 1)} />
              <Action title="Declared but unimplemented" onAction={() => props.native.call("system.selectedText")} />
              <Action title="Undeclared method" onAction={() => props.native.call("fs.read", { path: "C:/x" })} />
            </ActionPanel>
          }
        />
        <List.Item
          id="vault"
          title="Vault"
          subtitle={`secret=${secretEcho} oauth=${oauthEcho}`}
          actions={
            <ActionPanel>
              <Action
                title="Save secret"
                onAction={async () => {
                  await props.capabilities.secrets.set("probe-key", "probe-value");
                  const value = await props.capabilities.secrets.get<string>("probe-key");
                  setSecretEcho(value ?? "(null)");
                }}
              />
              <Action
                title="OAuth status"
                onAction={async () => {
                  const status = await props.native.call("oauth.status", { provider: "spotify" });
                  setOauthEcho(JSON.stringify(status));
                }}
              />
              <Action
                title="OAuth status undeclared"
                onAction={() => props.native.call("oauth.status", { provider: "other" })}
              />
              <Action title="Authorize headless" onAction={() => props.capabilities.oauth.authorize("spotify")} />
              <Action
                title="Image bad host"
                onAction={() => props.native.call("image.fetch", { url: "https://evil.example/x.png" })}
              />
              <Action
                title="Fetch auth undeclared"
                onAction={() =>
                  props.native.call("http.fetch", { url: "https://api.spotify.com/v1/me", auth: "other" })
                }
              />
              <Action
                title="Fetch auth not signed in"
                onAction={() =>
                  props.native.call("http.fetch", { url: "https://api.spotify.com/v1/me", auth: "spotify" })
                }
              />
            </ActionPanel>
          }
        />
      </List>
    );
  },
});
