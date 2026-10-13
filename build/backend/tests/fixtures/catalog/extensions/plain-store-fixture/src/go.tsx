import { List } from "@raycast/api";
import { useEffect, useState } from "react";

export default function Command() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);
  return (
    <List navigationTitle="Go Fixture">
      <List.Item title="base" subtitle="row" />
      {loaded ? <List.Item title="loaded" subtitle="after-effect" /> : null}
    </List>
  );
}
