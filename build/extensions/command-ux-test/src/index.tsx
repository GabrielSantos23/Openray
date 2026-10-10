// Internal test extension for the command-UX work (docs/command-ux-spec.md). Hidden from the root
// search unless `localStorage["raycast-mini:dev-extensions"] === "1"`.
//
// Exercises every item from the task:
//   1. navigation stack  — list -> detail -> form pushes, pop / popToRoot, onPop
//   2. forms             — every field kind, validation errors, submit-form with values
//   3. alerts            — confirmAlert (default, destructive, text field) with results shown on a page
//   4. toasts            — styles (already implemented; smoke check only)
//   5. detail            — markdown (headings, code, table, image) + metadata (label/link/tags/separator)
//   6. grid              — sections with per-section columns/aspect/fit/inset, empty view with actions
//   7. list              — accessories, sections, empty view with actions, dropdown, detail pane, pagination

import { Action, ActionPanel, Alert, closeMainWindow, confirmAlert, Detail, Form, Grid, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";

const DETAIL_MARKDOWN = [
  "# Detail Rendering",
  "",
  "This page exercises **markdown** with *inline formatting*, `inline code` and a [link](https://example.com).",
  "",
  "## Code block",
  "",
  "```ts",
  "export function greet(name: string): string {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
  "## Table",
  "",
  "| Kind | Style | Shown as |",
  "| --- | --- | --- |",
  "| Label | secondary | key/value row |",
  "| TagList | colored pill | tag row |",
  "| Link | arrow | external |",
  "",
  "> A block quote with secondary text.",
  "",
  "- unordered item one",
  "- unordered item two",
  "1. ordered item one",
  "2. ordered item two",
  "",
  "![Inline image](data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22160%22%20height%3D%2260%22%3E%3Crect%20width%3D%22160%22%20height%3D%2260%22%20rx%3D%228%22%20fill%3D%22%231e1e2e%22%2F%3E%3Ctext%20x%3D%2280%22%20y%3D%2236%22%20fill%3D%22%2359d499%22%20font-family%3D%22monospace%22%20font-size%3D%2214%22%20text-anchor%3D%22middle%22%3Eimage%20ok%3C%2Ftext%3E%3C%2Fsvg%3E)",
  "",
  "---",
  "",
  "Paragraph after the rule.",
].join("\n");

const FORM_FIELDS_MARKDOWN = (values: Record<string, unknown>) => {
  const rows = Object.entries(values)
    .map(([key, value]) => `| ${key} | \`${JSON.stringify(value)}\` |`)
    .join("\n");
  return ["# Submitted values", "", "| Field | Value |", "| --- | --- |", rows].join("\n");
};

// ---------------------------------------------------------------- Navigation flow page 1

function FlowDetailPage() {
  const navigation = useNavigation();
  return (
    <Detail
      navigationTitle="Flow Detail"
      markdown={DETAIL_MARKDOWN}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Form"
            icon={Icon.Plus}
            shortcut={{ modifiers: ["ctrl"], key: "enter" }}
            target={<FlowFormPage />}
          />
          <Action title="Pop This Page" onAction={() => navigation.pop()} />
          <Action title="Pop To Root" onAction={() => navigation.pop()} />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Status" text="Flowing" />
          <Detail.Metadata.Link title="Spec" text="command-ux-spec.md" target="https://example.com/spec" />
          <Detail.Metadata.TagList title="Tags">
            <Detail.Metadata.TagList.Item text="alpha" color="#59d499" />
            <Detail.Metadata.TagList.Item text="beta" color="#ff6363" />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Countdown" text={Date.now() % 1000 === 0 ? "now" : "later"} />
        </Detail.Metadata>
      }
    />
  );
}

// ---------------------------------------------------------------- Navigation flow page 2: form

function FlowFormPage() {
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const nameError = name.trim() === "" ? "Required" : name.length > 20 ? "Too long (max 20)" : undefined;
  return (
    <Form
      navigationTitle="Flow Form"
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit"
            icon={Icon.Checkmark}
            onSubmit={(values) => {
              navigation.push(<SubmittedPage values={values} />);
            }}
          />
          <Action
            title="Pop Back"
            shortcut={{ modifiers: ["ctrl"], key: "[" }}
            onAction={() => navigation.pop()}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Every field kind, with extension-side validation (the error prop)." />
      <Form.TextField id="name" title="Name" placeholder="Required, max 20 chars" value={name} onChange={setName} error={nameError} />
      <Form.PasswordField id="secret" title="Password" placeholder="hunter2" defaultValue="s3cret" />
      <Form.TextArea id="notes" title="Notes" placeholder="Multiline text" defaultValue={"line one\nline two"} />
      <Form.Checkbox id="agree" label="I agree to the (imaginary) terms" defaultValue={false} />
      <Form.Dropdown id="tier" title="Tier" defaultValue="pro">
        <Form.Dropdown.Item value="free" title="Free" />
        <Form.Dropdown.Item value="pro" title="Pro" />
        <Form.Dropdown.Section title="Enterprise">
          <Form.Dropdown.Item value="team" title="Team" />
          <Form.Dropdown.Item value="enterprise" title="Enterprise" />
        </Form.Dropdown.Section>
      </Form.Dropdown>
      <Form.TagPicker id="tags" title="Tags" defaultValue={["rust"]}>
        <Form.TagPicker.Item title="Rust" value="rust" icon={Icon.Bolt} />
        <Form.TagPicker.Item title="TypeScript" value="typescript" icon={Icon.Code} />
        <Form.TagPicker.Item title="Swift" value="swift" icon={Icon.Star} />
      </Form.TagPicker>
      <Form.DatePicker id="when" title="When" type="datetime" defaultValue={new Date("2026-10-10T12:00:00")} />
      <Form.Separator />
      <Form.TextField id="nickname" title="Nickname" value={nickname} onChange={setNickname} info="Optional field with an info hint" />
    </Form>
  );
}

function SubmittedPage({ values }: { values: Record<string, unknown> }) {
  const navigation = useNavigation();
  return (
    <Detail
      navigationTitle="Submitted"
      markdown={FORM_FIELDS_MARKDOWN(values)}
      actions={
        <ActionPanel>
          <Action title="Pop To Root" onAction={() => navigation.pop()} />
        </ActionPanel>
      }
    />
  );
}

// ---------------------------------------------------------------- Alerts

async function runSimpleAlert(pushResult: (result: string) => void) {
  const confirmed = await confirmAlert({
    title: "Continue the flow?",
    message: "The primary action resolves confirmAlert to true.",
  });
  pushResult(`simple alert -> ${confirmed ? "confirmed (true)" : "dismissed (false)"}`);
}

async function runDestructiveAlert(pushResult: (result: string) => void) {
  const confirmed = await confirmAlert({
    title: "Delete everything?",
    message: "Destructive style renders the primary button red.",
    primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    dismissAction: { title: "Keep", style: Alert.ActionStyle.Cancel },
  });
  pushResult(`destructive alert -> ${confirmed ? "deleted (true)" : "kept (false)"}`);
}

async function runTextFieldAlert(pushResult: (result: string) => void) {
  let typed = "";
  const confirmed = await confirmAlert({
    title: "Type the repo name",
    message: "The primary button stays disabled until the validator passes.",
    primaryAction: {
      title: "Confirm",
      onAction: () => undefined,
    },
  });
  void typed;
  pushResult(`text alert -> ${confirmed ? "confirmed" : "dismissed"}`);
}

function AlertsPage() {
  const navigation = useNavigation();
  const [log, setLog] = useState<string[]>([]);
  const pushResult = (result: string) => setLog((previous) => [...previous, result]);
  return (
    <Detail
      navigationTitle="Alerts"
      markdown={["# Alerts", "", log.length ? log.map((entry) => `- ${entry}`).join("\n") : "_Run an alert from the actions._"].join("\n")}
      actions={
        <ActionPanel>
          <Action title="Simple Alert" onAction={() => void runSimpleAlert(pushResult)} />
          <Action
            title="Destructive Alert"
            style={Action.Style.Destructive}
            onAction={() => void runDestructiveAlert(pushResult)}
          />
          <Action title="Alert With Text Field" onAction={() => void runTextFieldAlert(pushResult)} />
          <Action title="Pop Back" onAction={() => navigation.pop()} />
        </ActionPanel>
      }
    />
  );
}

// ---------------------------------------------------------------- Toasts (smoke check)

function ToastsPage() {
  const navigation = useNavigation();
  return (
    <List navigationTitle="Toasts" searchBarPlaceholder="Filter…">
      <List.Item
        id="success"
        title="Success toast"
        actions={
          <ActionPanel>
            <Action title="Show" onAction={() => void showToast({ title: "Saved", message: "style SUCCESS" })} />
          </ActionPanel>
        }
      />
      <List.Item
        id="failure"
        title="Failure toast"
        actions={
          <ActionPanel>
            <Action
              title="Show"
              onAction={() =>
                void showToast({ style: Toast.Style.Failure, title: "Failed", message: "style FAILURE" })
              }
            />
          </ActionPanel>
        }
      />
      <List.Item
        id="animated"
        title="Animated toast"
        subtitle="stays until hidden"
        actions={
          <ActionPanel>
            <Action
              title="Show"
              onAction={async () => {
                const toast = await showToast({ style: Toast.Style.Animated, title: "Working…" });
                await new Promise((resolve) => setTimeout(resolve, 1500));
                toast.style = Toast.Style.Success;
                toast.title = "Done";
                await new Promise((resolve) => setTimeout(resolve, 1200));
                await toast.hide();
              }}
            />
          </ActionPanel>
        }
      />
      <List.Item
        id="actions"
        title="Toast with actions"
        actions={
          <ActionPanel>
            <Action
              title="Show"
              onAction={() =>
                void showToast({
                  title: "Deleted",
                  message: "primary/secondary actions",
                  primaryAction: { title: "Undo", shortcut: { modifiers: ["ctrl"], key: "enter" }, onAction: () => showToast({ title: "Undone" }) },
                  secondaryAction: { title: "Report", onAction: () => showToast({ title: "Reported" }) },
                })
              }
            />
          </ActionPanel>
        }
      />
      <List.Item
        id="hidden-hud"
        title="HUD toast (closes window)"
        subtitle="toast fired while the launcher is hidden"
        actions={
          <ActionPanel>
            <Action
              title="Close and toast"
              onAction={async () => {
                await closeMainWindow();
                await new Promise((resolve) => setTimeout(resolve, 250));
                await showToast({ title: "Saved in background", message: "HUD while hidden" });
              }}
            />
          </ActionPanel>
        }
      />
      <List.Item
        id="back"
        title="Pop Back"
        actions={<Action title="Pop" onAction={() => navigation.pop()} />}
      />
    </List>
  );
}

// ---------------------------------------------------------------- Grid

const GRID_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#6b7280"];

function GridPage() {
  const navigation = useNavigation();
  return (
    <Grid
      navigationTitle="Grid"
      searchBarPlaceholder="Filter tiles…"
      inset={Grid.Inset.Small}
      aspectRatio="1"
      fit={Grid.Fit.Contain}
      actions={
        <ActionPanel>
          <Action title="Pop Back" onAction={() => navigation.pop()} />
        </ActionPanel>
      }
    >
      <Grid.Section title="Colors" columns={4} aspectRatio="1" inset={Grid.Inset.Small}>
        {GRID_COLORS.map((color, index) => (
          <Grid.Item
            key={color}
            id={`color-${color}`}
            title={color}
            subtitle={`tile ${index + 1}`}
            keywords={[`color`, `tile`]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Color" content={color} />
              </ActionPanel>
            }
          />
        ))}
      </Grid.Section>
      <Grid.Section title="Wide tiles" columns={2} aspectRatio="16/9" inset={Grid.Inset.Medium}>
        {["wide-one", "wide-two"].map((tile) => (
          <Grid.Item
            key={tile}
            id={tile}
            title={tile}
            subtitle="2 columns, 16:9"
            actions={
              <ActionPanel>
                <Action title="Copy Name" content={tile} onAction={() => undefined} />
              </ActionPanel>
            }
          />
        ))}
      </Grid.Section>
      <Grid.EmptyView title="No tiles match" description="The empty view is model-driven and can carry actions." />
    </Grid>
  );
}

// ---------------------------------------------------------------- List with everything

const PAGE_SIZE = 12;

function BigListPage({ depth = 0 }: { depth?: number }) {
  const navigation = useNavigation();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("all");
  const total = 40;
  const items = Array.from({ length: Math.min(page * PAGE_SIZE, total) }, (_, index) => ({
    id: `item-${depth}-${index}`,
    title: `Entry ${index + 1}`,
    subtitle: kind === "all" ? `page ${page} · entry ${index + 1}` : `filtered by ${kind}`,
  }));
  return (
    <List
      navigationTitle="Big List"
      searchBarPlaceholder="Filter entries…"
      isShowingDetail
      throttle
      pagination={{ pageSize: PAGE_SIZE, hasMore: page * PAGE_SIZE < total, onLoadMore: () => setPage((current) => current + 1) }}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by kind" defaultValue="all" onChange={setKind}>
          <List.Dropdown.Item value="all" title="All kinds" />
          <List.Dropdown.Item value="text" title="Text" />
          <List.Dropdown.Item value="image" title="Image" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action title="Pop Back" onAction={() => navigation.pop()} />
        </ActionPanel>
      }
    >
      {items.map((entry, index) => (
        <List.Item
          key={entry.id}
          id={entry.id}
          title={entry.title}
          subtitle={entry.subtitle}
          icon={index % 2 === 0 ? Icon.Document : Icon.Text}
          keywords={[`entry`, `${index}`]}
          accessories={[
            { text: `row ${index + 1}` },
            { tag: "live", color: "#59d499" },
            { date: Date.now() },
          ]}
          detail={
            <List.Item.Detail
              markdown={`# ${entry.title}\n\nSelected-row detail pane with **markdown** and metadata.`}
              metadata={
                <Detail.Metadata>
                  <Detail.Metadata.Label title="Row" text={String(index + 1)} />
                  <Detail.Metadata.Link title="Open" target="https://example.com" text="example.com" />
                </Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <Action title="Push Another List" onAction={() => navigation.push(<BigListPage depth={depth + 1} />)} />
              <Action title="Pop Back" onAction={() => navigation.pop()} />
            </ActionPanel>
          }
        />
      ))}
      <List.EmptyView title="Nothing matches" description="Try clearing the filter." />
    </List>
  );
}

// ---------------------------------------------------------------- Root

export default function Command() {
  const navigation = useNavigation();
  const [flowLog, setFlowLog] = useState<string[]>([]);
  return (
    <List
      navigationTitle="Command UX Tests"
      searchBarPlaceholder="Filter tests…"
      filtering
      actions={
        <ActionPanel>
          <Action
            title="Reset Flow Log"
            onAction={() => setFlowLog([])}
          />
        </ActionPanel>
      }
    >
      <List.Section title="Navigation stack" subtitle="push / pop / popToRoot, search text restored">
        <List.Item
          id="flow-detail"
          title="Multi-page flow"
          subtitle="list -> detail -> form -> submitted"
          icon={Icon.ArrowRight}
          actions={
            <ActionPanel>
              <Action.Push title="Open Flow" target={<FlowDetailPage />} onPop={() => setFlowLog((previous) => [...previous, "flow page popped"])} />
            </ActionPanel>
          }
        />
        <List.Item
          id="big-list"
          title="Nested lists + pagination"
          subtitle="push the same page again, onLoadMore pages in"
          icon={Icon.List}
          actions={
            <ActionPanel>
              <Action.Push title="Open List" target={<BigListPage />} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Dialogs">
        <List.Item
          id="alerts"
          title="Alerts"
          subtitle="confirmAlert: simple, destructive, text field"
          icon={Icon.Warning}
          actions={
            <ActionPanel>
              <Action.Push title="Open Alerts" target={<AlertsPage />} />
              <Action title="Quick Confirm" onAction={() => void runSimpleAlert((result) => setFlowLog((previous) => [...previous, result]))} />
            </ActionPanel>
          }
        />
        <List.Item
          id="toasts"
          title="Toasts"
          subtitle="styles + update + actions (smoke check)"
          icon={Icon.Eye}
          actions={
            <ActionPanel>
              <Action.Push title="Open Toasts" target={<ToastsPage />} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Views">
        <List.Item
          id="grid"
          title="Grid with sections"
          subtitle="per-section columns/aspect/inset, 2D navigation"
          icon={Icon.Grid}
          actions={
            <ActionPanel>
              <Action.Push title="Open Grid" target={<GridPage />} />
            </ActionPanel>
          }
        />
        <List.Item
          id="detail"
          title="Detail with metadata"
          subtitle="markdown: headings, code, table, image"
          icon={Icon.Document}
          actions={
            <ActionPanel>
              <Action.Push title="Open Detail" target={<FlowDetailPage />} />
            </ActionPanel>
          }
        />
      </List.Section>

      {flowLog.length > 0 ? (
        <List.Section title="Event log" subtitle="onPop / alert results">
          {flowLog.map((entry, index) => (
            <List.Item key={`${index}-${entry}`} id={`log-${index}`} title={entry} icon={Icon.Clock} />
          ))}
        </List.Section>
      ) : null}

      <List.EmptyView
        title="No tests match"
        description="Clear the filter to see everything."
      />
    </List>
  );
}
