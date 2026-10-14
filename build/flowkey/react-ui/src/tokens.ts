/**
 * Design tokens for extension authors. Colors are concrete hex values from
 * the FlowKey palette (theme-independent); icons are Lucide icon names
 * verified against the shell's icon renderer. Items also accept raw Lucide
 * name strings, emoji, SVG markup and image URIs via `IconSpec`.
 */

/** Semantic palette usable as an `iconColor` or in `IconSpec.color`. */
export const Color = {
  Red: '#EF4444',
  Orange: '#F97316',
  Yellow: '#EAB308',
  Green: '#22C55E',
  Blue: '#3B82F6',
  Purple: '#8B5CF6',
  Magenta: '#EC4899',
} as const;

export type ColorName = keyof typeof Color;

/** Named shortcuts for common Lucide icons (any valid Lucide name also works). */
export const Icon = {
  ArrowRight: 'arrow-right',
  ArrowLeft: 'arrow-left',
  Check: 'check',
  X: 'x',
  Copy: 'copy',
  Clipboard: 'clipboard',
  Search: 'search',
  Person: 'user',
  Star: 'star',
  Heart: 'heart',
  Play: 'play',
  Pause: 'pause',
  SkipForward: 'skip-forward',
  SkipBack: 'skip-back',
  Trash: 'trash-2',
  Download: 'download',
  Link: 'link',
  ExternalLink: 'external-link',
  Folder: 'folder',
  File: 'file',
  Gear: 'settings',
  Info: 'info',
  Warning: 'triangle-alert',
  Refresh: 'refresh-cw',
  Plus: 'plus',
  Minus: 'minus',
  Eye: 'eye',
  EyeOff: 'eye-off',
  Lock: 'lock',
  Globe: 'globe',
  Clock: 'clock',
  Calendar: 'calendar',
  Music: 'music',
  Image: 'image',
  Message: 'message-circle',
  Send: 'send',
  Bolt: 'zap',
  Bookmark: 'bookmark',
  Tag: 'tag',
  Filter: 'filter',
  Grid: 'grid-3x3',
  List: 'list',
  Home: 'home',
  Pin: 'pin',
  LogOut: 'log-out',
} as const;

export type IconName = keyof typeof Icon;

/** Modifier keys available for command shortcuts (Windows layout). */
export type KeyModifier = 'ctrl' | 'alt' | 'shift' | 'windows';

/** Keys usable as the main key of a shortcut. */
export type KeyEquivalent =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'return'
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'deleteForward'
  | 'tab'
  | 'escape'
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageUp'
  | 'pageDown'
  | 'home'
  | 'end';

/** A keyboard shortcut (display metadata for actions and items). */
export interface KeyboardShortcut {
  key: KeyEquivalent;
  modifiers?: KeyModifier[];
}
