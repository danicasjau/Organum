import { afterEach, describe, expect, it } from 'vitest';
import { ME_LAYOUT_KEY, loadMeLayout, parseMeLayout, saveMeLayout } from './meLayout';

describe('meLayout', () => {
  afterEach(() => localStorage.clear());

  it('round-trips a valid three-pane layout', () => {
    saveMeLayout({ 'me-profile': 20, 'me-tasks': 50, 'me-preview': 30 });
    expect(loadMeLayout()).toEqual({ 'me-profile': 20, 'me-tasks': 50, 'me-preview': 30 });
  });

  it('rejects malformed or partial layouts', () => {
    expect(parseMeLayout('not json')).toBeUndefined();
    expect(parseMeLayout(JSON.stringify({ 'me-profile': 50, 'me-tasks': 50 }))).toBeUndefined();
    expect(
      parseMeLayout(JSON.stringify({ 'me-profile': 10, 'me-tasks': 10, 'me-preview': 10 })),
    ).toBeUndefined();
    localStorage.setItem(ME_LAYOUT_KEY, '{"me-profile":-5}');
    expect(loadMeLayout()).toBeUndefined();
  });

  it('ignores an invalid layout on save', () => {
    saveMeLayout({ 'me-profile': 100 });
    expect(localStorage.getItem(ME_LAYOUT_KEY)).toBeNull();
  });
});
