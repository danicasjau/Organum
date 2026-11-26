import { describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  afterRedo,
  afterUndo,
  confoGroupFor,
  errorReportCsv,
  formatConfoValue,
  isCellIssueList,
  keyFromLabel,
  pushHistory,
  redoPayload,
  toCsv,
  undoPayload,
} from './confoModel';

describe('confoModel', () => {
  it('formats typed values', () => {
    const lookup = {
      users: new Map([['u1', 'Ana Artist']]),
      entities: new Map([['e1', 'sh010']]),
    };
    expect(formatConfoValue('boolean', true)).toBe('Yes');
    expect(formatConfoValue('boolean', false)).toBe('No');
    expect(formatConfoValue('multiselect', ['bg', 'fg'])).toBe('bg, fg');
    expect(formatConfoValue('user', 'u1', lookup)).toBe('Ana Artist');
    expect(formatConfoValue('entity', 'e1', lookup)).toBe('sh010');
    expect(formatConfoValue('integer', 12)).toBe('12');
    expect(formatConfoValue('text', null)).toBe('');
  });

  it('writes CSV with escaping and formula protection', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'say "hi"'],
          ['=SUM(1)', 'ok'],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(1),ok\r\n');
  });

  it('groups like the Matrix (path parents or type)', () => {
    expect(confoGroupFor('path', { rel_path: 'ep01/seq010/sh010' })).toEqual({
      id: 'path:ep01 ▸ seq010',
      label: 'ep01 ▸ seq010',
    });
    expect(confoGroupFor('path', { rel_path: 'hero' })?.label).toBe('Root');
    expect(confoGroupFor('type', { entity_type: '' })?.label).toBe('Untyped');
    expect(confoGroupFor('none', { rel_path: 'a/b' })).toBeNull();
  });

  it('undo/redo history', () => {
    const batch = [
      { entity_id: 'e1', column_key: 'a', before: 1, after: 2 },
      { entity_id: 'e2', column_key: 'a', before: null, after: 5 },
    ];
    let h = pushHistory(EMPTY_HISTORY, batch);
    expect(undoPayload(batch)).toEqual([
      { entity_id: 'e2', column_key: 'a', value: null },
      { entity_id: 'e1', column_key: 'a', value: 1 },
    ]);
    h = afterUndo(h);
    expect(h.undo).toHaveLength(0);
    expect(h.redo).toHaveLength(1);
    expect(redoPayload(h.redo[0]!)[1]).toEqual({ entity_id: 'e2', column_key: 'a', value: 5 });
    h = afterRedo(h);
    expect(h.undo).toHaveLength(1);
    // A new edit clears redo.
    h = afterUndo(h);
    h = pushHistory(h, [{ entity_id: 'e3', column_key: 'b', before: 'x', after: 'y' }]);
    expect(h.redo).toHaveLength(0);
    expect(pushHistory(h, [])).toBe(h);
  });

  it('builds error reports and recognises cell issues', () => {
    const issues = [{ entity_id: 'sh010', column_key: 'frames', message: 'Not a number', line: 3 }];
    expect(isCellIssueList(issues)).toBe(true);
    expect(isCellIssueList('nope')).toBe(false);
    expect(errorReportCsv(issues)).toBe(
      'line,entity,column,message\r\n3,sh010,frames,Not a number\r\n',
    );
  });

  it('derives column keys from labels', () => {
    expect(keyFromLabel('Camera Movement')).toBe('camera_movement');
    expect(keyFromLabel('2D VFX')).toBe('c_2d_vfx');
    expect(keyFromLabel('Animació')).toBe('animacio');
    expect(keyFromLabel('  ')).toBe('');
  });
});
