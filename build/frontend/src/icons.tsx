// Icon registry — Lucide icons instead of emoji glyphs.
//
// Raycast's own icon catalogue is Lucide-shaped: the internal manifest in
// `frontend/internal-extensions-C7AXi5Nw.js` names its action icons `app-window-list`, `folder`,
// `copy-clipboard`, `shield-04`, `person`, `clock`, `x-mark-circle`, `eye-disabled`,
// `arrow-clockwise`, `trash`, `star`, `cog`, `game-controller` … and every one of those is a Lucide
// icon under a different spelling. the classic `<Icon.X />` names are Lucide names too
// (Bird, Text, CopyClipboard, Link, Person, Trash, Star, Search, …).
//
// So: one registry that maps Raycast's names onto the Lucide component that draws them.

import {
  AlertTriangle,
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Battery,
  Bird,
  Bookmark,
  Bug,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clipboard,
  Clock,
  Cloud,
  Code,
  Command,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Flag,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  Info,
  Keyboard,
  LayoutGrid,
  Lightbulb,
  Link as LinkIcon,
  List,
  Lock,
  Mail,
  LockOpen,
  Music,
  Archive,
  Pause,
  Pin,
  PinOff,
  Pipette,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Share2,
  Shield,
  Shuffle,
  SkipBack,
  Minus,
  SkipForward,
  SlidersHorizontal,
  Smartphone,
  Speaker,
  Square,
  SquareTerminal,
  Star,
  Tag,
  Terminal,
  Trash2,
  Type,
  Upload,
  User,
  Video,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Zap,
  HelpCircle,
  Blocks,
  Building2,
  Calculator,
  ArrowLeftRight,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/** Raycast icon name -> Lucide component. */
const REGISTRY: Record<string, IconComponent> = {
  // ---- Raycast internal manifest keys (internal-extensions-C7AXi5Nw.js) -------------------
  "app-window-list": AppWindow,
  "app-window": AppWindow,
  clock: Clock,
  "shield-04": Shield,
  shield: Shield,
  person: User,
  finder: FolderOpen,
  folder: Folder,
  "copy-clipboard": Copy,
  copy: Copy,
  "x-mark-circle": XCircle,
  "eye-disabled": EyeOff,
  "arrow-clockwise": RefreshCw,
  "x-mark-circle-half-dash": CircleSlash,
  "grip-vertical": GripVertical,
  minus: Minus,
  trash: Trash2,
  star: Star,
  cog: Settings,
  "game-controller": Gamepad2,
  "magnifying-glass": Search,
  "apple-logo": Bird,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  calculator: Calculator,
  globe: Globe,
  switch: ArrowLeftRight,

  // ---- FlowKey extension icon names (`Action icon={{ lucide: … }}` / manifest `iconName`) ----
  play: Play,
  pause: Pause,
  forward: SkipForward,
  rewind: SkipBack,
  shuffle: Shuffle,
  repeat: Repeat,
  info: Info,
  plug: Plug,
  speaker: Speaker,
  "speaker-off": VolumeX,

  // ---- Clipboard history keys (main-window-*.js row icons + action icons) ----------------------
  tack: Pin,
  "tack-disabled": PinOff,
  "at-symbol": Mail,
  "eye-dropper": Pipette,
  flag: Flag,
  "blank-document": File,
  "bullet-points": List,
  image: ImageIcon,
  link: LinkIcon,
  text: Type,
  file: File,
  "file-text": FileText,
  film: Film,
  music: Music,
  archive: Archive,
  "folder-search": FolderSearch,
  code: Code,
  tag: Tag,
  download: Download,
  list: List,

  // ---- Settings window sidebar icons (abstractions, mapped onto Lucide) -------------------
  general: SlidersHorizontal,
  launcher: AppWindow,
  shortcuts: Command,
  keyboard: Keyboard,
  "cloud-sync": Cloud,
  advanced: Settings,
  organizations: Building2,
  internal: Bug,
  remote: Smartphone,
  about: Info,
  account: User,

  // ---- classic <Icon.X /> names ------------------------------------------------------
  Bird: Bird,
  Text: Type,
  CopyClipboard: Clipboard,
  Link: LinkIcon,
  Person: User,
  Trash: Trash2,
  Star: Star,
  Search: Search,
  Plus: Plus,
  Minus: X,
  Checkmark: Check,
  XMark: X,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Gear: Settings,
  Window: AppWindow,
  Document: File,
  Download,
  Upload,
  Eye: Eye,
  EyeSlash: EyeOff,
  Lock: Lock,
  Unlock: LockOpen,
  Globe,
  Cloud: Cloud,
  Bolt: Zap,
  Clock: Clock,
  Calendar,
  Music,
  Play: Play,
  Pause: Pause,
  Stop: Square,
  Forward: ChevronDown,
  Rewind: ChevronDown,
  VolumeHigh: Volume2,
  VolumeLow: Volume2,
  Mute: VolumeX,
  Camera,
  Image: ImageIcon,
  Video: Video,
  Code: Code,
  Terminal: Terminal,
  Bug: Bug,
  Lightbulb,
  QuestionMark: HelpCircle,
  Warning: AlertTriangle,
  Info: Info,
  Bookmark,
  Tag: Tag,
  List: List,
  Grid: LayoutGrid,
  Share: Share2,
  Battery,
};

/** Fallbacks used when nothing matches, so the UI never shows a raw emoji. */
const FALLBACK: Record<string, IconComponent> = {
  app: AppWindow,
  extension: Blocks,
  folder: Folder,
};

export interface IconProps {
  name?: string | null;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Draws the Raycast/Lucide icon called `name`.
 *
 * Accepts `icon://<name>.png` (what the extension renderer emits), a bare Raycast icon name, or a
 * kebab-case internal key. Anything unknown falls back to a neutral glyph.
 */
export function OpenrayIcon({ name, size = 15, className, strokeWidth = 1.75 }: IconProps) {
  let key = name ?? "";
  if (key.startsWith("icon://")) key = key.slice("icon://".length).replace(/\.png$/, "");

  const Component = REGISTRY[key] ?? FALLBACK[key] ?? FALLBACK.app;
  return (
    <Component
      width={size}
      height={size}
      className={className}
      strokeWidth={strokeWidth}
      aria-hidden
    />
  );
}

/** Convenience wrapper for a known Raycast internal key. */
export function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return <OpenrayIcon name={name} size={size} />;
}

export { REGISTRY as RAYCAST_ICON_REGISTRY };
