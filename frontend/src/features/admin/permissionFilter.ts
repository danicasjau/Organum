/** CR04 §11: search / filter helpers for the role permissions matrix. */

export interface RoleLike {
  id: string;
  name: string;
  label: string;
  permissions?: Record<string, string>;
  default_permissions?: Record<string, string> | null;
}

export interface PermissionFilter {
  text: string;
  /** Permission group (first key segment, e.g. "task", "views"); '' = all groups. */
  group: string;
  /** Role id to focus on; '' = all roles. */
  roleId: string;
  onlyDifferences: boolean;
}

export const EMPTY_PERMISSION_FILTER: PermissionFilter = {
  text: '',
  group: '',
  roleId: '',
  onlyDifferences: false,
};

export function permissionGroup(key: string): string {
  const dot = key.indexOf('.');
  return dot < 0 ? key : key.slice(0, dot);
}

export function permissionGroups(keys: ReadonlyArray<string>): string[] {
  return [...new Set(keys.map(permissionGroup))].sort();
}

/** True when the role's scope for `key` differs from its seeded default (custom roles: never). */
export function differsFromDefault(role: RoleLike, key: string): boolean {
  if (!role.default_permissions) return false;
  const current = role.permissions?.[key] ?? 'none';
  const seeded = role.default_permissions[key] ?? 'none';
  return current !== seeded;
}

export function visibleRoles<R extends RoleLike>(
  roles: ReadonlyArray<R>,
  filter: PermissionFilter,
): R[] {
  return filter.roleId ? roles.filter((r) => r.id === filter.roleId) : [...roles];
}

/**
 * Keys matching the filter. Text matches the key or any visible role's scope
 * ("task.view", "gantt", "company"); differences are judged on the visible roles only.
 */
export function filterPermissionKeys(
  keys: ReadonlyArray<string>,
  roles: ReadonlyArray<RoleLike>,
  filter: PermissionFilter,
): string[] {
  const shown = visibleRoles(roles, filter);
  const terms = filter.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return keys.filter((key) => {
    if (filter.group && permissionGroup(key) !== filter.group) return false;
    if (filter.onlyDifferences && !shown.some((r) => differsFromDefault(r, key))) return false;
    if (terms.length === 0) return true;
    const haystack = [
      key.toLowerCase(),
      ...shown.map((r) => `${r.label} ${r.name}=${r.permissions?.[key] ?? 'none'}`.toLowerCase()),
    ].join(' ');
    return terms.every((t) => haystack.includes(t));
  });
}

export function isFilterActive(filter: PermissionFilter): boolean {
  return Boolean(filter.text.trim() || filter.group || filter.roleId || filter.onlyDifferences);
}
