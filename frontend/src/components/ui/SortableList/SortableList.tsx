import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './SortableList.css';

/** Pure helper: move `id` to the slot before/after `targetId`. Returns a new id list. */
export function moveId(
  ids: ReadonlyArray<string>,
  id: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  if (id === targetId) return [...ids];
  const without = ids.filter((x) => x !== id);
  const targetIdx = without.indexOf(targetId);
  if (targetIdx < 0 || without.length === ids.length) return [...ids];
  without.splice(position === 'before' ? targetIdx : targetIdx + 1, 0, id);
  return without;
}

/** Pure helper: move `id` by `delta` slots (clamped). */
export function shiftId(ids: ReadonlyArray<string>, id: string, delta: number): string[] {
  const idx = ids.indexOf(id);
  if (idx < 0) return [...ids];
  const target = Math.max(0, Math.min(ids.length - 1, idx + delta));
  if (target === idx) return [...ids];
  const next = [...ids];
  next.splice(idx, 1);
  next.splice(target, 0, id);
  return next;
}

export interface SortableListProps<T> {
  items: ReadonlyArray<T>;
  getId: (item: T) => string;
  /** Accessible name of each item (used by the drag handle label). */
  getLabel: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  onReorder: (ids: string[]) => void;
  ariaLabel: string;
  disabled?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

/**
 * Drag-and-drop reorderable list (native HTML5 DnD, no library). Drag starts on the grip.
 * Keyboard: focus a row's grip and press Arrow Up / Arrow Down to move it.
 */
export function SortableList<T>({
  items,
  getId,
  getLabel,
  renderItem,
  onReorder,
  ariaLabel,
  disabled = false,
  selectedId = null,
  onSelect,
  className,
}: SortableListProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const ids = items.map(getId);

  const onDragOver = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (drop?.id !== id || drop.pos !== pos) setDrop({ id, pos });
  };

  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragId && drop) {
      const next = moveId(ids, dragId, drop.id, drop.pos);
      if (next.join() !== ids.join()) onReorder(next);
    }
    setDragId(null);
    setDrop(null);
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = shiftId(ids, id, e.key === 'ArrowUp' ? -1 : 1);
    if (next.join() !== ids.join()) onReorder(next);
  };

  return (
    <ul className={cn('org-sortable', className)} aria-label={ariaLabel} data-ui="sortable-list">
      {items.map((item, index) => {
        const id = getId(item);
        const label = getLabel(item);
        return (
          <li
            key={id}
            className="org-sortable__row"
            data-sortable-id={id}
            data-dragging={dragId === id ? 'true' : undefined}
            data-drop={drop?.id === id && dragId !== id ? drop.pos : undefined}
            data-selected={selectedId === id ? 'true' : undefined}
            aria-current={selectedId === id ? 'true' : undefined}
            onDragOver={(e) => onDragOver(e, id)}
            onDrop={onDrop}
            onDragEnd={() => {
              setDragId(null);
              setDrop(null);
            }}
            onClick={onSelect ? () => onSelect(id) : undefined}
          >
            <button
              type="button"
              className="org-sortable__grip"
              aria-label={`Reorder ${label} (position ${index + 1} of ${items.length})`}
              title="Drag to reorder (or focus and use Arrow Up / Down)"
              disabled={disabled}
              // Only the grip starts a drag, so inputs inside rows keep normal text selection.
              draggable={!disabled}
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
                const row = e.currentTarget.closest('li');
                if (row) e.dataTransfer.setDragImage(row, 8, 8);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDrop(null);
              }}
              onKeyDown={(e) => onGripKey(e, id)}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="grip" size="sm" />
            </button>
            <div className="org-sortable__body">{renderItem(item, index)}</div>
          </li>
        );
      })}
    </ul>
  );
}
