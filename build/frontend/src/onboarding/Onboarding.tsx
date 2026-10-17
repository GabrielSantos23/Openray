// Onboarding flow: three steps (welcome features, Store, turn features off) shown on first start
// and replayable from Settings → General. Styled after Raycast for Windows' own onboarding:
// near-black canvas, large centred display type, red accent reserved for the progress dashes.

import { useMemo, useState } from "react";
import {
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlagId,
  type FeatureFlags,
} from "./features";
import { LinkFillIcon } from "./icons/link-fill";
import { CodeFillIcon } from "./icons/code-fill";
import { AddSquareFillIcon as CalculatorFillIcon } from "./icons/add-square-fill";
import { Translate2FillIcon } from "./icons/translate-2-fill";
import { Search2FillIcon } from "./icons/search-2-fill";
import { LayoutFillIcon } from "./icons/layout-fill";
import { DocumentFillIcon } from "./icons/document-fill";
import { TargetFillIcon } from "./icons/target-fill";
import { StoreFillIcon } from "./icons/store-fill";
import "./onboarding.css";

interface FeatureDefinition {
  id: FeatureFlagId;
  title: string;
  description: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}

const FEATURES: FeatureDefinition[] = [
  { id: "quicklinks", title: "Quicklinks", description: "Open sites and folders with a keyword.", Icon: LinkFillIcon },
  { id: "snippets", title: "Snippets", description: "Expand a short keyword into saved text.", Icon: CodeFillIcon },
  { id: "calculator", title: "Calculator", description: "Math and conversions right in the search bar.", Icon: CalculatorFillIcon },
  { id: "translator", title: "Translator", description: "Translate text without leaving the launcher.", Icon: Translate2FillIcon },
  { id: "fileSearch", title: "File Search", description: "Find files on your PC from one search.", Icon: Search2FillIcon },
  { id: "windowManagement", title: "Window Management", description: "Snap windows to halves, thirds and corners.", Icon: LayoutFillIcon },
  { id: "notes", title: "Notes", description: "Jot something down with one hotkey.", Icon: DocumentFillIcon },
  { id: "focus", title: "Focus", description: "Pause distracting apps while you work.", Icon: TargetFillIcon },
];

interface StoreExtension {
  id: string;
  badge: string;
  title: string;
  description: string;
}

const STORE_EXTENSIONS: StoreExtension[] = [
  { id: "spotify", badge: "S", title: "Spotify", description: "Now playing, search, library and player controls." },
  { id: "google-translate", badge: "G", title: "Google Translate", description: "Quick translations from the search bar." },
  { id: "placeholder", badge: "X", title: "[EXTENSION NAME]", description: "[Short description]" },
];

/** The app's own four-square mark, reused at onboarding scale (same paths as the header). */
function AppMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path fill="currentColor" d="M3.6 3.6h6.4v6.4H3.6zM14 3.6h6.4v6.4H14zM3.6 14h6.4v6.4H3.6zM14 14h6.4v6.4H14z" />
      <path fill="currentColor" d="M14 10.4h-3.6V14H10a3.6 3.6 0 1 0 4 0z" opacity=".9" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface OnboardingProps {
  /** Current feature flags; toggles in step 3 start from these on replay. */
  initialFlags: FeatureFlags;
  /** Completes the flow (persists flags and the completion flag). */
  onComplete: (flags: FeatureFlags) => void;
  /** Leaves the flow without changing any flags (Skip). */
  onSkip: () => void;
}

export function Onboarding({ initialFlags, onComplete, onSkip }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [flags, setFlags] = useState<FeatureFlags>(initialFlags);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [storeQuery, setStoreQuery] = useState("");

  const visibleExtensions = useMemo(() => {
    const query = storeQuery.trim().toLowerCase();
    if (!query) return STORE_EXTENSIONS;
    return STORE_EXTENSIONS.filter(
      (extension) => extension.title.toLowerCase().includes(query) || extension.description.toLowerCase().includes(query),
    );
  }, [storeQuery]);

  const toggleFeature = (id: FeatureFlagId) => {
    setFlags((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  const finish = () => onComplete(flags);
  const keepEverythingOn = () => onComplete({ ...DEFAULT_FEATURE_FLAGS, focus: true });

  const install = (id: string) => {
    setInstalled((previous) => new Set(previous).add(id));
  };

  const progress = (
    <div className="ob__progress" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span key={index} className={index === step ? "ob__dot ob__dot--active" : "ob__dot"} />
      ))}
    </div>
  );

  return (
    <div className="ob" role="group" aria-label="Onboarding">
      <header className="ob__top">
        {step < 2 ? (
          <button type="button" className="ob__skip" onClick={onSkip}>
            Skip
          </button>
        ) : null}
      </header>

      {step === 0 ? (
        <section className="ob__step ob__step--welcome">
          <span className="ob__mark" aria-hidden>
            <AppMark className="ob__mark-icon" />
          </span>
          <h1 className="ob__title">Welcome to RaycastMini</h1>
          <p className="ob__support">Open it with your hotkey and start typing. Here&rsquo;s what&rsquo;s already built in.</p>

          <ul className="ob__grid">
            {FEATURES.map(({ id, title, description, Icon }) => (
              <li key={id} className="ob__card">
                <span className="ob__tile">
                  <Icon className="ob__tile-icon" />
                </span>
                <span className="ob__card-title">{title}</span>
                <span className="ob__card-desc">{description}</span>
              </li>
            ))}
          </ul>

          <footer className="ob__footer">
            {progress}
            <span className="ob__footer-spacer" />
            <span className="ob__actions">
              <button type="button" className="ob__button ob__button--primary" onClick={() => setStep(1)} autoFocus>
                Continue
              </button>
            </span>
          </footer>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="ob__step ob__step--store">
          <div className="ob__store-body">
            <div className="ob__store-copy">
            <span className="ob__tile ob__tile--lg" aria-hidden>
              <StoreFillIcon className="ob__tile-icon" />
            </span>
            <h1 className="ob__title">Add more from the Store</h1>
            <p className="ob__support">
              Browse extensions, install with one click, and their commands show up in search right away.
            </p>
            <p className="ob__support ob__support--hint">Open it any time by typing Store in the launcher.</p>
          </div>

          <div className="ob__panel">
            <div className="ob__search">
              <Search2FillIcon className="ob__search-icon" aria-hidden />
              <input
                className="ob__search-input"
                type="text"
                aria-label="Search extensions"
                placeholder="Search extensions"
                value={storeQuery}
                onChange={(event) => setStoreQuery(event.target.value)}
              />
            </div>
            <ul className="ob__ext-list">
              {visibleExtensions.map((extension) => (
                <li key={extension.id} className="ob__ext">
                  <span className="ob__badge" aria-hidden>
                    {extension.badge}
                  </span>
                  <span className="ob__ext-text">
                    <span className="ob__ext-title">{extension.title}</span>
                    <span className="ob__ext-desc">{extension.description}</span>
                  </span>
                  <button
                    type="button"
                    className={installed.has(extension.id) ? "ob__button ob__button--installed" : "ob__button ob__button--accent"}
                    onClick={() => install(extension.id)}
                    disabled={installed.has(extension.id)}
                  >
                    {installed.has(extension.id) ? "Installed" : "Install"}
                  </button>
                </li>
              ))}
              {visibleExtensions.length === 0 ? <li className="ob__ext-empty">No extensions match your search.</li> : null}
            </ul>
          </div>
          </div>

          <footer className="ob__footer">
            <button type="button" className="ob__back" aria-label="Back" onClick={() => setStep(0)}>
              <ChevronLeft />
            </button>
            {progress}
            <span className="ob__footer-spacer" />
            <span className="ob__actions">
              <button type="button" className="ob__button ob__button--primary" onClick={() => setStep(2)} autoFocus>
                Continue
              </button>
            </span>
          </footer>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="ob__step ob__step--features">
          <h1 className="ob__title">Anything you&rsquo;d rather turn off?</h1>
          <p className="ob__support">
            Everything starts on. Switch off what you won&rsquo;t use. You can change this later in Settings.
          </p>

          <ul className="ob__toggles">
            {FEATURES.map(({ id, title, description, Icon }) => (
              <li key={id} className="ob__card ob__card--row">
                <span className="ob__tile">
                  <Icon className="ob__tile-icon" />
                </span>
                <span className="ob__card-text">
                  <span className="ob__card-title">{title}</span>
                  <span className="ob__card-desc">{description}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flags[id]}
                  aria-label={title}
                  className={flags[id] ? "ob__switch ob__switch--on" : "ob__switch"}
                  onClick={() => toggleFeature(id)}
                >
                  <span className="ob__knob" />
                </button>
              </li>
            ))}
          </ul>

          <footer className="ob__footer">
            <button type="button" className="ob__back" aria-label="Back" onClick={() => setStep(1)}>
              <ChevronLeft />
            </button>
            {progress}
            <span className="ob__footer-spacer" />
            <span className="ob__actions-group">
              <button type="button" className="ob__button" onClick={keepEverythingOn}>
                Keep everything on
              </button>
              <button type="button" className="ob__button ob__button--primary" onClick={finish} autoFocus>
                Finish setup
              </button>
            </span>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
