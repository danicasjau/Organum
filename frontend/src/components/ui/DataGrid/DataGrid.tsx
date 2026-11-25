import {
  flexRender,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from '@tanstack/react-table/legacy';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Button } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { Popover } from '../Overlays/Overlays';
import { SearchField } from '../TextField/TextField';
import { Text } from '../Typography/Typography';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './DataGrid.css';

export interface DataGridColumn {
  key: string;
  header: string;
  numeric?: boolean;
  width?: number;
  editable?: boolean;
}

export interface DataGridProps {
  columns: ReadonlyArray<DataGridColumn>;
  rows: ReadonlyArray<Record<string, unknown>>;
  editable?: boolean;
  onCellEdit?: (rowIndex: number, columnKey: string, nextValue: string) => void;
  className?: string;
  ariaLabel?: string;
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

function ResizableHeaderCell({
  colKey,
  width,
  children,
  onClick,
  onResize,
  title,
}: {
  colKey: string;
  width: number;
  children: React.ReactNode;
  onClick: (e: MouseEvent) => void;
  onResize: (colKey: string, nextWidth: number) => void;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);

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
  children,
}: {
  width: number;
  className: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

function GridCellBox({
  width,
  numeric,
  selected,
  active,
  onClick,
  onDoubleClick,
  children,
}: {
  width: number;
  numeric?: boolean;
  selected: boolean;
  active: boolean;
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-col-w', `${width}px`);

  return (
    <div
      ref={ref}
      role="gridcell"
      className="org-datagrid__cell"
      data-numeric={numeric ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-active={active ? 'true' : undefined}
      aria-selected={selected || active}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
}

function VirtualGridRow({
  offsetY,
  odd,
  children,
}: {
  offsetY: number;
  odd: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--dg-row-y', `${offsetY}px`);

  return (
    <div ref={ref} role="row" className="org-datagrid__row" data-odd={odd ? 'true' : undefined}>
      {children}
    </div>
  );
}

export function DataGrid({
  columns,
  rows,
  editable = false,
  onCellEdit,
  className,
  ariaLabel = 'Data Grid',
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const c of columns) init[c.key] = c.width ?? 120;
    return init;
  });

  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const tableColumns = useMemo<LegacyColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorFn: (row) => row[c.key],
        header: c.header,
        sortingFn: c.numeric ? 'alphanumeric' : 'auto',
        filterFn: 'includesString',
        cell: (info) => {
          const val = info.getValue();
          return val === null || val === undefined ? '' : String(val);
        },
      })),
    [columns],
  );

  const dataMemo = useMemo(() => [...rows], [rows]);

  const table = useLegacyTable({
    data: dataMemo,
    columns: tableColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleCols = table.getVisibleLeafColumns();
  const processedRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: processedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 8,
    initialRect: { width: 800, height: 240 },
  });

  useCssVarRef(canvasRef, '--dg-total-h', `${rowVirtualizer.getTotalSize() + (showFilters ? 44 : 23)}px`);

  const handleHeaderSort = (colId: string, e: MouseEvent) => {
    const col = table.getColumn(colId);
    if (!col) return;
    col.toggleSorting(undefined, e.shiftKey);
  };

  const selectRange = useCallback(
    (a: CellCoord, b: CellCoord) => {
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
    },
    [],
  );

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

  const selectFullRow = (rowIdx: number) => {
    const next = new Set<string>();
    for (let c = 0; c < visibleCols.length; c++) {
      next.add(cellKey(rowIdx, c));
    }
    setSelectedCells(next);
    setActiveCell({ row: rowIdx, col: 0 });
    setAnchorCell({ row: rowIdx, col: 0 });
  };

  const startEditing = (rowIdx: number, colIdx: number) => {
    if (!editable) return;
    const colDef = columns.find((c) => c.key === visibleCols[colIdx]?.id);
    if (colDef?.editable === false) return;
    const rowObj = processedRows[rowIdx];
    const colId = visibleCols[colIdx]?.id;
    if (!rowObj || !colId) return;
    const curVal = rowObj.getValue(colId);
    setEditingCell({ row: rowIdx, col: colIdx });
    setEditDraft(curVal === null || curVal === undefined ? '' : String(curVal));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const rowObj = processedRows[editingCell.row];
    const colId = visibleCols[editingCell.col]?.id;
    if (rowObj && colId && onCellEdit) {
      onCellEdit(rowObj.index, colId, editDraft);
    }
    setEditingCell(null);
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
        if (!selectedCells.has(cellKey(r, c))) {
          cells.push('');
          continue;
        }
        const colId = visibleCols[c]?.id;
        const val = colId ? processedRows[r]?.getValue(colId) : '';
        cells.push(val === null || val === undefined ? '' : String(val));
      }
      lines.push(cells.join('\t'));
    }
    const tsv = lines.join('\n');
    void navigator.clipboard?.writeText?.(tsv);
    setCopiedNotice(true);
    window.setTimeout(() => setCopiedNotice(false), 1200);
  }, [processedRows, selectedCells, visibleCols]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingCell) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const next = new Set<string>();
      for (let r = 0; r < processedRows.length; r++) {
        for (let c = 0; c < visibleCols.length; c++) next.add(cellKey(r, c));
      }
      setSelectedCells(next);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelectedTsv();
      return;
    }
    if (!activeCell) return;
    if (e.key === 'F2') {
      e.preventDefault();
      startEditing(activeCell.row, activeCell.col);
      return;
    }
    let nr = activeCell.row;
    let nc = activeCell.col;
    if (e.key === 'ArrowDown') nr = Math.min(processedRows.length - 1, nr + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, nr - 1);
    else if (e.key === 'ArrowRight' || e.key === 'Tab') nc = Math.min(visibleCols.length - 1, nc + 1);
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
    setColWidths((prev) => {
      const next = { ...prev };
      for (const c of columns) {
        if (next[c.key] === undefined) next[c.key] = c.width ?? 120;
      }
      return next;
    });
  }, [columns]);

  const numericStats = useMemo(() => {
    const nums: number[] = [];
    for (const k of selectedCells) {
      const { row, col } = parseCoord(k);
      const colId = visibleCols[col]?.id;
      const raw = colId ? processedRows[row]?.getValue(colId) : undefined;
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
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
  }, [processedRows, selectedCells, visibleCols]);

  const colMetaMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const renderItems =
    virtualItems.length > 0
      ? virtualItems
      : processedRows.slice(0, 40).map((_, index) => ({ index, start: index * 20 }));

  return (
    <div
      className={cn('org-datagrid', className)}
      role="grid"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="org-datagrid__toolbar">
        <SearchField
          className="org-datagrid__search"
          value={globalFilter}
          onChange={setGlobalFilter}
          placeholder="Search rows..."
          ariaLabel="Search grid rows"
        />
        <Button
          size="sm"
          pressed={showFilters}
          onClick={() => setShowFilters((s) => !s)}
          title="Toggle per-column filters"
        >
          Filters
        </Button>
        <Popover
          trigger={<Button size="sm">Columns</Button>}
        >
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
              {visibleCols.map((col) => {
                const sortIdx = sorting.findIndex((s) => s.id === col.id);
                const sortState = sortIdx >= 0 ? sorting[sortIdx] : null;
                return (
                  <ResizableHeaderCell
                    key={col.id}
                    colKey={col.id}
                    width={colWidths[col.id] ?? 120}
                    onClick={(e) => handleHeaderSort(col.id, e)}
                    onResize={(k, w) => setColWidths((prev) => ({ ...prev, [k]: w }))}
                    title="Click to sort; Shift+Click for multi-sort"
                  >
                    <span className="org-datagrid__th-label">
                      {colMetaMap.get(col.id)?.header ?? col.id}
                    </span>
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
                {visibleCols.map((col) => (
                  <GridWidthBox
                    key={col.id}
                    width={colWidths[col.id] ?? 120}
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
              const row = processedRows[vItem.index];
              if (!row) return null;
              return (
                <VirtualGridRow key={row.id} offsetY={vItem.start} odd={vItem.index % 2 === 1}>
                  <div
                    className="org-datagrid__gutter-cell"
                    onClick={() => selectFullRow(vItem.index)}
                    title="Select row"
                  >
                    {vItem.index + 1}
                  </div>
                  {row.getVisibleCells().map((cell, cIdx) => {
                    const isEditing =
                      editingCell?.row === vItem.index && editingCell?.col === cIdx;
                    const k = cellKey(vItem.index, cIdx);
                    const isActive =
                      activeCell?.row === vItem.index && activeCell?.col === cIdx;
                    const colDef = colMetaMap.get(cell.column.id);
                    return (
                      <GridCellBox
                        key={cell.id}
                        width={colWidths[cell.column.id] ?? 120}
                        numeric={colDef?.numeric}
                        selected={selectedCells.has(k)}
                        active={isActive}
                        onClick={(e) => handleCellClick(vItem.index, cIdx, e)}
                        onDoubleClick={() => startEditing(vItem.index, cIdx)}
                      >
                        {isEditing ? (
                          <input
                            className="org-datagrid__cell-edit"
                            autoFocus
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
                                setActiveCell({ row: vItem.index, col: nextC });
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
          Rows: <strong className="org-datagrid__stat">{processedRows.length}</strong> /{' '}
          {rows.length}
        </span>
        <span>
          Selected: <strong className="org-datagrid__stat">{selectedCells.size}</strong>
        </span>
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
