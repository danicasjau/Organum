import { useState, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { CollapsibleSection } from '../Panel/Panel';
import { SearchField } from '../TextField/TextField';
import './PropertyEditor.css';

export interface PropertyRowProps {
  label: string;
  dirty?: boolean;
  onReset?: () => void;
  children: ReactNode;
}

export function PropertyRow({ label, dirty = false, onReset, children }: PropertyRowProps) {
  return (
    <div data-ui="property-row" data-dirty={dirty ? 'true' : undefined} className="org-proprow">
      <div className="org-proprow__label" title={label}>
        <span>{label}</span>
        {dirty && onReset && (
          <button
            type="button"
            className="org-proprow__reset"
            aria-label={`Reset ${label}`}
            title={`Reset ${label}`}
            onClick={onReset}
          >
            <Icon name="reset" size="sm" />
          </button>
        )}
      </div>
      <div className="org-proprow__field">{children}</div>
    </div>
  );
}

export interface PropertyItemDef {
  id: string;
  label: string;
  dirty?: boolean;
  onReset?: () => void;
  render: () => ReactNode;
}

export interface PropertyGroupDef {
  id: string;
  title: string;
  defaultOpen?: boolean;
  items: ReadonlyArray<PropertyItemDef>;
}

export function PropertyEditor({
  groups,
  searchable = true,
}: {
  groups: ReadonlyArray<PropertyGroupDef>;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);

  const q = query.trim().toLowerCase();

  return (
    <div data-ui="property-editor" className="org-propeditor">
      {searchable && (
        <div className="org-propeditor__bar">
          <div className="org-propeditor__search">
            <SearchField value={query} onChange={setQuery} placeholder="Filter properties..." />
          </div>
          <Button
            variant="toggle"
            size="sm"
            pressed={modifiedOnly}
            onClick={() => setModifiedOnly((m) => !m)}
          >
            Modified
          </Button>
        </div>
      )}
      <div className="org-propeditor__groups">
        {groups.map((grp) => {
          const filtered = grp.items.filter((it) => {
            if (modifiedOnly && !it.dirty) return false;
            if (q && !it.label.toLowerCase().includes(q)) return false;
            return true;
          });
          if (filtered.length === 0) return null;
          return (
            <CollapsibleSection key={grp.id} title={grp.title} defaultOpen={grp.defaultOpen}>
              {filtered.map((it) => (
                <PropertyRow
                  key={it.id}
                  label={it.label}
                  dirty={it.dirty}
                  onReset={it.onReset}
                >
                  {it.render()}
                </PropertyRow>
              ))}
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}

