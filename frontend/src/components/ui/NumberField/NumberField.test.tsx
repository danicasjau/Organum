import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

describe('NumberField', () => {
  it('formats float values with fixed precision and evaluates math expressions', () => {
    const onChange = vi.fn();
    render(<NumberField value={1.5} onChange={onChange} precision={2} ariaLabel="Exposure" />);

    const input = screen.getByRole('spinbutton', { name: 'Exposure' }) as HTMLInputElement;
    expect(input.value).toBe('1.50');

    // Enter edit mode via double-click and enter arithmetic expression
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: '2 * 3.5 + (4 / 2)' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('clamps to min/max and marks invalid expressions with error state', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NumberField value={5} min={0} max={10} mode="int" onChange={onChange} ariaLabel="Samples" />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Samples' }) as HTMLInputElement;

    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(10);

    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: 'abc + /' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('[data-ui="number-field"]')).toHaveAttribute('data-error', 'true');
  });

  it('steps with ArrowUp/ArrowDown and resets dirty state', () => {
    const onChange = vi.fn();
    render(
      <NumberField
        value={2.0}
        baselineValue={1.0}
        step={0.5}
        precision={1}
        onChange={onChange}
        ariaLabel="Gamma"
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Gamma' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(2.5);

    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(-3.0);

    const resetBtn = screen.getByRole('button', { name: 'Reset value' });
    fireEvent.click(resetBtn);
    expect(onChange).toHaveBeenCalledWith(1.0);
  });

  it('updates background fill percentage as bounded value changes', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <NumberField value={0} min={0} max={100} onChange={onChange} ariaLabel="Progress" />,
    );
    const fill = container.querySelector('.org-numfield__fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.getPropertyValue('--numfield-pct')).toBe('0.00%');

    rerender(<NumberField value={50} min={0} max={100} onChange={onChange} ariaLabel="Progress" />);
    expect(fill.style.getPropertyValue('--numfield-pct')).toBe('50.00%');

    rerender(<NumberField value={100} min={0} max={100} onChange={onChange} ariaLabel="Progress" />);
    expect(fill.style.getPropertyValue('--numfield-pct')).toBe('100.00%');

    rerender(<NumberField value={25} min={0} max={100} onChange={onChange} ariaLabel="Progress" />);
    expect(fill.style.getPropertyValue('--numfield-pct')).toBe('25.00%');
  });
});

