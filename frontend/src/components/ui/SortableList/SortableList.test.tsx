import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SortableList, moveId, shiftId } from './SortableList';

const ITEMS = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

describe('SortableList helpers', () => {
  it('moveId places before/after the target', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 'a', 'a', 'after')).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b'], 'x', 'a', 'before')).toEqual(['a', 'b']);
  });

  it('shiftId clamps at the ends', () => {
    expect(shiftId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(shiftId(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(shiftId(['a', 'b', 'c'], 'c', 5)).toEqual(['a', 'b', 'c']);
  });
});

describe('SortableList', () => {
  const setup = () => {
    const onReorder = vi.fn();
    render(
      <SortableList
        ariaLabel="Things"
        items={ITEMS}
        getId={(i) => i.id}
        getLabel={(i) => i.name}
        renderItem={(i) => <span>{i.name}</span>}
        onReorder={onReorder}
      />,
    );
    return onReorder;
  };

  it('reorders with the keyboard on the grip', () => {
    const onReorder = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder Bravo/ }), { key: 'ArrowUp' });
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('reorders with drag and drop', () => {
    const onReorder = setup();
    const rows = screen.getAllByRole('listitem');
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: /Reorder Charlie/ }), { dataTransfer });
    // jsdom has no DragEvent geometry (clientY is 0 on a zero-sized rect), so the drop
    // resolves to "after" the target; the before/after split is covered in Playwright.
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });
});
