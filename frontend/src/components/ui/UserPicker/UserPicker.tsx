import { useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { Popover } from '../Overlays/Overlays';
import { SearchField } from '../TextField/TextField';
import './UserPicker.css';

export interface UserPickerOption {
  id: string;
  username: string;
  fullName: string;
  roleLabel: string;
  companyName?: string | null;
  departmentIds?: ReadonlyArray<string>;
  avatarUrl?: string | null;
  isActive?: boolean;
}

export interface UserPickerProps {
  users: ReadonlyArray<UserPickerOption>;
  selectedIds: ReadonlyArray<string>;
  onChange: (ids: string[]) => void;
  departmentId?: string | null;
  canShowAll?: boolean;
  multi?: boolean;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Custom trigger element (defaults to a button listing the selected names). */
  trigger?: ReactNode;
}

export function UserPicker({
  users,
  selectedIds,
  onChange,
  departmentId = null,
  canShowAll = true,
  multi = true,
  placeholder = 'Select user...',
  disabled = false,
  ariaLabel = 'Pick users',
  trigger,
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAllDepts, setShowAllDepts] = useState(!departmentId);

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedIds.includes(u.id)),
    [users, selectedIds],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (u.isActive === false) return false;
      if (!showAllDepts && departmentId && !(u.departmentIds ?? []).includes(departmentId)) {
        return false;
      }
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.roleLabel.toLowerCase().includes(q) ||
        (u.companyName ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, query, showAllDepts, departmentId]);

  const toggleUser = (id: string) => {
    if (!multi) {
      onChange(selectedIds.includes(id) ? [] : [id]);
      setOpen(false);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const triggerLabel =
    selectedUsers.length === 0 ? placeholder : selectedUsers.map((u) => u.fullName).join(', ');

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        trigger ?? (
          <Button
            size="sm"
            disabled={disabled}
            aria-label={ariaLabel}
            className="org-userpicker__trigger"
          >
            <span className="org-userpicker__trigger-text">{triggerLabel}</span>
          </Button>
        )
      }
    >
      <div className="org-userpicker" data-ui="user-picker">
        <div className="org-userpicker__head">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search name, role, company..."
            ariaLabel="Search users"
          />
          {departmentId && canShowAll && (
            <Checkbox label="Show all depts" checked={showAllDepts} onChange={setShowAllDepts} />
          )}
        </div>
        <div className="org-userpicker__list" role="listbox" aria-multiselectable={multi}>
          {filtered.length === 0 ? (
            <div className="org-userpicker__empty">No matching users</div>
          ) : (
            filtered.map((u) => {
              const checked = selectedIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  data-selected={checked ? 'true' : undefined}
                  className="org-userpicker__row"
                  onClick={() => toggleUser(u.id)}
                >
                  <Avatar
                    username={u.username}
                    fullName={u.fullName}
                    avatarUrl={u.avatarUrl}
                    size="sm"
                  />
                  <span className="org-userpicker__meta">
                    <span className="org-userpicker__name">{u.fullName}</span>
                    <span className="org-userpicker__sub">
                      {u.roleLabel}
                      {u.companyName ? ` · ${u.companyName}` : ''}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Popover>
  );
}
