// Fixture extension for flowkey-contract.test.mjs: a minimal FlowKey React extension exercising
// the worker contract end to end (preferences flattening, storage round trip persisted on disk,
// action invocation with state updates, and the typed nativeCall error paths).
import { useEffect, useState } from "react";
import { Action, ActionPanel, List, defineReactExtension, type CommandProps } from "@flowkey-mini/react-ui";

function SubviewRoot({ props }: { props: CommandProps }) {
  return (
    <List>
      <List.Item id="subview" title="Subview" subtitle={props.commandId ?? "?"} />
    </List>
  );
}

function RootCommand({ props }: { props: CommandProps }) {
  const [storageEcho, setStorageEcho] = useState("(pending)");
  const [count, setCount] = useState(0);
  const [secretEcho, setSecretEcho] = useState("(no secret read)");
  const [oauthEcho, setOauthEcho] = useState("(no oauth status)");
  const [imageEcho, setImageEcho] = useState("(no image)");

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
          subtitle={`secret=${secretEcho} oauth=${oauthEcho} img=${imageEcho}`}
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
                title="Image data uri"
                onAction={async () => {
                  const result = await props.native.call("image.fetch", {
                    url: process.env.OPENRAY_TEST_IMAGE_URL ?? "https://i.scdn.co/none.png",
                  });
                  setImageEcho(String(result.uri));
                }}
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
        <List.Item
          id="pusher"
          title="Subview navigation"
          actions={
            <ActionPanel>
              <Action title="Push sub" push="sub:probe" onAction={() => undefined} />
              <Action title="Launch sub" onAction={() => props.window.launchCommand("sub:probe", "warm")} />
            </ActionPanel>
          }
        />
      </List>
    );
}

export default defineReactExtension({
  manifest: { id: "contract-probe", name: "contract-probe", version: "1.0.0", commands: [] },
  component: (props: CommandProps) => {
    const commandId = props.commandId ?? "open";
    // Delegate as elements, never with an early return in this component: the subview and root
    // trees have different hook counts, and a same-type early return would crash the reconciler
    // ("rendered fewer hooks") when the commandId switches. Distinct component types swap fibers.
    if (commandId.startsWith("sub:")) return <SubviewRoot props={props} />;
    return <RootCommand props={props} />;
  },
});
