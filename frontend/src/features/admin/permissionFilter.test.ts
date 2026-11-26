import { describe, expect, it } from 'vitest';
import {
  EMPTY_PERMISSION_FILTER,
  differsFromDefault,
  filterPermissionKeys,
  isFilterActive,
  permissionGroups,
  visibleRoles,
  type RoleLike,
} from './permissionFilter';

const KEYS = ['task.view', 'task.edit_schedule', 'views.gantt', 'views.kanban', 'user.view'];

const artist: RoleLike = {
  id: 'r-art',
  name: 'artist',
  label: 'Artist',
  permissions: { 'task.view': 'mine', 'views.gantt': 'all' },
  default_permissions: { 'task.view': 'mine', 'views.gantt': 'none' },
};
const lead: RoleLike = {
  id: 'r-lead',
  name: 'lead',
  label: 'Lead',
  permissions: { 'task.view': 'all', 'task.edit_schedule': 'company', 'views.kanban': 'all' },
  default_permissions: { 'task.view': 'all', 'task.edit_schedule': 'none', 'views.kanban': 'all' },
};
const custom: RoleLike = {
  id: 'r-c',
  name: 'coord',
  label: 'Coordinator',
  permissions: { 'user.view': 'all' },
  default_permissions: null,
};
const ROLES = [artist, lead, custom];

describe('permission filter', () => {
  it('groups by first key segment', () => {
    expect(permissionGroups(KEYS)).toEqual(['task', 'user', 'views']);
  });

  it('returns everything for an empty filter', () => {
    expect(filterPermissionKeys(KEYS, ROLES, EMPTY_PERMISSION_FILTER)).toEqual(KEYS);
    expect(isFilterActive(EMPTY_PERMISSION_FILTER)).toBe(false);
  });

  it('searches key text, multiple terms and role scopes', () => {
    const f = { ...EMPTY_PERMISSION_FILTER, text: 'gantt' };
    expect(filterPermissionKeys(KEYS, ROLES, f)).toEqual(['views.gantt']);
    expect(filterPermissionKeys(KEYS, ROLES, { ...f, text: 'task view' })).toEqual(['task.view']);
    // Scope text: rows where any visible role has "company".
    expect(filterPermissionKeys(KEYS, ROLES, { ...f, text: 'company' })).toEqual([
      'task.edit_schedule',
    ]);
  });

  it('filters by group', () => {
    const f = { ...EMPTY_PERMISSION_FILTER, group: 'views' };
    expect(filterPermissionKeys(KEYS, ROLES, f)).toEqual(['views.gantt', 'views.kanban']);
  });

  it('shows only differences from defaults (custom roles never count)', () => {
    expect(differsFromDefault(artist, 'views.gantt')).toBe(true);
    expect(differsFromDefault(artist, 'task.view')).toBe(false);
    expect(differsFromDefault(custom, 'user.view')).toBe(false);
    const f = { ...EMPTY_PERMISSION_FILTER, onlyDifferences: true };
    expect(filterPermissionKeys(KEYS, ROLES, f)).toEqual(['task.edit_schedule', 'views.gantt']);
  });

  it('role focus limits columns and the difference check', () => {
    const f = { ...EMPTY_PERMISSION_FILTER, roleId: 'r-lead', onlyDifferences: true };
    expect(visibleRoles(ROLES, f).map((r) => r.id)).toEqual(['r-lead']);
    expect(filterPermissionKeys(KEYS, ROLES, f)).toEqual(['task.edit_schedule']);
    // Text matching only looks at the focused role's scopes.
    const g = { ...EMPTY_PERMISSION_FILTER, roleId: 'r-art', text: 'company' };
    expect(filterPermissionKeys(KEYS, ROLES, g)).toEqual([]);
  });
});
