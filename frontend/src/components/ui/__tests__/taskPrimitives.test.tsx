import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PriorityMarker, StatusChip, ViewSwitcher } from '..';

describe('CR03 Phase 7C task UI primitives', () => {
  it('renders all 9 workflow statuses with distinct glyphs and code text', () => {
    const statuses = ['WTG', 'RDY', 'IP', 'RTK', 'P_LEAD', 'P_SUP', 'P_CLIENT', 'APP', 'HLD'];
    const { container } = render(
      <div>
        {statuses.map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </div>,
    );
    const glyphs = new Set<string>();
    for (const s of statuses) {
      const el = container.querySelector(`[data-status="${s}"]`);
      expect(el).toBeInTheDocument();
      expect(screen.getByText(s)).toBeInTheDocument();
      const g = el?.querySelector('.org-statuschip__glyph')?.textContent ?? '';
      expect(g.length).toBeGreaterThan(0);
      glyphs.add(g);
    }
    expect(glyphs.size).toBe(statuses.length);
  });

  it('renders PriorityMarker for high and stopper and null for normal', () => {
    const { container } = render(
      <div>
        <PriorityMarker priority="normal" />
        <PriorityMarker priority="high" />
        <PriorityMarker priority="stopper" />
      </div>,
    );
    expect(container.querySelectorAll('[data-ui="priority-marker"]')).toHaveLength(2);
    expect(screen.getByLabelText('High priority')).toHaveTextContent('High');
    expect(screen.getByLabelText('Stopper priority')).toHaveTextContent('Critical');
  });

  it('switches views via ViewSwitcher', () => {
    const onChange = vi.fn();
    render(
      <ViewSwitcher
        activeId="grid"
        onChange={onChange}
        items={[
          { id: 'grid', label: 'Grid', count: 12 },
          { id: 'matrix', label: 'Matrix' },
          { id: 'kanban', label: 'Kanban' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: /Grid/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Kanban' }));
    expect(onChange).toHaveBeenCalledWith('kanban');
  });
});

