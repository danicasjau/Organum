import { toRowStatus } from '../_internal/rowStatus';
import {
  flexRender,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
  type LegacyFeatures,
} from '@tanstack/react-table/legacy';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Button } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { Popover } from '../Overlays/Overlays';
import { SearchField } from '../TextField/TextField';
import { Text } from '../Typography/Typography';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './DataGrid.css';

type Row = Record<string, unknown>;

export interface DataGridEditorProps {
  value: unknown;
  /** Text shown when editing started (same as copy text). */
  initialText: string;
  row: Row;
  onCommit: (next: unknown) => void;
  onCancel: () => void;
}

export interface DataGridColumn {
  key: string;
  header: string;
  numeric?: boolean;
  width?: number;
  editable?: boolean;
  /** Custom display of a cell (defaults to the value as text). */
  renderCell?: (value: unknown, row: Row) => ReactNode;
  /** Custom in-cell editor (defaults to a text input). */
  renderEditor?: (props: DataGridEditorProps) => ReactNode;
  /** Text used for search, filters, copy, CSV export and as the edit draft. */
  toText?: (value: unknown, row: Row) => string;
  headerTitle?: string;
}

export interface DataGridCellChange {
  rowId: string;
  colKey: string;
  value: unknown;
}

export interface DataGridViewState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  columnVisibility: Record<string, boolean>;
  colWidths: Record<string, number>;
  frozenCount: number;
  hiddenRowIds: string[];
  collapsedGroups: string[];
  showFilters: boolean;
}

export interface DataGridVisibleData {
  columns: DataGridColumn[];
  rows: Row[];
}

export interface DataGridProps {
  columns: ReadonlyArray<DataGridColumn>;
  rows: ReadonlyArray<Row>;
  editable?: boolean;
  /** Legacy single-cell edit callback (row index in `rows`). */
  onCellEdit?: (rowIndex: number, columnKey: string, nextValue: string) => void;
  className?: string;
  ariaLabel?: string;
  /** Stable row ids; required for batch edits, row hiding and cell errors. */
  getRowId?: (row: Row, index: number) => string;
  /** Batch edit callback used by inline edit, paste and Delete (preferred over onCellEdit). */
  onCellsChange?: (changes: DataGridCellChange[]) => void;
  /** Per-cell validation messages keyed with `dataGridCellKey(rowId, colKey)`. */
  cellErrors?: Readonly<Record<string, string>>;
  /** Optional row grouping (collapsible group header rows). */
  groupBy?: (row: Row) => { id: string; label: string } | null;
  /** Initial view state; bump `viewStateVersion` to re-apply it (e.g. a saved view). */
  initialViewState?: Partial<DataGridViewState>;
  viewStateVersion?: number;
  onViewStateChange?: (state: DataGridViewState) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Show freeze-columns and hide-rows controls in the toolbar. */
  enableLayoutTools?: boolean;
  toolbarExtra?: ReactNode;
  /** Receives the filtered, visible data in display order (for exports). */
  visibleDataRef?: MutableRefObject<DataGridVisibleData | null>;
  /** v1: status for the 3px left row bar (family name or task status code). */
  getRowStatus?: (row: Row) => string | null | undefined;
}

export function dataGridCellKey(rowId: string, colKey: string): string {
  return `${rowId}\u0001${colKey}`;
}

/** Parse clipboard text (TSV, Excel-style) into a matrix of strings. */
export function parseClipboardTable(text: string): string[][] {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!trimmed) return [];
  return trimmed.split('\n').map((line) => line.split('\t'));
}

interface CellCoord {
  row: number;
  col: number;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function parseCoord(key: string): CellCoord {
  const [r, c] = key.split(':');
  return { row: Number(r), col: Number(c) };
}

const EMPTY_VIEW: DataGridViewState = {
  sorting: [],
  columnFilters: [],
  globalFilter: '',
  columnVisibility: {},
  colWidths: {},
  frozenCount: 0,
  hiddenRowIds: [],
  collapsedGroups: [],
  showFilters: false,
};

function ResizableHeaderCell({
  colKey,
  width,
  children,
  onClick,
  onResize,
  title,
  stickyLeft,
}: {
  colKey: string;
  width: number;
  children: ReactNode;
  onClick: (e: MouseEvent) => void;
  onResize: (colKey: string, nextWidth: number) => void;
  title?: string;
  stickyLeft?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);
  useCssVarRef(ref, '--dg-left', stickyLeft);

  const startResize = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: globalThis.MouseEvent) => {
      onResize(colKey, Math.max(56, Math.min(480, Math.round(startW + ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={ref}
      role="columnheader"
      className="org-datagrid__th"
      data-frozen={stickyLeft ? 'true' : undefined}
      onClick={onClick}
      title={title}
    >
      {children}
      <span
        className="org-datagrid__resizer"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
      />
    </div>
  );
}

function GridWidthBox({
  width,
  className,
  stickyLeft,
  children,
}: {
  width: number;
  className: string;
  stickyLeft?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);
  useCssVarRef(ref, '--dg-left', stickyLeft);

  return (
    <div ref={ref} className={className} data-frozen={stickyLeft ? 'true' : undefined}>
      {children}
    </div>
  );
}

function GridCellBox({
  width,
  numeric,
  selected,
  active,
  error,
  stickyLeft,
  colKey,
  onClick,
  onDoubleClick,
  children,
}: {
  width: number;
  numeric?: boolean;
  selected: boolean;
  active: boolean;
  error?: string;
  stickyLeft?: string;
  colKey: string;
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);
  useCssVarRef(ref, '--dg-left', stickyLeft);

  return (
    <div
      ref={ref}
      role="gridcell"
      className="org-datagrid__cell"
      data-col={colKey}
      data-numeric={numeric ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-active={active ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-frozen={stickyLeft ? 'true' : undefined}
      aria-selected={selected || active}
      aria-invalid={error ? 'true' : undefined}
      title={error}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
      {error && (
        <span className="org-datagrid__cell-err" aria-hidden="true">
          !
        </span>
      )}
    </div>
  );
}

function VirtualGridRow({
  offsetY,
  odd,
  children,
  rowId,
  status,
}: {
  offsetY: number;
  odd: boolean;
  children: ReactNode;
  rowId?: string;
  status?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-row-y', `${offsetY}px`);

  return (
    <div
      ref={ref}
      role="row"
      className="org-datagrid__row"
      data-odd={odd ? 'true' : undefined}
      data-row-id={rowId}
      data-status={status}
    >
      {children}
    </div>
  );
}

function GroupHeaderRow({
  offsetY,
  label,
  count,
  collapsed,
  onToggle,
}: {
  offsetY: number;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-row-y', `${offsetY}px`);
  return (
    <div ref={ref} role="row" className="org-datagrid__row org-datagrid__group-row">
      <button
        type="button"
        role="rowheader"
        className="org-datagrid__group-toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span> {label}{' '}
        <span className="org-datagrid__group-count">({count})</span>
      </button>
    </div>
  );
}

const textOf = (col: DataGridColumn | undefined, value: unknown, row: Row): string => {
  if (col?.toText) return col.toText(value, row);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
};

type DisplayItem =
  | { kind: 'group'; id: string; label: string; count: number; collapsed: boolean }
  | { kind: 'row'; nav: number };

export function DataGrid({
  columns,
  rows,
  editable = false,
  onCellEdit,
  className,
  ariaLabel = 'Data Grid',
  getRowId,
  onCellsChange,
  cellErrors,
  groupBy,
  initialViewState,
  viewStateVersion = 0,
  onViewStateChange,
  onUndo,
  onRedo,
  enableLayoutTools = false,
  toolbarExtra,
  visibleDataRef,
  getRowStatus,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const initView = (): DataGridViewState => {
    const base = { ...EMPTY_VIEW, ...initialViewState };
    const widths: Record<string, number> = {};
    for (const c of columns) widths[c.key] = c.width ?? 120;
    return { ...base, colWidths: { ...widths, ...base.colWidths } };
  };
  const [view, setView] = useState<DataGridViewState>(initView);
  const appliedVersion = useRef(viewStateVersion);
  useEffect(() => {
    if (appliedVersion.current === viewStateVersion) return;
    appliedVersion.current = viewStateVersion;
    setView(initView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStateVersion]);
  const patchView = useCallback(
    (patch: Partial<DataGridViewState>) => setView((prev) => ({ ...prev, ...patch })),
    [],
  );
  const onViewRef = useRef(onViewStateChange);
  onViewRef.current = onViewStateChange;
  useEffect(() => {
    onViewRef.current?.(view);
  }, [view]);

  const { sorting, columnFilters, globalFilter, columnVisibility, colWidths, showFilters } = view;

  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const colMetaMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const textFilter = useMemo<FilterFn<LegacyFeatures, Row>>(
    () => (row, colId, filterValue) => {
      const needle = String(filterValue ?? '')
        .trim()
        .toLowerCase();
      if (!needle) return true;
      const col = colMetaMap.get(colId);
      return textOf(col, row.original[colId], row.original).toLowerCase().includes(needle);
    },
    [colMetaMap],
  );

  const tableColumns = useMemo<LegacyColumnDef<Row>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorFn: (row) => (c.numeric || !c.toText ? row[c.key] : c.toText(row[c.key], row)),
        header: c.header,
        sortingFn: c.numeric ? 'alphanumeric' : 'auto',
        sortUndefined: 'last',
        filterFn: textFilter,
        cell: (info) => {
          const raw = info.row.original[c.key];
          if (c.renderCell) return c.renderCell(raw, info.row.original);
          return textOf(c, raw, info.row.original);
        },
      })),
    [columns, textFilter],
  );

  const dataMemo = useMemo(() => [...rows], [rows]);

  const table = useLegacyTable({
    data: dataMemo,
    columns: tableColumns,
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: (u) =>
      setView((prev) => ({ ...prev, sorting: typeof u === 'function' ? u(prev.sorting) : u })),
    onColumnFiltersChange: (u) =>
      setView((prev) => ({
        ...prev,
        columnFilters: typeof u === 'function' ? u(prev.columnFilters) : u,
      })),
    onGlobalFilterChange: (u) =>
      setView((prev) => ({
        ...prev,
        globalFilter: typeof u === 'function' ? u(prev.globalFilter) : u,
      })),
    onColumnVisibilityChange: (u) =>
      setView((prev) => ({
        ...prev,
        columnVisibility: typeof u === 'function' ? u(prev.columnVisibility) : u,
      })),
    globalFilterFn: textFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleCols = table.getVisibleLeafColumns();
  const processedRows = table.getRowModel().rows;

  // Rows in display order: hidden rows removed, grouped (stable within a group).
  const hiddenSet = useMemo(() => new Set(view.hiddenRowIds), [view.hiddenRowIds]);
  const collapsedSet = useMemo(() => new Set(view.collapsedGroups), [view.collapsedGroups]);
  const { navRows, displayItems, exportRows } = useMemo(() => {
    const shown = processedRows.filter((r) => !hiddenSet.has(r.id));
    if (!groupBy) {
      return {
        navRows: shown,
        exportRows: shown,
        displayItems: shown.map((_, nav): DisplayItem => ({ kind: 'row', nav })),
      };
    }
    const groups = new Map<string, { label: string; rows: typeof shown }>();
    for (const r of shown) {
      const g = groupBy(r.original) ?? { id: '', label: '(none)' };
      if (!groups.has(g.id)) groups.set(g.id, { label: g.label, rows: [] });
      groups.get(g.id)!.rows.push(r);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
    const nav: typeof shown = [];
    const exp: typeof shown = [];
    const items: DisplayItem[] = [];
    for (const [id, g] of ordered) {
      const collapsed = collapsedSet.has(id);
      items.push({ kind: 'group', id, label: g.label, count: g.rows.length, collapsed });
      exp.push(...g.rows);
      if (collapsed) continue;
      for (const r of g.rows) {
        items.push({ kind: 'row', nav: nav.length });
        nav.push(r);
      }
    }
    return { navRows: nav, displayItems: items, exportRows: exp };
  }, [processedRows, hiddenSet, collapsedSet, groupBy]);

  if (visibleDataRef) {
    visibleDataRef.current = {
      columns: visibleCols
        .map((c) => colMetaMap.get(c.id))
        .filter((c): c is DataGridColumn => Boolean(c)),
      rows: exportRows.map((r) => r.original),
    };
  }

  // Frozen columns: sticky offsets measured from the gutter.
  const frozenCount = Math.min(view.frozenCount, visibleCols.length);
  const stickyLefts = useMemo(() => {
    const out: (string | undefined)[] = [];
    let acc = 0;
    visibleCols.forEach((c, i) => {
      if (i < frozenCount) {
        out.push(`calc(var(--grid-gutter-w) + ${acc}px)`);
        acc += colWidths[c.id] ?? 120;
      } else out.push(undefined);
    });
    return out;
  }, [visibleCols, frozenCount, colWidths]);

  const rowVirtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 8,
    initialRect: { width: 800, height: 240 },
  });

  useCssVarRef(
    canvasRef,
    '--dg-total-h',
    `${rowVirtualizer.getTotalSize() + (showFilters ? 44 : 23)}px`,
  );

  const handleHeaderSort = (colId: string, e: MouseEvent) => {
    const col = table.getColumn(colId);
    if (!col) return;
    col.toggleSorting(undefined, e.shiftKey);
  };

  const selectRange = useCallback((a: CellCoord, b: CellCoord) => {
    const r0 = Math.min(a.row, b.row);
    const r1 = Math.max(a.row, b.row);
    const c0 = Math.min(a.col, b.col);
    const c1 = Math.max(a.col, b.col);
    const next = new Set<string>();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        next.add(cellKey(r, c));
      }
    }
    setSelectedCells(next);
  }, []);

  const handleCellClick = (rowIdx: number, colIdx: number, e: MouseEvent) => {
    const coord = { row: rowIdx, col: colIdx };
    if (e.shiftKey && anchorCell) {
      selectRange(anchorCell, coord);
      setActiveCell(coord);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedCells((prev) => {
        const next = new Set(prev);
        const k = cellKey(rowIdx, colIdx);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
      setActiveCell(coord);
      setAnchorCell(coord);
      return;
    }
    setActiveCell(coord);
    setAnchorCell(coord);
    setSelectedCells(new Set([cellKey(rowIdx, colIdx)]));
  };

  const selectFullRow = (rowIdx: number, e?: MouseEvent) => {
    const next = new Set<string>(e?.ctrlKey || e?.metaKey ? selectedCells : []);
    const from = e?.shiftKey && anchorCell ? Math.min(anchorCell.row, rowIdx) : rowIdx;
    const to = e?.shiftKey && anchorCell ? Math.max(anchorCell.row, rowIdx) : rowIdx;
    for (let r = from; r <= to; r++) {
      for (let c = 0; c < visibleCols.length; c++) next.add(cellKey(r, c));
    }
    setSelectedCells(next);
    setActiveCell({ row: rowIdx, col: 0 });
    if (!e?.shiftKey) setAnchorCell({ row: rowIdx, col: 0 });
  };

  const isColEditable = (colId: string | undefined): boolean => {
    if (!editable || !colId) return false;
    return colMetaMap.get(colId)?.editable !== false;
  };

  const emitChanges = (changes: DataGridCellChange[]) => {
    if (changes.length === 0) return;
    if (onCellsChange) {
      onCellsChange(changes);
      return;
    }
    if (!onCellEdit) return;
    for (const ch of changes) {
      const rowObj = table.getRow(ch.rowId);
      if (rowObj) onCellEdit(rowObj.index, ch.colKey, String(ch.value ?? ''));
    }
  };

  const startEditing = (rowIdx: number, colIdx: number) => {
    const colId = visibleCols[colIdx]?.id;
    if (!isColEditable(colId)) return;
    const rowObj = navRows[rowIdx];
    if (!rowObj || !colId) return;
    setEditingCell({ row: rowIdx, col: colIdx });
    setEditDraft(textOf(colMetaMap.get(colId), rowObj.original[colId], rowObj.original));
  };

  const commitValue = (coord: CellCoord, value: unknown) => {
    const rowObj = navRows[coord.row];
    const colId = visibleCols[coord.col]?.id;
    setEditingCell(null);
    if (!rowObj || !colId) return;
    const before = textOf(colMetaMap.get(colId), rowObj.original[colId], rowObj.original);
    if (typeof value === 'string' && value === before) return;
    if (onCellsChange) emitChanges([{ rowId: rowObj.id, colKey: colId, value }]);
    else onCellEdit?.(rowObj.index, colId, String(value ?? ''));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    commitValue(editingCell, editDraft);
  };

  const selectionBounds = () => {
    const coords = Array.from(selectedCells).map(parseCoord);
    if (coords.length === 0) return null;
    return {
      minR: Math.min(...coords.map((p) => p.row)),
      maxR: Math.max(...coords.map((p) => p.row)),
      minC: Math.min(...coords.map((p) => p.col)),
      maxC: Math.max(...coords.map((p) => p.col)),
    };
  };

  const copySelectedTsv = useCallback(() => {
    if (selectedCells.size === 0) return;
    const coords = Array.from(selectedCells).map(parseCoord);
    const minR = Math.min(...coords.map((p) => p.row));
    const maxR = Math.max(...coords.map((p) => p.row));
    const minC = Math.min(...coords.map((p) => p.col));
    const maxC = Math.max(...coords.map((p) => p.col));
    const lines: string[] = [];
    for (let r = minR; r <= maxR; r++) {
      const cells: string[] = [];
      for (let c = minC; c <= maxC; c++) {
        const colId = visibleCols[c]?.id;
        const rowObj = navRows[r];
        if (!selectedCells.has(cellKey(r, c)) || !colId || !rowObj) {
          cells.push('');
          continue;
        }
        cells.push(textOf(colMetaMap.get(colId), rowObj.original[colId], rowObj.original));
      }
      lines.push(cells.join('\t'));
    }
    const tsv = lines.join('\n');
    void navigator.clipboard?.writeText?.(tsv);
    setCopiedNotice(true);
    window.setTimeout(() => setCopiedNotice(false), 1200);
  }, [navRows, selectedCells, visibleCols, colMetaMap]);

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editingCell || !editable) return;
    const matrix = parseClipboardTable(e.clipboardData.getData('text/plain'));
    if (matrix.length === 0) return;
    e.preventDefault();
    const bounds = selectionBounds();
    const start = bounds ? { row: bounds.minR, col: bounds.minC } : activeCell;
    if (!start) return;
    const changes: DataGridCellChange[] = [];
    const single = matrix.length === 1 && matrix[0]!.length === 1;
    if (single && selectedCells.size > 1) {
      // One value into a selection fills every selected cell (Excel behaviour).
      for (const k of selectedCells) {
        const { row, col } = parseCoord(k);
        const colId = visibleCols[col]?.id;
        const rowObj = navRows[row];
        if (rowObj && colId && isColEditable(colId)) {
          changes.push({ rowId: rowObj.id, colKey: colId, value: matrix[0]![0] });
        }
      }
    } else {
      matrix.forEach((line, dr) => {
        line.forEach((val, dc) => {
          const rowObj = navRows[start.row + dr];
          const colId = visibleCols[start.col + dc]?.id;
          if (rowObj && colId && isColEditable(colId)) {
            changes.push({ rowId: rowObj.id, colKey: colId, value: val });
          }
        });
      });
      const endR = Math.min(navRows.length - 1, start.row + matrix.length - 1);
      const endC = Math.min(
        visibleCols.length - 1,
        start.col + Math.max(...matrix.map((l) => l.length)) - 1,
      );
      selectRange(start, { row: endR, col: endC });
    }
    emitChanges(changes);
  };

  const clearSelection = () => {
    const changes: DataGridCellChange[] = [];
    for (const k of selectedCells) {
      const { row, col } = parseCoord(k);
      const colId = visibleCols[col]?.id;
      const rowObj = navRows[row];
      if (rowObj && colId && isColEditable(colId) && rowObj.original[colId] != null) {
        changes.push({ rowId: rowObj.id, colKey: colId, value: onCellsChange ? null : '' });
      }
    }
    emitChanges(changes);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingCell) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey && onUndo) {
      e.preventDefault();
      onUndo();
      return;
    }
    if (mod && ((key === 'z' && e.shiftKey) || key === 'y') && onRedo) {
      e.preventDefault();
      onRedo();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      const next = new Set<string>();
      for (let r = 0; r < navRows.length; r++) {
        for (let c = 0; c < visibleCols.length; c++) next.add(cellKey(r, c));
      }
      setSelectedCells(next);
      return;
    }
    if (mod && key === 'c') {
      e.preventDefault();
      copySelectedTsv();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selectedCells.size > 0) {
      e.preventDefault();
      clearSelection();
      return;
    }
    if (!activeCell) return;
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault();
      startEditing(activeCell.row, activeCell.col);
      return;
    }
    let nr = activeCell.row;
    let nc = activeCell.col;
    if (e.key === 'ArrowDown') nr = Math.min(navRows.length - 1, nr + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, nr - 1);
    else if (e.key === 'ArrowRight' || e.key === 'Tab')
      nc = Math.min(visibleCols.length - 1, nc + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, nc - 1);
    else return;
    e.preventDefault();
    const nextCoord = { row: nr, col: nc };
    setActiveCell(nextCoord);
    if (e.shiftKey && anchorCell) {
      selectRange(anchorCell, nextCoord);
    } else {
      setAnchorCell(nextCoord);
      setSelectedCells(new Set([cellKey(nr, nc)]));
    }
  };

  useEffect(() => {
    setView((prev) => {
      const missing = columns.filter((c) => prev.colWidths[c.key] === undefined);
      if (missing.length === 0) return prev;
      const next = { ...prev.colWidths };
      for (const c of missing) next[c.key] = c.width ?? 120;
      return { ...prev, colWidths: next };
    });
  }, [columns]);

  const numericStats = useMemo(() => {
    const nums: number[] = [];
    for (const k of selectedCells) {
      const { row, col } = parseCoord(k);
      const colId = visibleCols[col]?.id;
      const raw = colId ? navRows[row]?.original[colId] : undefined;
      if (raw !== null && raw !== undefined && typeof raw !== 'boolean' && String(raw).trim()) {
        const n = Number(raw);
        if (Number.isFinite(n)) nums.push(n);
      }
    }
    if (nums.length === 0) return null;
    const sum = nums.reduce((acc, n) => acc + n, 0);
    return {
      count: nums.length,
      sum,
      avg: sum / nums.length,
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
  }, [navRows, selectedCells, visibleCols]);

  const selectedRowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const k of selectedCells) {
      const r = navRows[parseCoord(k).row];
      if (r) ids.add(r.id);
    }
    return ids;
  }, [selectedCells, navRows]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const renderItems =
    virtualItems.length > 0
      ? virtualItems
      : displayItems.slice(0, 40).map((_, index) => ({ index, start: index * 20 }));

  return (
    <div
      className={cn('org-datagrid', className)}
      role="grid"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    >
      <div className="org-datagrid__toolbar">
        <SearchField
          className="org-datagrid__search"
          value={globalFilter}
          onChange={(v) => patchView({ globalFilter: v })}
          placeholder="Search rows..."
          ariaLabel="Search grid rows"
        />
        <Button
          size="sm"
          pressed={showFilters}
          onClick={() => patchView({ showFilters: !showFilters })}
          title="Toggle per-column filters"
        >
          Filters
        </Button>
        <Popover trigger={<Button size="sm">Columns</Button>}>
          <div className="org-datagrid__col-menu">
            <Text variant="muted">Visible Columns</Text>
            {table.getAllLeafColumns().map((col) => (
              <Checkbox
                key={col.id}
                label={colMetaMap.get(col.id)?.header ?? col.id}
                checked={col.getIsVisible()}
                onChange={(checked) => col.toggleVisibility(checked)}
              />
            ))}
          </div>
        </Popover>
        {enableLayoutTools && (
          <>
            <Popover
              trigger={
                <Button size="sm" pressed={frozenCount > 0}>
                  {frozenCount > 0 ? `Frozen: ${frozenCount}` : 'Freeze'}
                </Button>
              }
            >
              <div className="org-datagrid__col-menu" role="group" aria-label="Freeze columns">
                <Text variant="muted">Freeze leading columns</Text>
                {[0, 1, 2, 3].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    pressed={frozenCount === n}
                    onClick={() => patchView({ frozenCount: n })}
                  >
                    {n === 0 ? 'None' : `First ${n}`}
                  </Button>
                ))}
              </div>
            </Popover>
            <Button
              size="sm"
              disabled={selectedRowIds.size === 0}
              onClick={() => {
                patchView({ hiddenRowIds: [...view.hiddenRowIds, ...selectedRowIds] });
                setSelectedCells(new Set());
                setActiveCell(null);
              }}
              title="Hide the rows of the selected cells"
            >
              Hide rows
            </Button>
            {view.hiddenRowIds.length > 0 && (
              <Button size="sm" onClick={() => patchView({ hiddenRowIds: [] })}>
                Unhide {view.hiddenRowIds.length}
              </Button>
            )}
          </>
        )}
        {toolbarExtra}
        <span className="org-datagrid__spacer" />
        <Button size="sm" onClick={copySelectedTsv} disabled={selectedCells.size === 0}>
          {copiedNotice ? 'Copied TSV' : 'Copy TSV'}
        </Button>
      </div>

      <div ref={scrollRef} className="org-datagrid__scroll">
        <div ref={canvasRef} className="org-datagrid__canvas">
          <div className="org-datagrid__thead" role="rowgroup">
            <div className="org-datagrid__header-row" role="row">
              <div className="org-datagrid__gutter-head">#</div>
              {visibleCols.map((col, cIdx) => {
                const sortIdx = sorting.findIndex((s) => s.id === col.id);
                const sortState = sortIdx >= 0 ? sorting[sortIdx] : null;
                const meta = colMetaMap.get(col.id);
                return (
                  <ResizableHeaderCell
                    key={col.id}
                    colKey={col.id}
                    width={colWidths[col.id] ?? 120}
                    stickyLeft={stickyLefts[cIdx]}
                    onClick={(e) => handleHeaderSort(col.id, e)}
                    onResize={(k, w) =>
                      setView((prev) => ({ ...prev, colWidths: { ...prev.colWidths, [k]: w } }))
                    }
                    title={meta?.headerTitle ?? 'Click to sort; Shift+Click for multi-sort'}
                  >
                    <span className="org-datagrid__th-label">{meta?.header ?? col.id}</span>
                    {sortState && (
                      <span className="org-datagrid__sort-badge">
                        {sortState.desc ? '▼' : '▲'}
                        {sorting.length > 1 ? sortIdx + 1 : ''}
                      </span>
                    )}
                  </ResizableHeaderCell>
                );
              })}
            </div>

            {showFilters && (
              <div className="org-datagrid__filter-row" role="row">
                <div className="org-datagrid__gutter-cell">fx</div>
                {visibleCols.map((col, cIdx) => (
                  <GridWidthBox
                    key={col.id}
                    width={colWidths[col.id] ?? 120}
                    stickyLeft={stickyLefts[cIdx]}
                    className="org-datagrid__filter-cell"
                  >
                    <input
                      className="org-datagrid__filter-input"
                      value={(col.getFilterValue() as string | undefined) ?? ''}
                      onChange={(e) => col.setFilterValue(e.target.value)}
                      placeholder="Filter..."
                      aria-label={`Filter ${colMetaMap.get(col.id)?.header ?? col.id}`}
                    />
                  </GridWidthBox>
                ))}
              </div>
            )}
          </div>

          <div className="org-datagrid__body" role="rowgroup">
            {renderItems.map((vItem) => {
              const item = displayItems[vItem.index];
              if (!item) return null;
              if (item.kind === 'group') {
                return (
                  <GroupHeaderRow
                    key={`g:${item.id}`}
                    offsetY={vItem.start}
                    label={item.label}
                    count={item.count}
                    collapsed={item.collapsed}
                    onToggle={() =>
                      patchView({
                        collapsedGroups: item.collapsed
                          ? view.collapsedGroups.filter((g) => g !== item.id)
                          : [...view.collapsedGroups, item.id],
                      })
                    }
                  />
                );
              }
              const navIdx = item.nav;
              const row = navRows[navIdx];
              if (!row) return null;
              return (
                <VirtualGridRow
                  key={row.id}
                  rowId={row.id}
                  offsetY={vItem.start}
                  odd={navIdx % 2 === 1}
                  status={getRowStatus ? toRowStatus(getRowStatus(row.original)) : undefined}
                >
                  <div
                    className="org-datagrid__gutter-cell"
                    onClick={(e) => selectFullRow(navIdx, e)}
                    title="Select row"
                  >
                    {navIdx + 1}
                  </div>
                  {row.getVisibleCells().map((cell, cIdx) => {
                    const isEditing = editingCell?.row === navIdx && editingCell?.col === cIdx;
                    const k = cellKey(navIdx, cIdx);
                    const isActive = activeCell?.row === navIdx && activeCell?.col === cIdx;
                    const colDef = colMetaMap.get(cell.column.id);
                    const err = cellErrors?.[dataGridCellKey(row.id, cell.column.id)];
                    return (
                      <GridCellBox
                        key={cell.id}
                        colKey={cell.column.id}
                        width={colWidths[cell.column.id] ?? 120}
                        numeric={colDef?.numeric}
                        selected={selectedCells.has(k)}
                        active={isActive}
                        error={err}
                        stickyLeft={stickyLefts[cIdx]}
                        onClick={(e) => handleCellClick(navIdx, cIdx, e)}
                        onDoubleClick={() => startEditing(navIdx, cIdx)}
                      >
                        {isEditing && colDef?.renderEditor ? (
                          colDef.renderEditor({
                            value: row.original[cell.column.id],
                            initialText: editDraft,
                            row: row.original,
                            onCommit: (v) => commitValue({ row: navIdx, col: cIdx }, v),
                            onCancel: () => setEditingCell(null),
                          })
                        ) : isEditing ? (
                          <input
                            className="org-datagrid__cell-edit"
                            autoFocus
                            aria-label={`Edit ${colDef?.header ?? cell.column.id}`}
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') {
                                ev.preventDefault();
                                commitEdit();
                              } else if (ev.key === 'Escape') {
                                ev.preventDefault();
                                setEditingCell(null);
                              } else if (ev.key === 'Tab') {
                                ev.preventDefault();
                                commitEdit();
                                const nextC = Math.min(visibleCols.length - 1, cIdx + 1);
                                setActiveCell({ row: navIdx, col: nextC });
                              }
                            }}
                          />
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </GridCellBox>
                    );
                  })}
                </VirtualGridRow>
              );
            })}
          </div>
        </div>
      </div>

      <div className="org-datagrid__footer">
        <span>
          Rows: <strong className="org-datagrid__stat">{exportRows.length}</strong> / {rows.length}
        </span>
        <span>
          Selected: <strong className="org-datagrid__stat">{selectedCells.size}</strong>
        </span>
        {view.hiddenRowIds.length > 0 && (
          <span>
            Hidden: <strong className="org-datagrid__stat">{view.hiddenRowIds.length}</strong>
          </span>
        )}
        {numericStats && (
          <>
            <span>
              Sum: <strong className="org-datagrid__stat">{numericStats.sum.toFixed(2)}</strong>
            </span>
            <span>
              Avg: <strong className="org-datagrid__stat">{numericStats.avg.toFixed(2)}</strong>
            </span>
            <span>
              Min: <strong className="org-datagrid__stat">{numericStats.min.toFixed(2)}</strong>
            </span>
            <span>
              Max: <strong className="org-datagrid__stat">{numericStats.max.toFixed(2)}</strong>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
