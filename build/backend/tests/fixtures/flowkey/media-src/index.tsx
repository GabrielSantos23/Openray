// Fixture extension for flowkey-media.test.mjs: exercises the `media.current` / `media.control`
// nativeCall routes end to end (manifest consent, native hop to the C# host, typed error paths).
import { useState } from "react";
import { Action, ActionPanel, List, defineReactExtension, type CommandProps } from "@flowkey-mini/react-ui";

export default defineReactExtension({
  manifest: { id: "media-probe", name: "media-probe", version: "1.0.0", commands: [] },
  component: (props: CommandProps) => {
    const [snapshot, setSnapshot] = useState("(no snapshot)");
    const [control, setControl] = useState("(no control run)");

    return (
      <List>
        <List.Item
          id="snapshot"
          title="Snapshot"
          subtitle={snapshot}
          actions={
            <ActionPanel>
              <Action
                title="Read media.current"
                onAction={async () => {
                  const state = await props.native.call("media.current");
                  setSnapshot(JSON.stringify(state));
                }}
              />
              <Action
                title="Send next"
                onAction={async () => {
                  await props.native.call("media.control", { command: "next" });
                  setControl("next sent");
                }}
              />
              <Action
                title="Unknown command"
                onAction={async () => {
                  try {
                    await props.native.call("media.control", { command: "rewind" });
                    setControl("(unexpected success)");
                  } catch (caught) {
                    setControl(`typed: ${caught instanceof Error ? caught.message : String(caught)}`);
                  }
                }}
              />
              <Action
                title="Undeclared media"
                onAction={async () => {
                  try {
                    await props.native.call("media.seek", { positionMs: 1 });
                    setControl("(unexpected success)");
                  } catch (caught) {
                    setControl(`typed: ${caught instanceof Error ? caught.message : String(caught)}`);
                  }
                }}
              />
            </ActionPanel>
          }
        />
        <List.Item id="control" title="Control" subtitle={control} />
      </List>
    );
  },
});
