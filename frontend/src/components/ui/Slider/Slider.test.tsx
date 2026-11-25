import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RangeSlider, Slider } from './Slider';

describe('Slider', () => {
  it('updates value via keyboard arrows and syncs paired NumberField', () => {
    const onChange = vi.fn();
    render(<Slider value={50} min={0} max={100} step={5} mode="int" onChange={onChange} ariaLabel="Opacity" />);

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(55);

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith(0);

    const numInput = screen.getByRole('spinbutton', { name: 'Opacity numeric input' }) as HTMLInputElement;
    expect(numInput.value).toBe('50');
  });
});

describe('RangeSlider', () => {
  it('renders frame tick lines across ruler and handles keyboard range adjustments', () => {
    const onChange = vi.fn();
    const { container } = render(
      <RangeSlider value={[1001, 1048]} min={1001} max={1100} step={1} onChange={onChange} ariaLabel="Frame" />,
    );

    const lines = container.querySelectorAll('.org-rangeslider__ruler line');
    expect(lines.length).toBeGreaterThan(20);

    const minSlider = screen.getByRole('slider', { name: 'Frame minimum' });
    fireEvent.keyDown(minSlider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith([1002, 1048]);
  });
});

