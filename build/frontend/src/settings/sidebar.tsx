// The Settings sidebar: search field with page/row search results and the navigation links.

import { useState } from "react";
import { RaycastIcon } from "../icons";
import { ACCOUNT_PAGE_ID, PAGES, SIDEBAR_PAGE_IDS, type PageDefinition } from "./pages";

export function SearchField({
  value,
  placeholder,
  onChange,
  onEscape,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onEscape?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="settings-input" data-state={focused ? "focus" : "blur"}>
      <span className="settings-input__icon">
        <RaycastIcon name="magnifying-glass" size={15} />
      </span>
      <input
        className="settings-input__input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) {
            event.preventDefault();
            onEscape();
          }
        }}
      />
    </div>
  );
}

export interface SearchResult {
  pageId: string;
  rowId?: string;
  title: string;
  /** Group header: the row's page when the result is a row. */
  group: string;
  description?: string;
}

export function searchResults(query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const page of PAGES) {
    if (page.title.toLowerCase().includes(needle)) {
      results.push({ pageId: page.id, title: page.title, group: "Settings" });
    }
    for (const section of page.sections) {
      for (const row of section.rows) {
        const haystack = [row.title, row.description ?? "", page.title].join(" ").toLowerCase();
        if (haystack.includes(needle)) {
          results.push({
            pageId: page.id,
            rowId: row.id,
            title: row.title,
            group: `${page.title}${section.title ? ` / ${section.title}` : ""}`,
            description: row.description,
          });
        }
      }
    }
  }
  return results;
}

export function SidebarLink({
  pageId,
  title,
  active,
  onNavigate,
}: {
  pageId: string;
  title: string;
  active: boolean;
  onNavigate: (pageId: string) => void;
}) {
  const page = PAGES.find((candidate) => candidate.id === pageId);
  return (
    <a
      className="settings-navlink"
      href={`#/${pageId}`}
      data-active={active}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(pageId);
      }}
    >
      <span className="settings-navlink__icon">
        <RaycastIcon name={page?.icon ?? "cog"} size={16} />
      </span>
      <span className="settings-navlink__label">{title}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------------------------
