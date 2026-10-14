import {
  Action,
  ActionPanel,
  Grid,
  defineReactExtension,
  type CommandProps,
} from '@flowkey-mini/react-ui';
import type { ExtensionManifest } from '@flowkey-mini/native-sdk';
import manifestJson from '../manifest.json';
import { COLOR_OPTIONS, resolveColor } from './colors';
import { componentName, displayName, filterIcons, iconPageUrl, type LucideIconMeta } from './icons';

const manifest = manifestJson as unknown as ExtensionManifest;

interface IconAction {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

function buildActions(
  icon: LucideIconMeta,
  props: CommandProps,
  pascalCase: boolean,
): IconAction[] {
  return [
    {
      id: 'copy-name',
      title: 'Copy Name',
      run: async () => {
        await props.capabilities.clipboard.write(displayName(icon, pascalCase));
        await props.capabilities.hud.show({ title: 'Name copied', icon: '📋' });
      },
    },
    {
      id: 'copy-svg',
      title: 'Copy SVG',
      run: async () => {
        await props.capabilities.clipboard.write(icon.svg);
        await props.capabilities.hud.show({ title: 'SVG copied', icon: '📋' });
      },
    },
    {
      id: 'paste-svg',
      title: 'Paste SVG',
      run: async () => {
        await props.capabilities.clipboard.paste(icon.svg);
        await props.capabilities.hud.show({ title: 'SVG pasted', icon: '📋' });
      },
    },
    {
      id: 'copy-component',
      title: 'Copy Component',
      run: async () => {
        await props.capabilities.clipboard.write(componentName(icon));
        await props.capabilities.hud.show({ title: 'Component copied', icon: '📋' });
      },
    },
    {
      id: 'open-in-browser',
      title: 'Open In Browser',
      run: () => props.capabilities.shell.openUrl(iconPageUrl(icon)),
    },
  ];
}

function LucideIconsView(props: CommandProps) {
  const primaryAction =
    typeof props.preferences.primaryAction === 'string'
      ? props.preferences.primaryAction
      : 'copy-name';
  const pascalCase = props.preferences.pascalCaseName === true;
  const color = resolveColor(props.filterValue);
  const query = props.query.trim().toLowerCase();
  const results = filterIcons(query);

  // The actions prop must be a static element tree the serializer can walk,
  // so the panel is inlined per item rather than wrapped in a component.
  const actionsFor = (icon: LucideIconMeta) => {
    const actions = buildActions(icon, props, pascalCase);
    const primary = actions.find((a) => a.id === primaryAction) ?? actions[0];
    return (
      <ActionPanel>
        {actions.map((action) => (
          <Action
            key={action.id}
            title={action.title}
            primary={action.id === primary.id}
            onAction={action.run}
          />
        ))}
      </ActionPanel>
    );
  };

  return (
    <Grid columns={8} filter={COLOR_OPTIONS}>
      <Grid.EmptyView
        title="No icons found"
        description={query.length > 0 ? `Nothing matches "${props.query}"` : undefined}
      />
      <Grid.Section title="Results" subtitle={String(results.length)}>
        {results.map((icon) => (
          <Grid.Item
            key={icon.name}
            id={icon.name}
            title={icon.name}
            icon={{ svg: icon.svg, color }}
            actions={actionsFor(icon)}
          />
        ))}
      </Grid.Section>
    </Grid>
  );
}

export default defineReactExtension({
  manifest,
  component: LucideIconsView,
});
