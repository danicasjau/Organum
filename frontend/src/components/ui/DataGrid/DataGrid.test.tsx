import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataGrid, type DataGridColumn } from './DataGrid';

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
