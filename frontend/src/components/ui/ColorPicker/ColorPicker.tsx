import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useRef, useState } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import { NumberField } from '../NumberField/NumberField';
import { TextField } from '../TextField/TextField';
import './ColorPicker.css';

export const TOKEN_PALETTE: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Purple', value: '#8B5CF6' },
  { label: 'Green', value: '#10B981' },
  { label: 'Sky', value: '#38BDF8' },
  { label: 'Amber', value: '#F59E0B' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Lavender', value: '#C4B5FD' },
  { label: 'Slate Light', value: '#E2E8F0' },
  { label: 'Slate Dark', value: '#0F172A' },
];

export interface ColorSwatchProps {
  color: string;
  shape?: 'square' | 'circle';
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

export function ColorSwatch({
  color,
  shape = 'square',
  selected = false,
  disabled = false,
  onClick,
  ariaLabel,
  className,
}: ColorSwatchProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useCssVarRef(ref, '--swatch-color', color);

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? `Color ${color}`}
      data-ui="color-swatch"
      data-shape={shape}
      data-selected={selected ? 'true' : undefined}
      className={cn('org-swatch', className)}
      onClick={onClick}
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = Number.parseInt(m.length === 6 ? m : '8B5CF6', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  ariaLabel?: string;
}

export function ColorPicker({
  value,
  onChange,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
  ariaLabel = 'Pick color',
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const swatchRef = useRef<HTMLSpanElement>(null);
  useCssVarRef(swatchRef, '--swatch-color', value);

  const [r, g, b] = hexToRgb(value);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) setHexDraft(value);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          data-ui="color-picker"
          data-error={error ? 'true' : undefined}
          data-dirty={dirty ? 'true' : undefined}
          data-force-state={forceState}
          className="org-colorpicker__trigger"
        >
          <span ref={swatchRef} className="org-colorpicker__chip" aria-hidden="true" />
          <span className="org-colorpicker__hex">{value.toUpperCase()}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={2} className="org-colorpicker__popup">
          <div className="org-colorpicker__palette" role="group" aria-label="Token color palette">
            {TOKEN_PALETTE.map((item) => (
              <ColorSwatch
                key={item.value}
                color={item.value}
                shape="circle"
                selected={value.toUpperCase() === item.value.toUpperCase()}
                ariaLabel={item.label}
                onClick={() => {
                  onChange(item.value);
                  setHexDraft(item.value);
                }}
              />
            ))}
          </div>
          <div className="org-colorpicker__channels">
            <NumberField
              label="R"
              mode="int"
              min={0}
              max={255}
              value={r}
              onChange={(nr) => {
                const next = rgbToHex(nr, g, b);
                onChange(next);
                setHexDraft(next);
              }}
            />
            <NumberField
              label="G"
              mode="int"
              min={0}
              max={255}
              value={g}
              onChange={(ng) => {
                const next = rgbToHex(r, ng, b);
                onChange(next);
                setHexDraft(next);
              }}
            />
            <NumberField
              label="B"
              mode="int"
              min={0}
              max={255}
              value={b}
              onChange={(nb) => {
                const next = rgbToHex(r, g, nb);
                onChange(next);
                setHexDraft(next);
              }}
            />
          </div>
          <TextField
            aria-label="Hex color"
            value={hexDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setHexDraft(raw);
              if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
                onChange(raw.toUpperCase());
              }
            }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

