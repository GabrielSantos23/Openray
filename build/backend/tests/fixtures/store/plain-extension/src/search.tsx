import { List, ActionPanel, Action } from "@raycast/api";
import { useState } from "react";
import { helperGreeting } from "fixture-helper";

interface Row {
  title: string;
  subtitle: string;
}

export default function Command() {
  const [rows] = useState<Row[]>([
    { title: "First row", subtitle: helperGreeting("first") },
    { title: "Second row", subtitle: helperGreeting("second") },
  ]);

  return (
    <List navigationTitle="Fixture Search">
      {rows.map((row) => (
        <List.Item
          key={row.title}
          title={row.title}
          subtitle={row.subtitle}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard content={row.title} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
