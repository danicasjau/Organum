import { describe, expect, it } from 'vitest';
import { validateConditionLeaf } from './AdminRulesSection';

describe('validateConditionLeaf', () => {
  it('requires a value', () => {
    expect(validateConditionLeaf({ operator: '=', value: '  ' })).toBe('Value is required');
    expect(validateConditionLeaf({ operator: '=', value: 'shot' })).toBeNull();
  });

  it('needs at least one list item for "in"', () => {
    expect(validateConditionLeaf({ operator: 'in', value: ' , ,' })).toMatch(/at least one/);
    expect(validateConditionLeaf({ operator: 'in', value: 'a, b' })).toBeNull();
  });

  it('checks regular expressions', () => {
    expect(validateConditionLeaf({ operator: 'matches', value: '(' })).toBe(
      'Invalid regular expression',
    );
    expect(validateConditionLeaf({ operator: 'matches', value: String.raw`^sh\d+$` })).toBeNull();
    expect(validateConditionLeaf({ operator: 'matches', value: 'a'.repeat(257) })).toMatch(
      /too long/,
    );
  });
});
