import type { ReactNode } from 'react';

export interface IconSpec {
  emoji?: string;
  lucide?: string;
  /** Raw SVG markup rendered as a tinted vector. */
  svg?: string;
  color?: string;
  uri?: string;
}

export interface FilterOptionSpec {
  label: string;
  value: string;
}

export interface PaginationSpec {
  /** Whether more pages exist; the Load-more affordance collapses when false. */
  hasNextPage: boolean;
  /** Invoked by the shell when the user asks for the next page. */
  onLoadMore: () => void | Promise<void>;
  pageSize?: number;
}

export interface ListProps {
  layout?: 'side-pane';
  filter?: FilterOptionSpec[];
  /** Keeps the shell's loading indicator active after this tree arrives. */
  isLoading?: boolean;
  /** Placeholder text for the search bar. */
  searchBarPlaceholder?: string;
  /** Server-side pagination for long lists. */
  pagination?: PaginationSpec;
  children?: ReactNode;
}

export interface ListSectionProps {
  title?: string;
  children?: ReactNode;
}

export interface AccessorySpec {
  text: string;
  tooltip?: string;
  color?: 'success' | 'danger' | 'accent' | 'secondary';
}

export interface ShortcutSpec {
  key: string;
  modifiers?: string[];
}

export interface ListItemProps {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  icon?: string | IconSpec;
  /** Extra search terms matched by the shell's filter. */
  keywords?: string[];
  /** Trailing chips shown at the end of the row. */
  accessories?: AccessorySpec[];
  actions?: ReactNode;
  detail?: ReactNode;
}

export interface ListItemDetailProps {
  preview?: string;
  previewImageUri?: string;
  children?: ReactNode;
}

export interface MetadataProps {
  children?: ReactNode;
}

export interface MetadataFieldProps {
  label: string;
  /** Optional for `tags`/`separator` kinds; the serializer enforces requirements. */
  value?: string;
  valueIconUri?: string;
  /** `link` fields open `href` in the user's browser (Detail metadata only). */
  href?: string;
  /** `tags` fields render a chip list instead of plain text (Detail metadata only). */
  tags?: string[];
  /** Field variant; defaults to a plain key/value row (Detail metadata only). */
  kind?: 'text' | 'link' | 'tags' | 'separator';
}

export interface EmptyViewProps {
  title: string;
  description?: string;
}

export interface DetailProps {
  title: string;
  mediaKeys?: boolean;
  subtitle?: string;
  imageUri?: string;
  markdown?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export interface GridProps {
  columns: number;
  title?: string;
  /** Search-bar dropdown options shown while this grid view is open. */
  filter?: FilterOptionSpec[];
  /** Keeps the shell's loading indicator active after this tree arrives. */
  isLoading?: boolean;
  /** Placeholder text for the search bar. */
  searchBarPlaceholder?: string;
  children?: ReactNode;
}

export interface GridSectionProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}

export interface GridItemProps {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  icon?: string | IconSpec;
  actions?: ReactNode;
}

export interface ActionPanelProps {
  children?: ReactNode;
}

export interface FormProps {
  title: string;
  /** Receives the shell-collected field values when a submit action runs. */
  onSubmit?: (values: Record<string, unknown>) => void | Promise<void>;
  actions?: ReactNode;
  children?: ReactNode;
}

export interface FormTextFieldProps {
  id: string;
  label?: string;
  placeholder?: string;
  default?: string;
  required?: boolean;
}

export interface FormCheckboxProps {
  id: string;
  label?: string;
  default?: boolean;
}

export interface FormOptionsProps {
  id: string;
  label?: string;
  options?: { value: string; title: string }[];
  default?: string;
  /** TagPicker initial selection. */
  defaults?: string[];
  required?: boolean;
}

export interface FormIdProps {
  id: string;
  label?: string;
}

export interface FormFilePickerProps {
  id: string;
  label?: string;
  canChooseFiles?: boolean;
  canChooseDirectories?: boolean;
  allowMultipleSelection?: boolean;
}

export interface FormDescriptionProps {
  label: string;
}

export interface ActionProps {
  title: string;
  primary?: boolean;
  push?: string;
  onAction: () => void | Promise<void>;
  id?: string;
  /** `destructive` tints the action row in the action panel. */
  style?: 'destructive';
  /** Display-only shortcut hint rendered as keycaps. */
  shortcut?: ShortcutSpec;
}
