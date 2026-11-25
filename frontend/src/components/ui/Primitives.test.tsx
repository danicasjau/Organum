import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button/Button';
import { Checkbox } from './Checkbox/Checkbox';
import { PropertyRow } from './PropertyEditor/PropertyEditor';
import { RadioGroup, RadioItem } from './Radio/Radio';
import { Switch } from './Switch/Switch';
import { SearchField } from './TextField/TextField';

describe('UI Primitives', () => {
  it('handles Button click, disabled, and toggle pressed ARIA', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="toggle" pressed={false} onClick={onClick}>
        Grid
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Grid' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button variant="toggle" pressed disabled onClick={onClick}>
        Grid
      </Button>,
    );
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles Checkbox, RadioGroup, and Switch', () => {
    const onCheck = vi.fn();
    const onRadio = vi.fn();
    const onSwitch = vi.fn();
    render(
      <div>
        <Checkbox checked={false} onChange={onCheck} label="Lock" />
        <RadioGroup value="a" onChange={onRadio} ariaLabel="Mode">
          <RadioItem value="a" label="Mode A" />
          <RadioItem value="b" label="Mode B" />
        </RadioGroup>
        <Switch checked={false} onChange={onSwitch} label="Bypass" />
      </div>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lock' }));
    expect(onCheck).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Mode B' }));
    expect(onRadio).toHaveBeenCalledWith('b');

    const sw = screen.getByRole('switch', { name: 'Bypass' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onSwitch).toHaveBeenCalledWith(true);
  });

  it('debounces SearchField and clears value', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const onChange = vi.fn();
    render(<SearchField value="exr" onChange={onChange} onSearch={onSearch} debounceMs={150} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearch).toHaveBeenCalledWith('exr');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
    vi.useRealTimers();
  });

  it('renders PropertyRow dirty indicator and reset button', () => {
    const onReset = vi.fn();
    render(
      <PropertyRow label="Exposure" dirty onReset={onReset}>
        <span>field</span>
      </PropertyRow>,
    );
    const reset = screen.getByRole('button', { name: 'Reset Exposure' });
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

