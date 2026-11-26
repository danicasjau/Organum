import './SideNav.css';

export interface SideNavItem<Id extends string = string> {
  id: Id;
  label: string;
  count?: number;
}

export interface SideNavGroup<Id extends string = string> {
  title: string;
  items: ReadonlyArray<SideNavItem<Id>>;
}

export interface SideNavProps<Id extends string = string> {
  groups: ReadonlyArray<SideNavGroup<Id>>;
  activeId: Id;
  onSelect: (id: Id) => void;
  ariaLabel: string;
}

/** Full-height left navigation used by full-screen workspaces (Users, Settings). */
export function SideNav<Id extends string = string>({
  groups,
  activeId,
  onSelect,
  ariaLabel,
}: SideNavProps<Id>) {
  return (
    <aside className="org-sidenav" aria-label={ariaLabel}>
      {groups
        .filter((g) => g.items.length > 0)
        .map((group) => (
          <div key={group.title} className="org-sidenav__group">
            <div className="org-sidenav__title">{group.title}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="org-sidenav__item"
                data-active={activeId === item.id ? 'true' : undefined}
                aria-current={activeId === item.id ? 'page' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span className="org-sidenav__count">{item.count}</span>
                )}
              </button>
            ))}
          </div>
        ))}
    </aside>
  );
}
