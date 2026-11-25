import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, CapacityBadge, CapacityBadgeList, UserPicker } from '..';

describe('CR03 identity & capacity primitives', () => {
  it('renders deterministic initials Avatar tiles', () => {
    render(
      <div>
        <Avatar username="dir_alex" fullName="Alex Vance" size="sm" />
        <Avatar username="cli_jordan" fullName="Jordan Blake" size="md" />
      </div>,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.getByText('JB')).toBeInTheDocument();
  });

  it('renders distinct DO / LEAD / SUP CapacityBadge items', () => {
    render(<CapacityBadgeList capacities={['supervisor', 'artist', 'lead']} />);
    expect(screen.getByText('DO')).toBeInTheDocument();
    expect(screen.getByText('LEAD')).toBeInTheDocument();
    expect(screen.getByText('SUP')).toBeInTheDocument();

    const { container } = render(<CapacityBadge capacity="artist" />);
    expect(container.querySelector('[data-capacity="artist"]')).toBeInTheDocument();
  });

  it('renders UserPicker trigger with selected summary', () => {
    const onChange = vi.fn();
    render(
      <UserPicker
        users={[
          { id: 'u1', username: 'art_sam', fullName: 'Sam Rivera', roleLabel: 'Artist' },
          { id: 'u2', username: 'lead_marco', fullName: 'Marco Silva', roleLabel: 'Lead' },
        ]}
        selectedIds={['u1']}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pick users' })).toHaveTextContent('Sam Rivera');
  });
});

