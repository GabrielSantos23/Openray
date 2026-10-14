import type {
  DetailTree,
  FormField,
  FormTree,
  GridTree,
  ListTree,
  UiAction,
  UiEmptyView,
  UiFilter,
  UiItem,
  UiPane,
  UiPaneField,
  UiSection,
  UiTree,
} from '@flowkey-mini/native-sdk';
import { Fragment, type ReactElement } from 'react';
import { ReactUiError } from './errors';
import { resolveIntrinsic } from './intrinsic';
import type { HostContainer, HostNode } from './node';
import type { IconSpec } from './props';
import type { ActionHandler, ActionRegistry } from './registry';

function requireIntrinsic(type: unknown, context: string): string {
  const resolved = resolveIntrinsic(type);
  if (resolved !== undefined) return resolved;
  throw new ReactUiError(
    `${context}: expected a FlowKey UI component, got <${describeType(type)}>`,
  );
}

function describeType(type: unknown): string {
  if (typeof type === 'function') return type.name || 'anonymous component';
  return String(type);
}

interface SerializeState {
  registry: ActionRegistry;
  seenActionIds: Set<string>;
  seenItemIds: Set<string>;
  hasPane: boolean;
}

const LIST_ALLOWED = ['layout', 'filter', 'isLoading', 'searchBarPlaceholder', 'pagination'];
const LIST_SECTION_ALLOWED = ['title'];
const LIST_ITEM_ALLOWED = [
  'id',
  'title',
  'subtitle',
  'kind',
  'icon',
  'keywords',
  'accessories',
  'actions',
  'detail',
];
const LIST_ITEM_DETAIL_ALLOWED = ['preview', 'previewImageUri'];
const DETAIL_ALLOWED = ['title', 'mediaKeys', 'subtitle', 'imageUri', 'markdown', 'actions'];
const DETAIL_METADATA_ALLOWED: string[] = [];
const DETAIL_FIELD_ALLOWED = ['label', 'value', 'valueIconUri', 'href', 'tags', 'kind'];
const GRID_ALLOWED = ['columns', 'title', 'filter', 'isLoading', 'searchBarPlaceholder'];
const GRID_ITEM_ALLOWED = [
  'id',
  'title',
  'subtitle',
  'kind',
  'icon',
  'keywords',
  'accessories',
  'actions',
];
const GRID_SECTION_ALLOWED = ['title', 'subtitle'];
const ACTION_PANEL_ALLOWED: string[] = [];
const ACTION_ALLOWED = ['title', 'primary', 'push', 'onAction', 'id', 'style', 'shortcut'];
const EMPTY_VIEW_ALLOWED = ['title', 'description'];

const ROOT_TYPES = new Set(['list', 'detail', 'grid', 'form']);

export function serializeUiTree(container: HostContainer, registry: ActionRegistry): UiTree {
  const roots = container.children;
  if (roots.length === 0) {
    return { type: 'list', sections: [] };
  }
  if (roots.length > 1) {
    throw new ReactUiError(
      `component must render a single <List>, <Detail> or <Grid>, got ${roots.length} root elements`,
    );
  }
  const root = roots[0];
  if (!ROOT_TYPES.has(root.type)) {
    throw new ReactUiError(
      `component must render a <List>, <Detail> or <Grid>, got <${root.type}>`,
    );
  }
  const state: SerializeState = {
    registry,
    seenActionIds: new Set(),
    seenItemIds: new Set(),
    hasPane: false,
  };
  if (root.type === 'list') return serializeList(root, state);
  if (root.type === 'detail') return serializeDetail(root, state);
  if (root.type === 'form') return serializeForm(root, state);
  return serializeGrid(root, state);
}

function checkProps(type: string, props: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    if (!allowed.includes(key)) {
      throw new ReactUiError(`unknown prop '${key}' on <${type}>`);
    }
  }
}

function requireString(type: string, props: Record<string, unknown>, key: string): string {
  const value = props[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReactUiError(`<${type}> requires a non-empty string prop '${key}'`);
  }
  return value;
}

function optionalString(
  type: string,
  props: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = props[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ReactUiError(`<${type}> prop '${key}' must be a string`);
  }
  return value;
}

function optionalBoolean(
  type: string,
  props: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = props[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new ReactUiError(`<${type}> prop '${key}' must be a boolean`);
  }
  return value;
}

function optionalIcon(type: string, props: Record<string, unknown>, key: string): Partial<UiItem> {
  const value = props[key];
  if (value === undefined) return {};
  if (typeof value === 'string') {
    return value.length > 0 ? { icon: value } : {};
  }
  if (typeof value !== 'object' || value === null) {
    throw new ReactUiError(`<${type}> prop '${key}' must be a string or an icon object`);
  }
  const spec = value as IconSpec;
  const sources = ['emoji' in spec, 'lucide' in spec, 'uri' in spec, 'svg' in spec].filter(
    Boolean,
  ).length;
  if (sources !== 1) {
    throw new ReactUiError(
      `<${type}> prop '${key}' must set exactly one of emoji, lucide, uri or svg`,
    );
  }
  if ('color' in spec && !('lucide' in spec || 'svg' in spec)) {
    throw new ReactUiError(
      `<${type}> prop '${key}' may only set 'color' together with 'lucide' or 'svg'`,
    );
  }
  if (typeof spec.emoji === 'string') return { icon: spec.emoji };
  if (typeof spec.uri === 'string') return { iconUri: spec.uri };
  if (typeof spec.svg === 'string') {
    if (spec.svg.length === 0) {
      throw new ReactUiError(`<${type}> prop '${key}' has empty svg content`);
    }
    const out: Partial<UiItem> = { iconSvg: spec.svg };
    if (typeof spec.color === 'string') out.iconColor = spec.color;
    return out;
  }
  if (typeof spec.lucide === 'string') {
    const out: Partial<UiItem> = { iconName: spec.lucide };
    if (typeof spec.color === 'string') out.iconColor = spec.color;
    return out;
  }
  throw new ReactUiError(`<${type}> prop '${key}' has empty icon fields`);
}

function optionalFilter(component: string, props: Record<string, unknown>): UiFilter | undefined {
  const filterValue = props['filter'];
  if (filterValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(filterValue)) {
    throw new ReactUiError(`<${component}> prop 'filter' must be an array of {label, value}`);
  }
  const options = filterValue.map((option) => {
    if (
      typeof option !== 'object' ||
      option === null ||
      typeof (option as { label?: unknown }).label !== 'string' ||
      typeof (option as { value?: unknown }).value !== 'string'
    ) {
      throw new ReactUiError(
        `<${component}> prop 'filter' entries must be {label: string, value: string}`,
      );
    }
    const { label, value } = option as { label: string; value: string };
    return { label, value };
  });
  return options.length > 0 ? { options } : undefined;
}

function optionalKeywords(type: string, props: Record<string, unknown>): string[] | undefined {
  const value = props['keywords'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((k) => typeof k !== 'string' || k.length === 0)) {
    throw new ReactUiError(`<${type}> prop 'keywords' must be an array of non-empty strings`);
  }
  return value as string[];
}

const ACCESSORY_COLORS = ['success', 'danger', 'accent', 'secondary'];

function optionalAccessories(type: string, props: Record<string, unknown>): UiItem['accessories'] {
  const value = props['accessories'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ReactUiError(
      `<${type}> prop 'accessories' must be an array of {text, tooltip?, color?}`,
    );
  }
  const accessories = value.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { text?: unknown }).text !== 'string' ||
      (entry as { text?: string }).text!.length === 0
    ) {
      throw new ReactUiError(`<${type}> prop 'accessories' entries require a non-empty 'text'`);
    }
    const { text, tooltip, color } = entry as { text: string; tooltip?: unknown; color?: unknown };
    const accessory: UiItem['accessories'] = [{ text }];
    const a = accessory[0];
    if (tooltip !== undefined) {
      if (typeof tooltip !== 'string') {
        throw new ReactUiError(`<${type}> prop 'accessories' tooltip must be a string`);
      }
      a.tooltip = tooltip;
    }
    if (color !== undefined) {
      if (typeof color !== 'string' || !ACCESSORY_COLORS.includes(color)) {
        throw new ReactUiError(
          `<${type}> prop 'accessories' color must be one of: ${ACCESSORY_COLORS.join(', ')}`,
        );
      }
      a.color = color as 'success' | 'danger' | 'accent' | 'secondary';
    }
    return a!;
  });
  return accessories.length > 0 ? accessories : undefined;
}

function serializeList(node: HostNode, state: SerializeState): ListTree {
  checkProps('list', node.props, LIST_ALLOWED);
  const layoutValue = node.props['layout'];
  if (layoutValue !== undefined && layoutValue !== 'side-pane') {
    throw new ReactUiError(`<list> prop 'layout' must be 'side-pane'`);
  }
  const filter = optionalFilter('list', node.props);

  const sections: UiSection[] = [];
  let pending: UiItem[] = [];
  let emptyView: UiEmptyView | undefined;
  let emptyViewCount = 0;
  for (const child of node.children) {
    if (child.type === 'list-section') {
      if (pending.length > 0) {
        sections.push({ items: pending });
        pending = [];
      }
      sections.push(serializeSection(child, state));
    } else if (child.type === 'list-item') {
      pending.push(serializeItem(child, state, true));
    } else if (child.type === 'empty-view') {
      emptyViewCount += 1;
      if (emptyViewCount > 1) {
        throw new ReactUiError('a <List> may contain at most one <List.EmptyView>');
      }
      emptyView = serializeEmptyView(child);
    } else {
      throw new ReactUiError(
        `<list> children must be <List.Section>, <List.Item> or <List.EmptyView>, got <${child.type}>`,
      );
    }
  }
  if (pending.length > 0) {
    sections.push({ items: pending });
  }
  const tree: ListTree = { type: 'list', sections };
  const layout = layoutValue !== undefined ? layoutValue : state.hasPane ? 'side-pane' : undefined;
  if (layout !== undefined) tree.layout = layout;
  if (filter !== undefined) tree.filter = filter;
  if (emptyView !== undefined) tree.emptyView = emptyView;
  const isLoading = optionalBoolean('list', node.props, 'isLoading');
  if (isLoading !== undefined) tree.isLoading = isLoading;
  const placeholder = optionalString('list', node.props, 'searchBarPlaceholder');
  if (placeholder !== undefined) tree.searchBarPlaceholder = placeholder;
  const pagination = optionalPagination(node.props, state);
  if (pagination !== undefined) tree.pagination = pagination;
  return tree;
}

function optionalPagination(
  props: Record<string, unknown>,
  state: SerializeState,
): ListTree['pagination'] {
  const value = props['pagination'];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new ReactUiError(
      `<list> prop 'pagination' must be { hasNextPage: boolean, onLoadMore: () => void, pageSize?: number }`,
    );
  }
  const { hasNextPage, onLoadMore, pageSize } = value as {
    hasNextPage?: unknown;
    onLoadMore?: unknown;
    pageSize?: unknown;
  };
  if (typeof hasNextPage !== 'boolean') {
    throw new ReactUiError(`<list> prop 'pagination' requires a boolean 'hasNextPage'`);
  }
  if (hasNextPage === false) {
    return undefined;
  }
  if (typeof onLoadMore !== 'function') {
    throw new ReactUiError(`<list> prop 'pagination' requires an 'onLoadMore' function`);
  }
  if (pageSize !== undefined && (typeof pageSize !== 'number' || pageSize <= 0)) {
    throw new ReactUiError(`<list> prop 'pagination' 'pageSize' must be a positive number`);
  }
  const pagination: NonNullable<ListTree['pagination']> = {
    hasNextPage: true,
    moreActionId: state.registry.register(onLoadMore as ActionHandler),
  };
  if (pageSize !== undefined) pagination.pageSize = pageSize;
  return pagination;
}

function serializeSection(node: HostNode, state: SerializeState): UiSection {
  checkProps('list-section', node.props, LIST_SECTION_ALLOWED);
  const title = optionalString('list-section', node.props, 'title');
  const items = node.children.map((child) => {
    if (child.type !== 'list-item') {
      throw new ReactUiError(`<list-section> children must be <List.Item>, got <${child.type}>`);
    }
    return serializeItem(child, state, true);
  });
  const section: UiSection = { items };
  if (title !== undefined) section.title = title;
  return section;
}

function serializeItem(node: HostNode, state: SerializeState, paneAllowed: boolean): UiItem {
  const type = paneAllowed ? 'list-item' : 'grid-item';
  checkProps(type, node.props, paneAllowed ? LIST_ITEM_ALLOWED : GRID_ITEM_ALLOWED);
  const id = requireString(type, node.props, 'id');
  if (state.seenItemIds.has(id)) {
    throw new ReactUiError(`duplicate item id '${id}' in tree`);
  }
  state.seenItemIds.add(id);
  const title = requireString(type, node.props, 'title');
  const item: UiItem = { id, title };
  const subtitle = optionalString(type, node.props, 'subtitle');
  if (subtitle !== undefined) item.subtitle = subtitle;
  const kind = optionalString(type, node.props, 'kind');
  if (kind !== undefined) item.kind = kind;
  const keywords = optionalKeywords(type, node.props);
  if (keywords !== undefined) item.keywords = keywords;
  const accessories = optionalAccessories(type, node.props);
  if (accessories !== undefined) item.accessories = accessories;
  Object.assign(item, optionalIcon(type, node.props, 'icon'));
  const actionsValue = node.props['actions'];
  if (actionsValue !== undefined) {
    const actions = serializeActions(actionsValue, state);
    if (actions.length > 0) item.actions = actions;
  }
  if (paneAllowed) {
    const detailValue = node.props['detail'];
    if (detailValue !== undefined) {
      const pane = serializePaneElement(detailValue, state);
      if (pane !== undefined) {
        item.pane = pane;
        state.hasPane = true;
      }
    }
    for (const child of node.children) {
      if (child.type !== 'list-item-detail') {
        throw new ReactUiError(
          `<list-item> children must be <List.Item.Detail>, got <${child.type}>`,
        );
      }
      if (item.pane !== undefined) {
        throw new ReactUiError(`<list-item> may only have one <List.Item.Detail>`);
      }
      const pane = serializePaneNode(child, state);
      if (pane !== undefined) {
        item.pane = pane;
        state.hasPane = true;
      }
    }
  }
  return item;
}

function serializePaneElement(detailValue: unknown, state: SerializeState): UiPane | undefined {
  if (
    !isElement(detailValue) ||
    requireIntrinsic(detailValue.type, "<list-item> prop 'detail'") !== 'list-item-detail'
  ) {
    throw new ReactUiError(`<list-item> prop 'detail' must be a <List.Item.Detail> element`);
  }
  const element = detailValue as ReactElement<Record<string, unknown>>;
  checkProps('list-item-detail', element.props, LIST_ITEM_DETAIL_ALLOWED);
  return finishPane(
    element.props,
    serializeMetadataFromRaw(element.props['children'], state, true),
  );
}

function serializePaneNode(node: HostNode, state: SerializeState): UiPane | undefined {
  checkProps('list-item-detail', node.props, LIST_ITEM_DETAIL_ALLOWED);
  return finishPane(node.props, serializeMetadataFromHost(node.children, state, true));
}

function finishPane(props: Record<string, unknown>, fields: UiPaneField[]): UiPane | undefined {
  const pane: UiPane = {};
  const preview = optionalString('list-item-detail', props, 'preview');
  if (preview !== undefined) pane.preview = preview;
  const previewImageUri = optionalString('list-item-detail', props, 'previewImageUri');
  if (previewImageUri !== undefined) pane.previewImageUri = previewImageUri;
  if (fields.length > 0) pane.fields = fields;
  if (
    pane.preview === undefined &&
    pane.previewImageUri === undefined &&
    pane.fields === undefined
  ) {
    return undefined;
  }
  return pane;
}

function serializeMetadataFromHost(
  nodes: HostNode[],
  state: SerializeState,
  allowValueIconUri: boolean,
): UiPaneField[] {
  const fields: UiPaneField[] = [];
  for (const node of nodes) {
    if (node.type !== 'detail-metadata') {
      throw new ReactUiError(`<detail> children must be <Detail.Metadata>, got <${node.type}>`);
    }
    checkProps('detail-metadata', node.props, DETAIL_METADATA_ALLOWED);
    for (const fieldNode of node.children) {
      if (fieldNode.type !== 'detail-field') {
        throw new ReactUiError(
          `<Detail.Metadata> children must be <Detail.Metadata.Field>, got <${fieldNode.type}>`,
        );
      }
      fields.push(serializeField(fieldNode.props, state, allowValueIconUri));
    }
  }
  return fields;
}

function serializeMetadataFromRaw(
  children: unknown,
  state: SerializeState,
  allowValueIconUri: boolean,
): UiPaneField[] {
  const fields: UiPaneField[] = [];
  for (const child of flattenElements(children)) {
    if (!isElement(child)) {
      throw new ReactUiError(
        `<list-item-detail> children must be <List.Item.Detail.Metadata>, got ${describeNode(child)}`,
      );
    }
    if (isFragment(child)) {
      fields.push(...serializeMetadataFromRaw(child.props['children'], state, allowValueIconUri));
      continue;
    }
    if (requireIntrinsic(child.type, '<list-item-detail> children') !== 'detail-metadata') {
      throw new ReactUiError(
        `<list-item-detail> children must be <List.Item.Detail.Metadata>, got ${describeNode(child)}`,
      );
    }
    const metadata = child as ReactElement<Record<string, unknown>>;
    checkProps('detail-metadata', metadata.props, DETAIL_METADATA_ALLOWED);
    for (const node of flattenElements(metadata.props['children'])) {
      if (
        !isElement(node) ||
        requireIntrinsic(node.type, '<Metadata> children') !== 'detail-field'
      ) {
        throw new ReactUiError(
          `<Metadata> children must be <Metadata.Field>, got ${describeNode(node)}`,
        );
      }
      fields.push(
        serializeField(
          (node as ReactElement<Record<string, unknown>>).props,
          state,
          allowValueIconUri,
        ),
      );
    }
  }
  return fields;
}

function serializeField(
  props: Record<string, unknown>,
  _state: SerializeState,
  allowValueIconUri: boolean,
): UiPaneField {
  checkProps('detail-field', props, DETAIL_FIELD_ALLOWED);
  if (!allowValueIconUri && props['valueIconUri'] !== undefined) {
    throw new ReactUiError(
      `<Metadata.Field> prop 'valueIconUri' is only supported inside <List.Item.Detail>`,
    );
  }
  if (
    allowValueIconUri &&
    (props['kind'] !== undefined || props['href'] !== undefined || props['tags'] !== undefined)
  ) {
    throw new ReactUiError(
      `<Metadata.Field> 'kind', 'href' and 'tags' are only supported inside <Detail.Metadata>`,
    );
  }
  const kind = props['kind'];
  if (kind !== undefined && (typeof kind !== 'string' || !FIELD_KINDS.includes(kind))) {
    throw new ReactUiError(
      `<Metadata.Field> prop 'kind' must be one of: ${FIELD_KINDS.join(', ')}`,
    );
  }
  const field: Omit<UiPaneField, 'value'> & {
    value?: string;
    href?: string;
    tags?: string[];
    kind?: string;
  } =
    kind === 'separator'
      ? { label: '', value: '', kind: 'separator' }
      : {
          label: requireString('detail-field', props, 'label'),
          value:
            kind === 'tags' && props['value'] === undefined
              ? ''
              : requireString('detail-field', props, 'value'),
        };
  if (kind !== undefined && kind !== 'separator') field.kind = kind;
  if (kind === 'tags' || (kind === undefined && props['tags'] !== undefined)) {
    const tags = props['tags'];
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length === 0)) {
      throw new ReactUiError(
        `<Metadata.Field> tags fields require an array of non-empty strings 'tags'`,
      );
    }
    field.tags = tags as string[];
    field.kind = 'tags';
    if (field.value === '') delete field.value;
  }
  if (props['href'] !== undefined) {
    if (typeof props['href'] !== 'string' || props['href'].length === 0) {
      throw new ReactUiError(`<Metadata.Field> prop 'href' must be a non-empty string`);
    }
    field.kind = 'link';
    field.href = props['href'] as string;
  }
  if (allowValueIconUri) {
    const valueIconUri = optionalString('detail-field', props, 'valueIconUri');
    if (valueIconUri !== undefined) field.valueIconUri = valueIconUri;
  }
  return field as UiPaneField;
}

const FIELD_KINDS = ['text', 'link', 'tags', 'separator'];

function serializeDetail(node: HostNode, state: SerializeState): DetailTree {
  checkProps('detail', node.props, DETAIL_ALLOWED);
  const tree: DetailTree = {
    type: 'detail',
    title: requireString('detail', node.props, 'title'),
    fields: serializeMetadataFromHost(node.children, state, false),
  };
  const subtitle = optionalString('detail', node.props, 'subtitle');
  if (subtitle !== undefined) tree.subtitle = subtitle;
  const imageUri = optionalString('detail', node.props, 'imageUri');
  if (imageUri !== undefined) tree.imageUri = imageUri;
  if (typeof node.props['mediaKeys'] === 'boolean') tree.mediaKeys = node.props['mediaKeys'];
  const markdown = optionalString('detail', node.props, 'markdown');
  if (markdown !== undefined) tree.description = markdown;
  const actionsValue = node.props['actions'];
  if (actionsValue !== undefined) {
    const actions = serializeActions(actionsValue, state);
    if (actions.length > 0) tree.actions = actions;
  }
  return tree;
}

function serializeGrid(node: HostNode, state: SerializeState): GridTree {
  checkProps('grid', node.props, GRID_ALLOWED);
  const columns = node.props['columns'];
  if (typeof columns !== 'number' || !Number.isInteger(columns) || columns <= 0) {
    throw new ReactUiError(`<grid> requires a positive integer prop 'columns'`);
  }
  const tree: GridTree = { type: 'grid', columns, items: [] };
  const title = optionalString('grid', node.props, 'title');
  if (title !== undefined) tree.title = title;
  const filter = optionalFilter('grid', node.props);
  if (filter !== undefined) tree.filter = filter;
  const isLoading = optionalBoolean('grid', node.props, 'isLoading');
  if (isLoading !== undefined) tree.isLoading = isLoading;
  const placeholder = optionalString('grid', node.props, 'searchBarPlaceholder');
  if (placeholder !== undefined) tree.searchBarPlaceholder = placeholder;
  let emptyView: UiEmptyView | undefined;
  let emptyViewCount = 0;
  let looseItemCount = 0;
  let sections: UiSection[] | undefined;
  for (const child of node.children) {
    if (child.type === 'grid-section') {
      sections ??= [];
      sections.push(serializeGridSection(child, state));
    } else if (child.type === 'grid-item') {
      looseItemCount += 1;
      tree.items.push(serializeItem(child, state, false));
    } else if (child.type === 'empty-view') {
      emptyViewCount += 1;
      if (emptyViewCount > 1) {
        throw new ReactUiError('a <Grid> may contain at most one <Grid.EmptyView>');
      }
      emptyView = serializeEmptyView(child);
    } else {
      throw new ReactUiError(
        `<grid> children must be <Grid.Item>, <Grid.Section> or <Grid.EmptyView>, got <${child.type}>`,
      );
    }
  }
  if (sections !== undefined && looseItemCount > 0) {
    throw new ReactUiError(
      'a <Grid> cannot mix <Grid.Section> children with loose <Grid.Item> children',
    );
  }
  if (sections !== undefined) {
    tree.sections = sections;
    tree.items = [];
  }
  if (emptyView !== undefined) tree.emptyView = emptyView;
  return tree;
}

function serializeGridSection(node: HostNode, state: SerializeState): UiSection {
  checkProps('grid-section', node.props, GRID_SECTION_ALLOWED);
  const title = optionalString('grid-section', node.props, 'title');
  const subtitle = optionalString('grid-section', node.props, 'subtitle');
  const items = node.children.map((child) => {
    if (child.type !== 'grid-item') {
      throw new ReactUiError(`<grid-section> children must be <Grid.Item>, got <${child.type}>`);
    }
    return serializeItem(child, state, false);
  });
  const section: UiSection = { items };
  if (title !== undefined) section.title = title;
  if (subtitle !== undefined) section.subtitle = subtitle;
  return section;
}

const FORM_FIELD_TAGS = new Set([
  'form-textfield',
  'form-password',
  'form-textarea',
  'form-checkbox',
  'form-dropdown',
  'form-datepicker',
  'form-tagpicker',
  'form-filepicker',
  'form-description',
  'form-separator',
]);

const FORM_FIELD_KIND_BY_TAG: Record<string, FormField['kind']> = {
  'form-textfield': 'textfield',
  'form-password': 'password',
  'form-textarea': 'textarea',
  'form-checkbox': 'checkbox',
  'form-dropdown': 'dropdown',
  'form-datepicker': 'datepicker',
  'form-tagpicker': 'tagpicker',
  'form-filepicker': 'filepicker',
  'form-description': 'description',
  'form-separator': 'separator',
};

function serializeForm(node: HostNode, state: SerializeState): FormTree {
  checkProps('form', node.props, ['title', 'onSubmit', 'actions']);
  const tree: FormTree = {
    type: 'form',
    title: requireString('form', node.props, 'title'),
    fields: [],
  };
  const onSubmit = node.props['onSubmit'];
  if (onSubmit !== undefined && typeof onSubmit !== 'function') {
    throw new ReactUiError(`<form> prop 'onSubmit' must be a function`);
  }
  const seenFieldIds = new Set<string>();
  for (const child of node.children) {
    const intrinsic = resolveIntrinsic(child.type);
    if (intrinsic === undefined || !FORM_FIELD_TAGS.has(intrinsic)) {
      throw new ReactUiError(
        `<form> children must be Form field components, got <${String(child.type)}>`,
      );
    }
    const field = serializeFormField(child, intrinsic);
    if (field !== undefined) {
      if (field.id.length > 0) {
        if (seenFieldIds.has(field.id)) {
          throw new ReactUiError(`duplicate form field id '${field.id}'`);
        }
        seenFieldIds.add(field.id);
      }
      tree.fields.push(field);
    }
  }
  const actionsValue = node.props['actions'];
  if (actionsValue !== undefined) {
    const actions = serializeActions(actionsValue, state);
    if (actions.length > 0) tree.actions = actions;
  }
  if (typeof onSubmit === 'function') {
    tree.submitActionId = state.registry.register(onSubmit as ActionHandler);
  }
  return tree;
}

function serializeFormField(node: HostNode, tag: string): FormField | undefined {
  const kind = FORM_FIELD_KIND_BY_TAG[tag];
  const props = node.props;
  if (kind === 'separator') {
    return { id: '', kind };
  }
  const id = kind === 'description' ? '' : requireString('form field', props, 'id');
  const field: FormField = { id, kind };
  const label = optionalString('form field', props, 'label');
  if (label !== undefined) field.label = label;
  const placeholder = optionalString('form field', props, 'placeholder');
  if (placeholder !== undefined) field.placeholder = placeholder;
  const required = optionalBoolean('form field', props, 'required');
  if (required !== undefined) field.required = required;

  if (kind === 'description') {
    if (label === undefined) {
      throw new ReactUiError(`<Form.Description> requires a non-empty string prop 'label'`);
    }
    return field;
  }

  const defaultValue = props['default'];
  if (defaultValue !== undefined) {
    if (kind === 'checkbox') {
      if (typeof defaultValue !== 'boolean') {
        throw new ReactUiError(`<Form.Checkbox> prop 'default' must be a boolean`);
      }
      field.default = defaultValue;
    } else {
      if (typeof defaultValue !== 'string') {
        throw new ReactUiError(`<form field> prop 'default' must be a string`);
      }
      field.default = defaultValue;
    }
  }

  if (kind === 'dropdown' || kind === 'tagpicker') {
    const options = props['options'];
    if (!Array.isArray(options) || options.some((o) => typeof o !== 'object' || o === null)) {
      throw new ReactUiError(`<form field> prop 'options' must be an array of {value, title}`);
    }
    field.options = (options as { value?: unknown; title?: unknown }[]).map((option) => {
      if (typeof option.value !== 'string' || typeof option.title !== 'string') {
        throw new ReactUiError(
          `<form field> prop 'options' entries require value and title strings`,
        );
      }
      return { value: option.value, title: option.title };
    });
    const defaults = props['defaults'];
    if (defaults !== undefined) {
      if (!Array.isArray(defaults) || defaults.some((d) => typeof d !== 'string')) {
        throw new ReactUiError(`<Form.TagPicker> prop 'defaults' must be an array of strings`);
      }
      field.defaults = defaults as string[];
    }
  }

  if (kind === 'filepicker') {
    const canChooseFiles = optionalBoolean('form field', props, 'canChooseFiles');
    if (canChooseFiles !== undefined) field.canChooseFiles = canChooseFiles;
    const canChooseDirectories = optionalBoolean('form field', props, 'canChooseDirectories');
    if (canChooseDirectories !== undefined) field.canChooseDirectories = canChooseDirectories;
    const allowMultipleSelection = optionalBoolean('form field', props, 'allowMultipleSelection');
    if (allowMultipleSelection !== undefined) field.allowMultipleSelection = allowMultipleSelection;
  }
  return field;
}

function serializeEmptyView(node: HostNode): UiEmptyView {
  checkProps('empty-view', node.props, EMPTY_VIEW_ALLOWED);
  const view: UiEmptyView = { title: requireString('empty-view', node.props, 'title') };
  const description = optionalString('empty-view', node.props, 'description');
  if (description !== undefined) view.description = description;
  return view;
}

function serializeActions(actionsValue: unknown, state: SerializeState): UiAction[] {
  const actions: UiAction[] = [];
  visitActions(actionsValue, actions, state);
  return actions;
}

function visitActions(node: unknown, out: UiAction[], state: SerializeState): void {
  for (const child of flattenElements(node)) {
    if (!isElement(child)) {
      throw new ReactUiError(
        `actions prop children must be <ActionPanel> or <Action>, got ${describeNode(child)}`,
      );
    }
    if (isFragment(child)) {
      visitActions(child.props['children'], out, state);
      continue;
    }
    const intrinsic = requireIntrinsic(child.type, 'actions prop children');
    if (intrinsic === 'action-panel') {
      const panelProps = child.props as Record<string, unknown>;
      checkProps('action-panel', panelProps, ACTION_PANEL_ALLOWED);
      visitActions(panelProps['children'], out, state);
      continue;
    }
    if (intrinsic === 'action') {
      out.push(serializeActionElement(child, state));
      continue;
    }
    throw new ReactUiError(
      `actions prop children must be <ActionPanel> or <Action>, got <${String(child.type)}>`,
    );
  }
}

function serializeActionElement(
  element: ReactElement<Record<string, unknown>>,
  state: SerializeState,
): UiAction {
  const props = element.props;
  checkProps('action', props, ACTION_ALLOWED);
  const title = requireString('action', props, 'title');
  const onAction = props['onAction'];
  if (typeof onAction !== 'function') {
    throw new ReactUiError(`<action> requires a function prop 'onAction'`);
  }
  const primary = optionalBoolean('action', props, 'primary');
  const push = optionalString('action', props, 'push');
  if (push !== undefined && push.length === 0) {
    throw new ReactUiError(`<action> prop 'push' must be a non-empty sub-view key`);
  }
  const style = props['style'];
  if (style !== undefined && style !== 'destructive') {
    throw new ReactUiError(`<action> prop 'style' must be 'destructive'`);
  }
  const shortcut = optionalShortcut(props);
  const extras = {
    primary,
    push,
    style: style as UiAction['style'],
    shortcut,
  };
  const explicitId = optionalString('action', props, 'id');
  if (explicitId !== undefined) {
    if (explicitId === '__open__') {
      throw new ReactUiError(
        `action id '__open__' is reserved by the shell; choose a different id for '${title}'`,
      );
    }
    if (state.seenActionIds.has(explicitId)) {
      throw new ReactUiError(`duplicate action id '${explicitId}' in tree`);
    }
    state.seenActionIds.add(explicitId);
    state.registry.registerExplicit(explicitId, onAction as ActionHandler);
    return finishAction({ id: explicitId, title }, extras);
  }
  return finishAction({ id: state.registry.register(onAction as ActionHandler), title }, extras);
}

function finishAction(
  action: UiAction,
  extras: {
    primary?: boolean;
    push?: string;
    style?: UiAction['style'];
    shortcut?: UiAction['shortcut'];
  },
): UiAction {
  if (extras.primary === true) action.primary = true;
  if (extras.push !== undefined) action.push = extras.push;
  if (extras.style !== undefined) action.style = extras.style;
  if (extras.shortcut !== undefined) action.shortcut = extras.shortcut;
  return action;
}

function optionalShortcut(props: Record<string, unknown>): UiAction['shortcut'] {
  const value = props['shortcut'];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { key?: unknown }).key !== 'string' ||
    (value as { key?: string }).key!.length === 0
  ) {
    throw new ReactUiError(
      `<action> prop 'shortcut' must be { key: string, modifiers?: string[] }`,
    );
  }
  const { key, modifiers } = value as { key: string; modifiers?: unknown };
  const shortcut: { key: string; modifiers?: string[] } = { key };
  if (modifiers !== undefined) {
    if (
      !Array.isArray(modifiers) ||
      modifiers.some((m) => typeof m !== 'string' || m.length === 0)
    ) {
      throw new ReactUiError(
        `<action> prop 'shortcut' modifiers must be an array of non-empty strings`,
      );
    }
    shortcut.modifiers = modifiers as string[];
  }
  return shortcut;
}

function flattenElements(node: unknown): unknown[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => flattenElements(child));
  return [node];
}

function isElement(value: unknown): value is ReactElement<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    'props' in value &&
    'type' in value
  );
}

function isFragment(element: ReactElement): boolean {
  return (element.type as unknown) === (Fragment as unknown);
}

function describeNode(node: unknown): string {
  if (typeof node === 'string') return `the string "${node.slice(0, 40)}"`;
  if (node === null || node === undefined) return String(node);
  if (typeof node === 'object' && 'type' in node) {
    return `<${String((node as { type: unknown }).type)}>`;
  }
  return typeof node;
}
