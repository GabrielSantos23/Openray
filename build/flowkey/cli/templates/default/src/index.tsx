import { useEffect, useState } from 'react';
import {
  Action,
  ActionPanel,
  List,
  defineReactExtension,
  type CommandProps,
} from '@flowkey-mini/react-ui';
import manifest from '../manifest.json';

const SAMPLE_ITEMS = [
  { id: 'alpha', title: 'Alpha', subtitle: 'the first sample item' },
  { id: 'beta', title: 'Beta', subtitle: 'the second sample item' },
  { id: 'gamma', title: 'Gamma', subtitle: 'the third sample item' },
];

interface RepoInfo {
  stars: string | null;
  error: string | null;
}

/**
 * A minimal but complete extension view: search-filtered list items, a live
 * http.fetch against an allowlisted host, and actions exercising the
 * clipboard, storage and shell capabilities. All of these go through the
 * manifest + consent gate in the shell.
 */
function DemoView(props: CommandProps) {
  const [repo, setRepo] = useState<RepoInfo>({ stars: null, error: null });

  useEffect(() => {
    let cancelled = false;
    props.capabilities.http
      .fetchJson<{ stargazers_count: number }>('https://api.github.com/repos/facebook/react')
      .then((data) => {
        if (!cancelled) setRepo({ stars: String(data.stargazers_count), error: null });
      })
      .catch(() => {
        if (!cancelled) setRepo({ stars: null, error: 'request failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [props.capabilities]);

  const query = props.query.trim().toLowerCase();
  const items = SAMPLE_ITEMS.filter((item) => item.title.toLowerCase().includes(query));

  return (
    <List>
      <List.EmptyView title="No matches" description="Try a different search term" />
      <List.Section title="Sample items">
        {items.map((item) => (
          <List.Item
            key={item.id}
            id={item.id}
            title={item.title}
            subtitle={item.subtitle}
            actions={
              <ActionPanel>
                <Action
                  id={`copy-${item.id}`}
                  title="Copy title"
                  primary
                  onAction={async () => {
                    await props.capabilities.clipboard.write(item.title);
                    await props.capabilities.hud.show({ title: 'Copied!', icon: '📋' });
                  }}
                />
                <Action
                  id={`remember-${item.id}`}
                  title="Remember as favourite"
                  onAction={async () => {
                    await props.capabilities.storage.set('favourite', item.id);
                    await props.capabilities.hud.show({ title: `Saved ${item.title}` });
                  }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Live capability demo">
        <List.Item
          id="repo"
          title={repo.error ? 'facebook/react (unavailable)' : 'facebook/react'}
          subtitle={repo.stars ? `⭐ ${repo.stars} stars — via http.fetch` : 'fetching…'}
          actions={
            <ActionPanel>
              <Action
                id="open-repo"
                title="Open in browser"
                primary
                onAction={() =>
                  props.capabilities.shell.openUrl('https://github.com/facebook/react')
                }
              />
              <Action
                id="copy-stars"
                title="Copy star count"
                onAction={async () => {
                  if (repo.stars !== null) {
                    await props.capabilities.clipboard.write(repo.stars);
                  }
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

export default defineReactExtension({
  manifest,
  component: DemoView,
});
