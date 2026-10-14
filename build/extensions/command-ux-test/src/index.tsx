// Internal test extension for the FlowKey library. Hidden from the root search unless the
// dev-extensions flag is on; never part of a shipped build.
//
// Exercises the FlowKey surface end to end through `defineReactExtension`:
//   list (sections, accessories, keywords, empty view, filter dropdown, item detail pane)
//   detail (markdown + metadata fields)   grid (sections + columns)
//   form (textfield/password/textarea/checkbox/dropdown/datepicker/separator, onSubmit)
//   actions (clipboard, storage round trip, toast, hud, alert.confirm, shell.openUrl, http.fetch)

import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Grid,
  List,
  defineReactExtension,
  type CommandProps,
} from "@flowkey-mini/react-ui";
import manifest from "../manifest.json";

type Page =
  | { name: "list" }
  | { name: "detail" }
  | { name: "grid" }
  | { name: "form" }
  | { name: "form-done"; values: Record<string, unknown> };

const DETAIL_MARKDOWN = [
  "# Detail Rendering",
  "",
  "This page exercises **markdown** with *inline formatting*, `inline code` and a [link](https://example.com).",
  "",
  "## Metadata fields",
  "",
  "Rendered from the `Detail.Metadata.Field` children below: a label, a link, tags and a separator.",
].join("\n");

function ListPage({ props, go }: { props: CommandProps; go: (page: Page) => void }) {
  const [storageEcho, setStorageEcho] = useState<string>("(not read yet)");
  const [stars, setStars] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    props.capabilities.storage
      .set("probe", "round-trip")
      .then(() => props.capabilities.storage.get<string>("probe"))
      .then((value) => {
        if (!cancelled) setStorageEcho(value ?? "(null)");
      })
      .catch(() => {
        if (!cancelled) setStorageEcho("(storage failed)");
      });
    props.capabilities.http
      .fetchJson<{ stargazers_count: number }>("https://api.github.com/repos/facebook/react")
      .then((data) => {
        if (!cancelled) setStars(`react stars: ${data.stargazers_count}`);
      })
      .catch(() => {
        if (!cancelled) setStars("http failed");
      });
    return () => {
      cancelled = true;
    };
  }, [props.capabilities]);

  return (
    <List
      searchBarPlaceholder="Filter the test list…"
      filter={[{ label: "All", value: "all" }, { label: "Pages", value: "pages" }]}
    >
      <List.Section title="Pages (component state, not a navigation stack)">
        <List.Item
          id="page-detail"
          title="Detail page"
          subtitle="markdown + metadata fields"
          actions={
            <ActionPanel>
              <Action title="Open detail" onAction={() => go({ name: "detail" })} />
            </ActionPanel>
          }
        />
        <List.Item
          id="page-grid"
          title="Grid page"
          subtitle="sections and columns"
          actions={
            <ActionPanel>
              <Action title="Open grid" onAction={() => go({ name: "grid" })} />
            </ActionPanel>
          }
        />
        <List.Item
          id="page-form"
          title="Form page"
          subtitle="every field kind + submit values"
          actions={
            <ActionPanel>
              <Action title="Open form" onAction={() => go({ name: "form" })} />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Capabilities">
        <List.Item
          id="cap-clipboard"
          title="Write clipboard"
          subtitle={`preference: ${String(props.preferences.sampleText ?? "(unset)")}`}
          accessories={[{ text: storageEcho, color: "success" }]}
          actions={
            <ActionPanel>
              <Action
                title="Copy sample"
                onAction={() => void props.capabilities.clipboard.write(`flowkey sample ${Date.now()}`)}
              />
              <Action title="Show toast" onAction={() => void props.capabilities.toast.show({ title: "FlowKey toast", style: "success" })} />
              <Action title="Show HUD" onAction={() => void props.native.showHud({ title: "FlowKey HUD" })} />
              <Action
                title="Ask confirm"
                onAction={async () => {
                  const ok = await props.capabilities.alert.confirm({ title: "FlowKey confirm", message: "alert.confirm resolves backend-side" });
                  await props.capabilities.toast.show({ title: ok ? "Confirmed" : "Dismissed", style: ok ? "success" : "failure" });
                }}
              />
              <Action title="Open example.com" onAction={() => void props.capabilities.shell.openUrl("https://example.com")} />
            </ActionPanel>
          }
        />
        <List.Item
          id="cap-http"
          title="http.fetch (allowlisted host)"
          subtitle={stars}
          keywords={["http", "github", "fetch"]}
          accessories={[{ text: "api.github.com", color: "secondary" }]}
          actions={
            <ActionPanel>
              <Action title="Re-fetch" onAction={() => setStars("…")} />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.EmptyView title="Nothing matched" description="The shell filters items by title and keywords" />
    </List>
  );
}

function DetailPage({ go }: { props: CommandProps; go: (page: Page) => void }) {
  return (
    <Detail
      title="Detail Rendering"
      markdown={DETAIL_MARKDOWN}
      actions={
        <ActionPanel>
          <Action title="Back to list" onAction={() => go({ name: "list" })} />
        </ActionPanel>
      }
    >
      <Detail.Metadata>
        <Detail.Metadata.Field label="Kind" value="Label" />
        <Detail.Metadata.Field
          label="FlowKey repo"
          value="github.com/GabrielSantos23/flowkey-launcher"
          href="https://github.com/GabrielSantos23/flowkey-launcher"
        />
        <Detail.Metadata.Field label="Kinds" kind="tags" tags={["text", "link", "tags", "separator"]} />
        <Detail.Metadata.Field label="" kind="separator" />
        <Detail.Metadata.Field label="After separator" value="ok" />
      </Detail.Metadata>
    </Detail>
  );
}

function GridPage({ go }: { props: CommandProps; go: (page: Page) => void }) {
  return (
    <Grid columns={4} title="Grid Rendering">
      <Grid.Section title="First section">
        {["alpha", "beta", "gamma"].map((name) => (
          <Grid.Item
            key={name}
            id={name}
            title={name}
            subtitle="grid item"
            actions={
              <ActionPanel>
                <Action title="Back to list" onAction={() => go({ name: "list" })} />
              </ActionPanel>
            }
          />
        ))}
      </Grid.Section>
      <Grid.Section title="Second section">
        <Grid.Item
          id="back"
          title="back"
          actions={
            <ActionPanel>
              <Action title="Back to list" onAction={() => go({ name: "list" })} />
            </ActionPanel>
          }
        />
      </Grid.Section>
    </Grid>
  );
}

function FormPage({ go }: { props: CommandProps; go: (page: Page) => void }) {
  return (
    <Form
      title="Form Rendering"
      onSubmit={(values) => go({ name: "form-done", values })}
      actions={<ActionPanel />}
    >
      <Form.TextField id="title" label="Title" placeholder="type here" required />
      <Form.PasswordField id="secret" label="Secret" />
      <Form.TextArea id="notes" label="Notes" />
      <Form.Checkbox id="enable" label="Enable the thing" default />
      <Form.Dropdown
        id="flavor"
        label="Flavor"
        default="vanilla"
        options={[{ value: "vanilla", title: "Vanilla" }, { value: "chocolate", title: "Chocolate" }]}
      />
      <Form.DatePicker id="when" label="When" />
      <Form.Separator />
      <Form.Description label="Submit sends the values through onSubmit" />
    </Form>
  );
}

export default defineReactExtension({
  manifest,
  component: (props: CommandProps) => {
    const [page, setPage] = useState<Page>({ name: "list" });
    const go = (next: Page) => setPage(next);
    // Pages render as ELEMENTS (not function calls): each page mounts its own fiber, so the
    // per-page hook counts never collide in one component position.
    switch (page.name) {
      case "detail":
        return <DetailPage props={props} go={go} />;
      case "grid":
        return <GridPage props={props} go={go} />;
      case "form":
        return <FormPage props={props} go={go} />;
      case "form-done":
        return (
          <Detail
            title="Submitted values"
            markdown={Object.entries(page.values)
              .map(([key, value]) => `- **${key}**: \`${JSON.stringify(value)}\``)
              .join("\n")}
            actions={
              <ActionPanel>
                <Action title="Back to list" onAction={() => go({ name: "list" })} />
              </ActionPanel>
            }
          />
        );
      default:
        return <ListPage props={props} go={go} />;
    }
  },
});
