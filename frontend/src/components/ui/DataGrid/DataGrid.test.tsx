import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  dataGridCellKey,
  parseClipboardTable,
  type DataGridColumn,
  type DataGridVisibleData,
} from './DataGrid';

const COLS: DataGridColumn[] = [
  { key: 'frame', header: 'Frame', numeric: true, width: 80 },
  { key: 'ms', header: 'Render ms', numeric: true, width: 110 },
  { key: 'status', header: 'Status', width: 90 },
];

const ROWS = [
  { frame: 1, ms: 142.5, status: 'ok' },
  { frame: 2, ms: 139.8, status: 'ok' },
  { frame: 3, ms: 151.1, status: 'warn' },
];

describe('DataGrid', () => {
  it('supports sorting, global filtering, range selection stats, and inline cell editing', () => {
    const onCellEdit = vi.fn();
    render(<DataGrid columns={COLS} rows={ROWS} editable onCellEdit={onCellEdit} />);

    expect(screen.getByText('142.5')).toBeInTheDocument();

    // Sort by Render ms (TanStack numeric defaults to desc on first click, asc on second)
    fireEvent.click(screen.getByText('Render ms'));
    expect(screen.getAllByRole('gridcell')[1]).toHaveTextContent('151.1');
    fireEvent.click(screen.getByText('Render ms'));
    expect(screen.getAllByRole('gridcell')[1]).toHaveTextContent('139.8');

    // Range select numeric cells via row + shift+click
    fireEvent.click(screen.getByText('139.8'));
    fireEvent.click(screen.getByText('151.1'), { shiftKey: true });
    expect(screen.getByText('433.40')).toBeInTheDocument(); // sum

    // Filter rows
    fireEvent.change(screen.getByLabelText('Search grid rows'), { target: { value: 'warn' } });
    expect(screen.queryByText('139.8')).not.toBeInTheDocument();
    expect(screen.getByText('151.1')).toBeInTheDocument();

    // Double click edit
    fireEvent.doubleClick(screen.getByText('151.1'));
    const input = screen.getByDisplayValue('151.1');
    fireEvent.change(input, { target: { value: '125.0' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellEdit).toHaveBeenCalledWith(2, 'ms', '125.0');
  });
});

describe('DataGrid CR04 extensions', () => {
  const rows = [
    { id: 'a', name: 'sh010', path: 'seq1/sh010', n: 11 },
    { id: 'b', name: 'sh020', path: 'seq1/sh020', n: 22 },
    { id: 'c', name: 'hero', path: 'hero', n: 33 },
  ];
  const cols: DataGridColumn[] = [
    { key: 'name', header: 'Name', editable: false },
    { key: 'n', header: 'N', numeric: true },
  ];
  const setup = (extra: Partial<Parameters<typeof DataGrid>[0]> = {}) => {
    const onCellsChange = vi.fn();
    const utils = render(
      <DataGrid
        columns={cols}
        rows={rows}
        editable
        getRowId={(r) => String(r.id)}
        onCellsChange={onCellsChange}
        {...extra}
      />,
    );
    return { onCellsChange, ...utils };
  };

  it('parses clipboard tables', () => {
    expect(parseClipboardTable('1\t2\r\n3\t4\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseClipboardTable('')).toEqual([]);
  });

  it('emits batch changes for edit, paste and Delete, skipping read-only columns', () => {
    const { onCellsChange } = setup();
    fireEvent.doubleClick(screen.getByText('22'));
    const input = screen.getByDisplayValue('22');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellsChange).toHaveBeenLastCalledWith([{ rowId: 'b', colKey: 'n', value: '20' }]);

    // Paste a 2x2 block starting on the read-only Name column of row a: only N changes.
    fireEvent.click(screen.getByText('sh010'));
    const grid = screen.getByRole('grid');
    fireEvent.paste(grid, {
      clipboardData: { getData: () => 'x\t7\ny\t8' },
    });
    expect(onCellsChange).toHaveBeenLastCalledWith([
      { rowId: 'a', colKey: 'n', value: '7' },
      { rowId: 'b', colKey: 'n', value: '8' },
    ]);

    // One value pasted into a multi-cell selection fills every selected cell.
    fireEvent.click(screen.getByText('11'));
    fireEvent.click(screen.getByText('33'), { shiftKey: true });
    fireEvent.paste(grid, { clipboardData: { getData: () => '9' } });
    expect(onCellsChange).toHaveBeenLastCalledWith([
      { rowId: 'a', colKey: 'n', value: '9' },
      { rowId: 'b', colKey: 'n', value: '9' },
      { rowId: 'c', colKey: 'n', value: '9' },
    ]);

    fireEvent.keyDown(grid, { key: 'Delete' });
    expect(onCellsChange).toHaveBeenLastCalledWith([
      { rowId: 'a', colKey: 'n', value: null },
      { rowId: 'b', colKey: 'n', value: null },
      { rowId: 'c', colKey: 'n', value: null },
    ]);
  });

  it('shows cell errors, undo/redo keys, grouping, hidden rows and visible data', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const ref: { current: DataGridVisibleData | null } = { current: null };
    setup({
      cellErrors: { [dataGridCellKey('b', 'n')]: 'Not a number' },
      onUndo,
      onRedo,
      enableLayoutTools: true,
      visibleDataRef: ref,
      groupBy: (r) => {
        const parts = String(r.path).split('/');
        return parts.length > 1
          ? { id: parts[0]!, label: parts[0]! }
          : { id: 'root', label: 'Root' };
      },
    });
    const bad = screen.getAllByRole('gridcell').find((c) => c.getAttribute('aria-invalid'));
    expect(bad).toHaveAttribute('title', 'Not a number');

    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();

    // Groups sorted by label: Root first, then seq1.
    const toggles = screen.getAllByRole('rowheader');
    expect(toggles.map((t) => t.textContent)).toEqual(['▾ Root (1)', '▾ seq1 (2)']);
    fireEvent.click(toggles[1]!);
    expect(screen.queryByText('sh010')).not.toBeInTheDocument();
    // Collapsed rows are still part of the export (filtered, not hidden).
    expect(ref.current?.rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    fireEvent.click(screen.getAllByRole('rowheader')[1]!);

    fireEvent.click(screen.getByText('sh020'));
    fireEvent.click(screen.getByRole('button', { name: 'Hide rows' }));
    expect(screen.queryByText('sh020')).not.toBeInTheDocument();
    expect(ref.current?.rows.map((r) => r.id)).toEqual(['c', 'a']);
    fireEvent.click(screen.getByRole('button', { name: 'Unhide 1' }));
    expect(screen.getByText('sh020')).toBeInTheDocument();
  });
});
