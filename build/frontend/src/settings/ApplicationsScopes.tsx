import { OpenrayIcon } from "../icons";
import { ipc } from "../ipc";

/** The Applications page's Search Scopes section: extra directories the app scan includes. */
export function ApplicationsSearchScopes({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: string) => void;
}) {
  const scopes = parseScopes(value);

  const add = async () => {
    const response = (await ipc.backend(
      "fileSystem.showSelectFolderDialog",
      { title: "Add Search Scope" },
      { module: "backend" },
    )) as { path?: string | null } | undefined;
    const folder = response?.path;
    if (!folder || scopes.includes(folder)) return;
    onChange(JSON.stringify([...scopes, folder]));
  };

  const remove = (path: string) => {
    onChange(JSON.stringify(scopes.filter((scope) => scope !== path)));
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">
        <span className="settings-section__titleInner">Search Scopes</span>
        <button type="button" className="settings-scopes__add" aria-label="Add Search Scope" onClick={() => void add()}>
          <OpenrayIcon name="plus" size={12} />
        </button>
      </h2>
      <p className="settings-section__description">
        Pick additional directories to be included when searching for Applications
      </p>
      <div className="settings-section__content">
        {scopes.length === 0 ? (
          <p className="settings-section__empty">No additional directories.</p>
        ) : (
          scopes.map((scope) => (
            <div className="settings-scopes__row" key={scope}>
              <OpenrayIcon name="folder" size={14} />
              <span className="settings-scopes__path">{scope}</span>
              <button
                type="button"
                className="settings-scopes__remove"
                aria-label={`Remove ${scope}`}
                onClick={() => remove(scope)}
              >
                <OpenrayIcon name="minus" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}
