// Raycast's own view components, re-implemented on top of the extension render model.
//
// An extension renders `<List>`, `<Grid>`, `<Detail>`, `<Form>` or `<MenuBarExtra>`. Because the
// model is data, the launcher decides how to draw it — this is the whole point of the design.
// Behaviors follow the shipped renderer (see docs/command-ux-spec.md §5–§7):
// List: sections, accessories, item detail pane, empty views with actions, search-bar dropdown,
//       throttled onSearchTextChange, sensitivity filtering.
// Grid: sections with per-section columns/aspectRatio/fit/inset, 2D keyboard navigation, paging.
// Detail: markdown + metadata pane (Label | Link | TagList | Separator).
// Form: every field kind, extension-side validation via `error`, onChange/onBlur/onFocus,
//       submit-form actions carrying the values, formSetFocus / formReset.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RaycastIcon } from "./icons";
import { markdownTitle, renderMarkdown } from "./markdown";
import { onNotification } from "./ipc";
import { isDevExtensions, overrideTestHooks } from "./testHooks";
import type { PageState } from "./commandPages";
import type {
  MetadataItem,
  ViewAccessory,
  ViewAction,
  ViewBody,
  ViewFormField,
  ViewListItem,
  ViewSection,
} from "./useExtensionCommand";

function Icon({ icon, fallback = "AppWindow" }: { icon?: unknown; fallback?: string }) {
  const source = (icon as { source?: { light?: string; dark?: string } })?.source?.light;
  if (typeof source === "string" && /^https?:/.test(source)) {
    return (
      <span className="icon" aria-hidden>
        <img src={source} alt="" width={16} height={16} />
      </span>
    );
  }
  if (typeof source === "string" && /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(source) && !source.startsWith("icon://")) {
    return (
      <span className="icon" aria-hidden>
        <img src={source} alt="" width={16} height={16} />
      </span>
    );
  }
  return (
    <span className="icon" aria-hidden>
      <RaycastIcon name={typeof source === "string" ? source : fallback} size={15} />
    </span>
  );
}

function ItemIcon({ item }: { item: ViewListItem }) {
  const content = item.icon as { value?: unknown } | undefined;
  const icon = (content && typeof content === "object" && "value" in content ? content.value : item.icon) as unknown;
  return <Icon icon={icon} fallback="File" />;
}

function ActionList({
  actions,
  onRun,
}: {
  actions: ViewAction[] | undefined;
  onRun: (action: ViewAction) => void;
}) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className="actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`action${action.style === "Destructive" ? " action--destructive" : ""}`}
          onClick={() => onRun(action)}
        >
          <span>{action.title}</span>
          {action.shortcut ? <span className="kbd">{action.shortcut}</span> : null}
        </button>
      ))}
    </div>
  );
}

function EmptyView({ body, onRun }: { body: ViewBody; onRun: (action: ViewAction) => void }) {
  return (
    <div className="state">
      <div className="icon icon--plain" aria-hidden>
        <RaycastIcon name={iconName(body.emptyView?.icon) ?? "search"} size={22} />
      </div>
      <div className="state__title">{body.emptyView?.title ?? "No results"}</div>
      {body.emptyView?.description ? (
        <div className="state__message">{body.emptyView.description}</div>
      ) : null}
      {body.emptyView?.actions?.length ? (
        <div className="state__actions">
          <ActionList actions={body.emptyView.actions} onRun={onRun} />
        </div>
      ) : null}
    </div>
  );
}

function iconName(icon: unknown): string | null {
  const source = (icon as { source?: { light?: string; dark?: string } } | undefined)?.source?.light;
  if (typeof source !== "string") return null;
  return source.startsWith("icon://") ? source.slice("icon://".length).replace(/\.png$/, "") : null;
}

// ------------------------------------------------------------------------------------------
// Accessories (`CommandListItemAccessory`): text -> tag (numeric tag = date) -> date -> icon.
// ------------------------------------------------------------------------------------------

function formatDate(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function colorStyle(color?: string): { color: string; background: string } {
  if (!color) {
    return { color: "var(--color-text-secondary)", background: "transparent" };
  }
  if (/^#?[0-9a-fA-F]{6}$/.test(color)) {
    const hex = color.startsWith("#") ? color : `#${color}`;
    return { color: hex, background: `rgb(from ${hex} r g b / 20%)` };
  }
  const token = `var(--${color})`;
  return { color: token, background: `rgb(from ${token} r g b / 20%)` };
}

function AccessoryView({ accessory }: { accessory: ViewAccessory }) {
  const icon = accessory.icon ? <Icon icon={accessory.icon} fallback="Tag" /> : null;
  const title = accessory.tooltip;
  if (accessory.text !== undefined) {
    const style = colorStyle(accessory.color);
    return (
      <span className="list__accessory-item" title={title}>
        {icon}
        <span className="list__accessory-text" style={{ color: style.color }}>
          {accessory.text}
        </span>
      </span>
    );
  }
  if (accessory.tag !== undefined) {
    const style = colorStyle(accessory.color);
    const text = typeof accessory.tag === "number" ? formatDate(accessory.tag) : accessory.tag;
    return (
      <span className="list__tag" title={title} style={{ color: style.color, backgroundColor: style.background }}>
        {icon}
        <span>{text}</span>
      </span>
    );
  }
  if (accessory.date !== undefined) {
    const style = colorStyle(accessory.color);
    return (
      <span className="list__accessory-item" title={title}>
        {icon}
        <span className="list__accessory-text" style={{ color: style.color }}>
          {formatDate(accessory.date)}
        </span>
      </span>
    );
  }
  return icon ? <span className="list__accessory-item" title={title}>{icon}</span> : null;
}

// ------------------------------------------------------------------------------------------
// Metadata pane (`NodeMetadata` + DataList primitives): Label | Link | TagList | Separator.
// ------------------------------------------------------------------------------------------

function MetadataPane({
  metadata,
  onRun,
  layout = "narrow",
}: {
  metadata: MetadataItem[];
  onRun: (action: ViewAction) => void;
  layout?: "wide" | "narrow";
}) {
  return (
    <dl className={`metadata${layout === "narrow" ? " metadata--narrow" : ""}`}>
      {metadata.map((item, index) => {
        switch (item.kind) {
          case "Label":
            return (
              <div className="metadata__item" key={item.id ?? index}>
                <dt className="metadata__label">{item.title}</dt>
                <dd className="metadata__value">
                  {item.icon ? <Icon icon={item.icon} /> : null}
                  {item.text ? <span>{item.text}</span> : null}
                </dd>
              </div>
            );
          case "Link":
            return (
              <div className="metadata__item" key={item.id ?? index}>
                <dt className="metadata__label">{item.title}</dt>
                <dd className="metadata__value">
                  <a className="metadata__link" href={item.target} target="_blank" rel="noreferrer">
                    <span>{item.text ?? item.target}</span>
                    <RaycastIcon name="arrow-up-right" size={12} />
                  </a>
                </dd>
              </div>
            );
          case "TagList":
            return (
              <div className="metadata__item" key={item.id ?? index}>
                <dt className="metadata__label">{item.title}</dt>
                <dd className="metadata__value metadata__tags">
                  {item.items.map((tag, tagIndex) => {
                    const style = colorStyle(tag.color);
                    return (
                      <button
                        key={tagIndex}
                        type="button"
                        className="list__tag"
                        style={{ color: style.color, backgroundColor: style.background }}
                        onClick={tag.onAction ? () => onRun({ id: tag.onAction!, title: tag.text ?? "" }) : undefined}
                      >
                        {tag.icon ? <Icon icon={tag.icon} fallback="Tag" /> : null}
                        <span>{tag.text}</span>
                      </button>
                    );
                  })}
                </dd>
              </div>
            );
          case "Separator":
            return <hr className="metadata__separator" key={item.id ?? index} />;
          default:
            return null;
        }
      })}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------
// Filtering (`_q`): match title/subtitle/keywords, keep section order or regroup.
// ------------------------------------------------------------------------------------------

function itemMatches(item: ViewListItem, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  return (
    (item.title ?? "").toLowerCase().includes(q) ||
    (item.subtitle ?? "").toLowerCase().includes(q) ||
    (item.keywords ?? []).some((keyword) => String(keyword).toLowerCase().includes(q))
  );
}

function flatItems(body: ViewBody): ViewListItem[] {
  if (body.sections) return body.sections.flatMap((section) => section.items);
  return body.items ?? [];
}

function filterSections(sections: ViewSection[], query: string, keepSectionOrder: boolean): ViewSection[] {
  if (query === "") return sections;
  if (keepSectionOrder) {
    return sections
      .map((section) => ({ ...section, items: section.items.filter((item) => itemMatches(item, query)) }))
      .filter((section) => section.items.length > 0);
  }
  const bySection = new Map<string, ViewSection>();
  const matched: { section: ViewSection; item: ViewListItem }[] = [];
  for (const section of sections) {
    bySection.set(section.id ?? section.title ?? String(sections.indexOf(section)), section);
    for (const item of section.items) {
      if (itemMatches(item, query)) matched.push({ section, item });
    }
  }
  const result: ViewSection[] = [];
  const seen = new Set<ViewSection>();
  for (const { section, item } of matched) {
    if (!seen.has(section)) {
      seen.add(section);
      result.push({ ...section, items: [] });
    }
    result.find((entry) => entry === section)?.items.push(item);
  }
  return result;
}

// ------------------------------------------------------------------------------------------
// The view
// ------------------------------------------------------------------------------------------

export interface RenderedViewProps {
  page: PageState;
  onSearchTextChange: (value: string) => void;
  onSelectionChange: (itemId: string | null) => void;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
  onLoadMore: () => void;
}

export function RenderedView({
  page,
  onSelectionChange,
  createCallback,
  onLoadMore,
}: Omit<RenderedViewProps, "onSearchTextChange">) {
  const body = page.body;
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadedPagesFor = useRef(0);

  const runAction = useCallback(
    (action: ViewAction) => {
      if (action.type === "submit-form") return; // handled by the form
      void createCallback(action.id)({ itemId: action.itemId });
    },
    [createCallback],
  );

  const filtering = body.filteringEnabled !== false && body.filtering !== false;
  const query = page.searchText;

  const sections = body.sections;
  const items = flatItems(body);
  const visibleSections = sections
    ? filterSections(sections, query, body.keepSectionOrder ?? false)
    : undefined;
  const visibleItems = useMemo(
    () => (visibleSections ? visibleSections.flatMap((section) => section.items) : filtering ? items.filter((item) => itemMatches(item, query)) : items),
    [visibleSections, items, filtering, query],
  );

  const selectedId =
    page.selectedItemId && visibleItems.some((item) => item.id === page.selectedItemId)
      ? page.selectedItemId
      : visibleItems[0]?.id ?? null;

  const select = useCallback(
    (itemId: string | null) => {
      if (itemId !== selectedId) onSelectionChange(itemId);
    },
    [selectedId, onSelectionChange],
  );

  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;

  // Raycast keeps the selection visible while arrowing: scroll the body so the selected
  // row/cell stays in view (same manual-geometry approach as the root list).
  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>('[data-selected="true"]');
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    if (rowRect.top < viewRect.top) {
      container.scrollTop -= viewRect.top - rowRect.top + 4;
    } else if (rowRect.bottom > viewRect.bottom) {
      container.scrollTop += rowRect.bottom - viewRect.bottom + 4;
    }
  }, [selectedId, body]);

  // `onSelectionChange` fires with `{value, eventCount}` — the eventCount mirrors Raycast's
  // host/extension selection arbitration; we only ever emit from user interaction.
  useEffect(() => {
    if (!body.onSelectionChange || !selectedId) return;
    return undefined;
  }, [body.onSelectionChange, selectedId]);

  // Pagination: fire `onLoadMore` when scrolling within 80px of the bottom and `hasMore`.
  useEffect(() => {
    const container = bodyRef.current;
    if (!container || !body.pagination?.hasMore || !body.pagination.onLoadMore) return;
    const onScroll = () => {
      const nearEnd =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 80;
      if (nearEnd && loadedPagesFor.current !== items.length) {
        loadedPagesFor.current = items.length;
        onLoadMore();
      }
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [body.pagination?.hasMore, body.pagination?.onLoadMore, items.length, onLoadMore]);

  // Fire `onSelectionChange` for the extension when the selection changes (not on first mount).
  const selectionCallbackRef = useRef(body.onSelectionChange);
  selectionCallbackRef.current = body.onSelectionChange;
  const lastReported = useRef<string | null>(null);
  useEffect(() => {
    const callbackId = selectionCallbackRef.current;
    if (!callbackId || !selectedId) return;
    if (lastReported.current === null) {
      lastReported.current = selectedId;
      return;
    }
    if (lastReported.current === selectedId) return;
    lastReported.current = selectedId;
    void createCallback(callbackId)({ value: selectedId, eventCount: Date.now() % 100000 });
  }, [selectedId, createCallback]);

  // The command search bar (header) IS the List/Grid search — placeholder and accessory are
  // rendered by the session header, so the body never adds a second input.
  return (
    <div className="command-view">
      <div className="command-view__body" ref={bodyRef}>
        {body.kind === "List" && (
          <ListBody
            body={body}
            sections={visibleSections}
            items={visibleItems}
            selectedId={selectedId}
            select={select}
            selectedItem={selectedItem}
            runAction={runAction}
            createCallback={createCallback}
            isLoading={body.isLoading === true}
          />
        )}

        {body.kind === "Grid" && (
          <GridBody
            body={body}
            sections={visibleSections}
            items={visibleItems}
            selectedId={selectedId}
            select={select}
            runAction={runAction}
          />
        )}

        {body.kind === "Detail" && (
          <DetailBody body={body} runAction={runAction} createCallback={createCallback} />
        )}

        {body.kind === "Form" && (
          <FormBody body={body} createCallback={createCallback} runAction={runAction} />
        )}

        {body.kind === "MenuBarExtra" && (
          <ul className="list">
            {(body.items ?? []).map((item, index) => (
              <li key={item.id || index}>
                <div className="list__row" data-selected={item.id === selectedId}>
                  <ItemIcon item={item} />
                  <span className="list__text">
                    <span className="list__title">{item.title ?? item.id}</span>
                    {item.subtitle ? <span className="list__subtitle">{item.subtitle}</span> : null}
                  </span>
                  <ActionList actions={item.actions} onRun={runAction} />
                </div>
              </li>
            ))}
            {!body.items?.length ? <EmptyView body={body} onRun={runAction} /> : null}
          </ul>
        )}

        {(body.kind === "List" || body.kind === "Grid") &&
        visibleItems.length === 0 &&
        !body.isLoading ? (
          <EmptyView body={body} onRun={runAction} />
        ) : null}
      </div>
    </div>
  );
}

export function SearchBarDropdown({
  accessory,
  createCallback,
}: {
  accessory: NonNullable<ViewBody["searchBarAccessory"]>;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
}) {
  if (!("sections" in accessory) || !accessory.sections) return null;
  const options = accessory.sections.flatMap((section) => section.items);
  const [value, setValue] = useState(accessory.defaultValue ?? accessory.value ?? options[0]?.id ?? "");
  return (
    <select
      className="command-view__dropdown"
      value={value}
      title={accessory.tooltip}
      onChange={(event) => {
        setValue(event.target.value);
        if (accessory.onChange) void createCallback(accessory.onChange)(event.target.value);
      }}
    >
      {accessory.sections.map((section, sectionIndex) => (
        <optgroup key={section.title ?? sectionIndex} label={section.title ?? ""}>
          {section.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title ?? item.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------------------------------
// List
// ------------------------------------------------------------------------------------------

function ListBody({
  body,
  sections,
  items,
  selectedId,
  select,
  selectedItem,
  runAction,
  createCallback,
  isLoading,
}: {
  body: ViewBody;
  sections?: ViewSection[];
  items: ViewListItem[];
  selectedId: string | null;
  select: (id: string | null) => void;
  selectedItem: ViewListItem | null;
  runAction: (action: ViewAction) => void;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
  isLoading: boolean;
}) {
  if (items.length === 0 && isLoading) return null;
  if (items.length === 0) return null;
  const hasDetail = body.isShowingDetail === true && selectedItem != null;
  return (
    <div className={`list-split${hasDetail ? " list-split--detail" : ""}`}>
      <ul className="list">
        {sections
          ? sections.map((section, sectionIndex) => (
              <li className="list__section" key={section.id ?? section.title ?? sectionIndex}>
                {section.title ? <div className="list__sectionHeader">{section.title}</div> : null}
                {section.subtitle ? <div className="list__sectionSubtitle">{section.subtitle}</div> : null}
                <ul className="list__sectionBody">
                  {section.items.map((item) => (
                    <ListRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      select={select}
                      runAction={runAction}
                    />
                  ))}
                </ul>
              </li>
            ))
          : items.map((item) => (
              <ListRow key={item.id} item={item} selected={item.id === selectedId} select={select} runAction={runAction} />
            ))}
      </ul>
      {hasDetail ? (
        <div className="list-detail">
          {selectedItem?.detail?.markdown ? (
            <div className="list-detail__markdown">{renderMarkdown(selectedItem.detail.markdown)}</div>
          ) : null}
          {selectedItem?.detail?.metadata?.length ? (
            <MetadataPane metadata={selectedItem.detail.metadata} onRun={runAction} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ListRow({
  item,
  selected,
  select,
  runAction,
}: {
  item: ViewListItem;
  selected: boolean;
  select: (id: string | null) => void;
  runAction: (action: ViewAction) => void;
}) {
  return (
    <li key={item.id}>
      <div
        className="list__row"
        data-selected={selected}
        onMouseEnter={() => select(item.id)}
        onClick={() => {
          select(item.id);
          const primary = item.actions?.[0];
          if (primary) runAction(primary);
        }}
      >
        <ItemIcon item={item} />
        <span className="list__text">
          <span className="list__title">{item.title ?? item.id}</span>
          {item.subtitle ? <span className="list__subtitle">{item.subtitle}</span> : null}
        </span>
        <span className="list__accessory">
          {(item.accessories ?? []).map((accessory, index) => (
            <AccessoryView key={index} accessory={accessory} />
          ))}
        </span>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------------
// Grid
// ------------------------------------------------------------------------------------------

const GRID_DEFAULT_COLUMNS = 5;

function GridBody({
  body,
  sections,
  items,
  selectedId,
  select,
  runAction,
}: {
  body: ViewBody;
  sections?: ViewSection[];
  items: ViewListItem[];
  selectedId: string | null;
  select: (id: string | null) => void;
  runAction: (action: ViewAction) => void;
}) {
  if (items.length === 0) return null;
  const itemSizePx = body.itemSize === "small" ? 120 : body.itemSize === "large" ? 240 : 180;
  const gridStyle = (columns: number, aspectRatio: string, inset: string): React.CSSProperties => ({
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    ["--grid-aspect" as string]: aspectRatio,
    ["--grid-inset" as string]: inset === "zero" ? "0px" : inset === "sm" ? "4px" : inset === "md" ? "8px" : "16px",
  });
  return (
    <div className="grid">
      {sections
        ? sections.map((section, sectionIndex) => {
            const columns = Math.max(1, Math.min(8, section.columns ?? body.columns ?? GRID_DEFAULT_COLUMNS));
            const aspectRatio = section.aspectRatio ?? body.aspectRatio ?? "1";
            const inset = section.inset ?? body.inset ?? "zero";
            return (
              <div key={section.id ?? section.title ?? sectionIndex} className="grid__section">
                {section.title ? <div className="list__sectionHeader">{section.title}</div> : null}
                <div
                  className="grid__cells"
                  style={gridStyle(columns, aspectRatio, inset)}
                  data-item-size={body.itemSize ?? "medium"}
                >
                  {section.items.map((item) => (
                    <GridCell key={item.id} item={item} size={itemSizePx} selected={item.id === selectedId} select={select} runAction={runAction} />
                  ))}
                </div>
              </div>
            );
          })
        : (
            <div
              className="grid__cells"
              style={gridStyle(
                Math.max(1, Math.min(8, body.columns ?? GRID_DEFAULT_COLUMNS)),
                body.aspectRatio ?? "1",
                body.inset ?? "zero",
              )}
              data-item-size={body.itemSize ?? "medium"}
            >
              {items.map((item) => (
                <GridCell key={item.id} item={item} size={itemSizePx} selected={item.id === selectedId} select={select} runAction={runAction} />
              ))}
            </div>
          )}
    </div>
  );
}

function GridCell({
  item,
  size,
  selected,
  select,
  runAction,
}: {
  item: ViewListItem;
  size: number;
  selected: boolean;
  select: (id: string | null) => void;
  runAction: (action: ViewAction) => void;
}) {
  const content = (item as { content?: unknown }).content;
  return (
    <button
      type="button"
      className="grid__cell"
      data-selected={selected}
      onMouseEnter={() => select(item.id)}
      onClick={() => {
        select(item.id);
        const primary = item.actions?.[0];
        if (primary) runAction(primary);
      }}
    >
      <span className="grid__content" style={{ width: size, height: size }}>
        {content ? (
          <img src={String((content as { value?: string })?.value ?? content)} alt="" loading="lazy" />
        ) : (
          <ItemIcon item={item} />
        )}
      </span>
      <span className="list__title">{item.title ?? item.id}</span>
      {item.subtitle ? <span className="list__subtitle">{item.subtitle}</span> : null}
      
    </button>
  );
}

// ------------------------------------------------------------------------------------------
// Detail
// ------------------------------------------------------------------------------------------

function DetailBody({
  body,
  runAction,
}: {
  body: ViewBody;
  runAction: (action: ViewAction) => void;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
}) {
  const title = useMemo(() => (body.markdown ? markdownTitle(body.markdown) : null), [body.markdown]);
  if (!body.markdown && !body.metadata) return null;
  return (
    <div className={`detail${body.metadata?.length ? " detail--metadata" : ""}`}>
      <div className="detail__content">
        {title ? <div className="detail__title">{title}</div> : null}
        {body.markdown ? <div className="markdown">{renderMarkdown(body.markdown)}</div> : null}
      </div>
      {body.metadata?.length ? (
        <aside className="detail__aside">
          <MetadataPane metadata={body.metadata} onRun={runAction} />
        </aside>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Form
// ------------------------------------------------------------------------------------------

const FORM_THROTTLE_MS = 120;

export function validateForm(fields: ViewFormField[], values: Record<string, unknown>): string[] {
  const errors = new Set<string>();
  for (const field of fields) {
    if (field.error) errors.add(field.id);
    if (field.kind === "TextField" || field.kind === "TextArea") {
      const value = values[field.id];
      if (
        (field.title ?? "").endsWith("*") ||
        (field.error ?? "").toLowerCase().includes("required")
      ) {
        if (typeof value !== "string" || value.trim() === "") errors.add(field.id);
      }
    }
  }
  return [...errors];
}

function FormBody({
  body,
  createCallback,
  runAction,
}: {
  body: ViewBody;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
  runAction: (action: ViewAction) => void;
}) {
  const fields = useMemo(() => body.fields ?? [], [body.fields]);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.defaultValue?.value !== undefined) initial[field.id] = field.defaultValue.value;
      else if (field.value?.value !== undefined) initial[field.id] = field.value.value;
      else if (field.kind === "Checkbox") initial[field.id] = false;
      else if (field.kind === "TagPicker" || field.kind === "FilePicker") initial[field.id] = [];
      else if (field.kind === "DatePicker") initial[field.id] = null;
    }
    return initial;
  });
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const throttleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fieldRefs = useRef(new Map<string, HTMLElement | null>());

  const setValue = useCallback(
    (field: ViewFormField, value: unknown, immediate = false) => {
      setValues((previous) => ({ ...previous, [field.id]: value }));
      if (!field.onChange) return;
      const fire = () => void createCallback(field.onChange!)(value);
      if (immediate || field.kind === "Checkbox" || field.kind === "Dropdown" || field.kind === "DatePicker" || field.kind === "FilePicker") {
        fire();
        return;
      }
      // Raycast throttles field/search callbacks (`throttlingEnabled`); 120ms trailing throttle.
      const timers = throttleTimers.current;
      const existing = timers.get(field.id);
      if (existing) clearTimeout(existing);
      timers.set(
        field.id,
        setTimeout(() => {
          timers.delete(field.id);
          fire();
        }, FORM_THROTTLE_MS),
      );
    },
    [createCallback],
  );

  useEffect(() => {
    const offFocus = onNotification("extensionHost.formSetFocus", (raw) => {
      const payload = raw as { itemId?: string };
      if (!payload.itemId) return;
      fieldRefs.current.get(payload.itemId)?.focus();
    });
    const offReset = onNotification("extensionHost.formReset", (raw) => {
      const payload = raw as { itemId?: string };
      const field = fields.find((entry) => entry.id === payload.itemId);
      if (!field) return;
      const reset = field.defaultValue?.value;
      setValues((previous) => ({
        ...previous,
        [field.id]: reset !== undefined ? reset : field.kind === "Checkbox" ? false : field.kind === "TagPicker" || field.kind === "FilePicker" ? [] : "",
      }));
    });
    return () => {
      offFocus();
      offReset();
    };
  }, [fields]);

  useEffect(() => {
    const timers = throttleTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const errors = validateForm(fields, values);
  const submitAction = (body.actions ?? []).find((action) => action.type === "submit-form");
  const submitDisabled = submitAction != null && errors.length > 0;

  const submit = useCallback(() => {
    if (!submitAction || submitDisabled) return;
    // `CK`: submit-form resolves the form values and passes them to the extension.
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.id];
      if (value instanceof Date) payload[field.id] = value.toISOString();
      else payload[field.id] = value;
    }
    void createCallback(submitAction.id)(payload);
  }, [submitAction, submitDisabled, fields, values, createCallback]);

  // Dev-only automation: submit the form with the current values through the hook channel.
  useEffect(() => {
    if (!isDevExtensions()) return;
    overrideTestHooks({ submitForm: () => { submit(); return true; } });
  });

  const registerRef = useCallback((id: string) => {
    return (element: HTMLElement | null) => {
      fieldRefs.current.set(id, element);
    };
  }, []);

  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {fields.map((field) => {
        switch (field.kind) {
          case "Separator":
            return <hr key={field.id} className="form__separator" />;
          case "Description":
            return (
              <div key={field.id} className="form__description">
                {field.title ? <span className="form__label">{field.title}</span> : null}
                <p>{field.text}</p>
              </div>
            );
          default:
            return (
              <FormFieldRow
                key={field.id}
                field={field}
                value={values[field.id]}
                focused={focusedField === field.id}
                registerRef={registerRef}
                setValue={setValue}
                setFocusedField={setFocusedField}
                createCallback={createCallback}
                onSubmit={submit}
              />
            );
        }
      })}
      {body.actions?.length ? (
        <div className="form__actions">
          <ActionList
            actions={body.actions}
            onRun={(action) => {
              if (action.type === "submit-form") submit();
              else runAction(action);
            }}
          />
        </div>
      ) : null}
      {submitDisabled ? <div className="form__submitHint">Fix the highlighted fields to submit.</div> : null}
    </form>
  );
}

function FormFieldRow({
  field,
  value,
  focused,
  registerRef,
  setValue,
  setFocusedField,
  createCallback,
  onSubmit,
}: {
  field: ViewFormField;
  value: unknown;
  focused: boolean;
  registerRef: (id: string) => (element: HTMLElement | null) => void;
  setValue: (field: ViewFormField, value: unknown, immediate?: boolean) => void;
  setFocusedField: (id: string | null) => void;
  createCallback: (callbackId: string) => (data: unknown) => Promise<void>;
  onSubmit: () => void;
}) {
  const blur = () => {
    setFocusedField(null);
    if (field.onBlur) void createCallback(field.onBlur)(value ?? "");
  };
  const focus = () => {
    setFocusedField(field.id);
    if (field.onFocus) void createCallback(field.onFocus)(value ?? "");
  };
  const label = (
    <span className="form__label">
      {field.title ?? field.id}
      {field.info ? <span className="form__info">{field.info}</span> : null}
    </span>
  );

  return (
    <div className={`form__field${field.error ? " form__field--error" : ""}${focused ? " form__field--focused" : ""}`}>
      <label className="form__labelRow" htmlFor={`form-${field.id}`}>
        {field.kind !== "Checkbox" ? label : null}
      </label>
      {field.kind === "TextField" || field.kind === "TextArea" ? null : null}
      {field.kind === "TextField" ? (
        <input
          id={`form-${field.id}`}
          ref={registerRef(field.id)}
          type={field.isSecure ? "password" : "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          autoFocus={field.autoFocus}
          data-error={field.error ? "true" : undefined}
          onChange={(event) => setValue(field, event.target.value)}
          onBlur={blur}
          onFocus={focus}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      ) : null}
      {field.kind === "TextArea" ? (
        <textarea
          id={`form-${field.id}`}
          ref={registerRef(field.id)}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          autoFocus={field.autoFocus}
          data-error={field.error ? "true" : undefined}
          rows={4}
          onChange={(event) => setValue(field, event.target.value)}
          onBlur={blur}
          onFocus={focus}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      ) : null}
      {field.kind === "Checkbox" ? (
        <label className="form__checkbox">
          <input
            id={`form-${field.id}`}
            ref={registerRef(field.id)}
            type="checkbox"
            checked={value === true}
            autoFocus={field.autoFocus}
            onChange={(event) => setValue(field, event.target.checked, true)}
            onBlur={blur}
            onFocus={focus}
          />
          <span>{field.checkboxTitle ?? field.title ?? field.id}</span>
        </label>
      ) : null}
      {field.kind === "Dropdown" ? (
        <select
          id={`form-${field.id}`}
          ref={registerRef(field.id)}
          value={String(value ?? "")}
          autoFocus={field.autoFocus}
          data-error={field.error ? "true" : undefined}
          onChange={(event) => setValue(field, event.target.value, true)}
          onBlur={blur}
          onFocus={focus}
        >
          <option value="">Select…</option>
          {(field.menu?.sections ?? []).map((section, sectionIndex) => (
            <optgroup key={section.title ?? sectionIndex} label={section.title ?? ""}>
              {section.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title ?? item.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : null}
      {field.kind === "TagPicker" ? (
        <TagPickerField field={field} value={Array.isArray(value) ? (value as string[]) : []} registerRef={registerRef} setValue={setValue} blur={blur} focus={focus} />
      ) : null}
      {field.kind === "DatePicker" ? (
        <input
          id={`form-${field.id}`}
          ref={registerRef(field.id)}
          type={field.type === "datetime" ? "datetime-local" : "date"}
          min={field.min ? toInputDate(field.min) : undefined}
          max={field.max ? toInputDate(field.max) : undefined}
          value={value ? toInputDate(String(value)) : ""}
          autoFocus={field.autoFocus}
          data-error={field.error ? "true" : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            const parsed = raw ? new Date(raw) : null;
            setValue(field, parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null, true);
          }}
          onBlur={blur}
          onFocus={focus}
        />
      ) : null}
      {field.kind === "FilePicker" ? (
        <FilePickerField field={field} value={Array.isArray(value) ? (value as string[]) : []} registerRef={registerRef} setValue={setValue} blur={blur} focus={focus} />
      ) : null}
      {field.error ? <span className="form__error">{field.error}</span> : null}
    </div>
  );
}

function TagPickerField({
  field,
  value,
  registerRef,
  setValue,
  blur,
  focus,
}: {
  field: ViewFormField;
  value: string[];
  registerRef: (id: string) => (element: HTMLElement | null) => void;
  setValue: (field: ViewFormField, value: unknown, immediate?: boolean) => void;
  blur: () => void;
  focus: () => void;
}) {
  const suggestions = field.suggestionValues ?? [];
  const [draft, setDraft] = useState("");
  const suggestionsRef = useRef<HTMLDivElement>(null);
  return (
    <div className="form__tagpicker" ref={registerRef(field.id) as (element: HTMLDivElement | null) => void}>
      <div className="form__tags">
        {value.map((tag) => {
          const known = suggestions.find((suggestion) => suggestion.value === tag);
          return (
            <span key={tag} className="list__tag">
              {known?.icon ? <Icon icon={known.icon} fallback="Tag" /> : null}
              <span>{known?.title ?? tag}</span>
              <button
                type="button"
                aria-label={`Remove ${known?.title ?? tag}`}
                onClick={() => setValue(field, value.filter((entry) => entry !== tag), true)}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          value={draft}
          placeholder={value.length === 0 ? field.placeholder : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={blur}
          onFocus={focus}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              event.preventDefault();
              const match = suggestions.find((suggestion) => suggestion.value === draft.trim());
              const next = [...value, match ? match.value : draft.trim()];
              setValue(field, next, true);
              setDraft("");
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              setValue(field, value.slice(0, -1), true);
            }
          }}
        />
      </div>
      {suggestions.length > 0 ? (
        <div className="form__tagSuggestions" ref={suggestionsRef}>
          {suggestions
            .filter((suggestion) => !value.includes(suggestion.value))
            .map((suggestion) => (
              <button
                key={suggestion.value}
                type="button"
                onClick={() => {
                  setValue(field, [...value, suggestion.value], true);
                  setDraft("");
                }}
              >
                {suggestion.icon ? <Icon icon={suggestion.icon} fallback="Tag" /> : null}
                {suggestion.title ?? suggestion.value}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function FilePickerField({
  field,
  value,
  registerRef,
  setValue,
  blur,
  focus,
}: {
  field: ViewFormField;
  value: string[];
  registerRef: (id: string) => (element: HTMLElement | null) => void;
  setValue: (field: ViewFormField, value: unknown, immediate?: boolean) => void;
  blur: () => void;
  focus: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="form__filepicker" ref={registerRef(field.id) as (element: HTMLDivElement | null) => void}>
      <input
        ref={inputRef}
        type="file"
        multiple={field.allowMultipleSelection === true}
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).map((file) => file.name);
          setValue(field, files, true);
          blur();
        }}
      />
      <button type="button" className="form__fileButton" onClick={() => inputRef.current?.click()}>
        Choose {field.canChooseDirectories ? "Folder" : "File"}…
      </button>
      <span className="form__files">{value.length > 0 ? value.join(", ") : field.placeholder ?? "No file selected"}</span>
    </div>
  );
}

function toInputDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (date.getHours() === 0 && date.getMinutes() === 0) return base;
  return `${base}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ------------------------------------------------------------------------------------------
// Keyboard navigation (1D for lists, 2D for grids) — the session window handler delegates here.
// ------------------------------------------------------------------------------------------

/** Flat selectable ids; for grids, `rowWidths` describes the per-row column counts. */
export function selectableIds(sections: ViewSection[] | undefined, items: ViewListItem[]): string[] {
  if (sections) return sections.flatMap((section) => section.items.map((item) => item.id));
  return items.map((item) => item.id);
}

export function gridRowWidths(body: ViewBody): number[] {
  const widths: number[] = [];
  if (body.sections) {
    for (const section of body.sections) {
      const columns = Math.max(1, Math.min(8, section.columns ?? body.columns ?? GRID_DEFAULT_COLUMNS));
      const total = section.items.length;
      for (let index = 0; index < total; index += columns) {
        widths.push(Math.min(columns, total - index));
      }
    }
    return widths;
  }
  const columns = Math.max(1, Math.min(8, body.columns ?? GRID_DEFAULT_COLUMNS));
  const total = (body.items ?? []).length;
  for (let index = 0; index < total; index += columns) widths.push(Math.min(columns, total - index));
  return widths;
}

export { ActionList, Icon, flatItems };
