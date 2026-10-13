import { List, environment, AI, Cache, getPreferenceValues, UnsupportedApiError, getSelectedText, WindowManagement, BrowserExtension, OAuth, useUnstableAI } from "@raycast/api";
import { useEffect, useState } from "react";

type Outcome = { name: string; value: string };

function errorNameOf(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => "no-throw",
    (error: Error) => error.name,
  );
}

export default function Command() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  useEffect(() => {
    const cache = new Cache();
    cache.set("probe", "hit");
    const preferences = getPreferenceValues() as Record<string, unknown>;
    const jobs: Array<Promise<Outcome>> = [
      Promise.resolve({ name: "canAccess-AI", value: String(environment.canAccess(AI)) }),
      Promise.resolve({ name: "canAccess-model", value: String(environment.canAccess("openai-gpt-5.5")) }),
      Promise.resolve({ name: "canAccess-other", value: String(environment.canAccess("whatever")) }),
      Promise.resolve({ name: "cache-get", value: String(cache.get("probe")) }),
      Promise.resolve({ name: "cache-contains", value: String(cache.contains("probe")) }),
      Promise.resolve({ name: "prefs", value: `${String(preferences.token)}|${String(preferences.plain)}` }),
      Promise.resolve({ name: "launchContext", value: String(environment.launchContext) }),
      errorNameOf(() => AI.ask("hello")).then((value) => ({ name: "AI.ask", value })),
      errorNameOf(() => getSelectedText()).then((value) => ({ name: "getSelectedText", value })),
      errorNameOf(() => WindowManagement.getDesktops()).then((value) => ({ name: "WindowManagement", value })),
      errorNameOf(() => BrowserExtension.getTabs()).then((value) => ({ name: "BrowserExtension", value })),
      errorNameOf(() => new OAuth.PKCEClient().authorize()).then((value) => ({ name: "OAuth", value })),
      Promise.resolve({ name: "useUnstableAI", value: errorNameSync(() => useUnstableAI()) }),
      Promise.resolve({ name: "error-class", value: String(typeof UnsupportedApiError === "function") }),
    ];
    void Promise.all(jobs).then((done) => setOutcomes(done));
  }, []);

  return (
    <List navigationTitle="Probe">
      {outcomes.map((outcome) => (
        <List.Item key={outcome.name} title={outcome.name} subtitle={outcome.value} />
      ))}
    </List>
  );
}

function errorNameSync(run: () => unknown): string {
  try {
    run();
    return "no-throw";
  } catch (error) {
    return (error as Error).name;
  }
}
