import { useState } from 'react';
import { Button } from '../Button/Button';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import { Icon } from '../Icon/Icon';
import { NumberField } from '../NumberField/NumberField';
import './VectorField.css';

const AXIS_LABELS = ['X', 'Y', 'Z', 'W'] as const;
const AXIS_TONES = ['x', 'y', 'z', 'w'] as const;

export interface VectorFieldProps {
  values: number[];
  onChange: (values: number[]) => void;
  baselineValues?: number[];
  labels?: ReadonlyArray<string>;
  step?: number;
  precision?: number;
  lockable?: boolean;
  disabled?: boolean;
}

export function VectorField({
  values,
  onChange,
  baselineValues,
  labels = AXIS_LABELS,
  step = 0.1,
  precision = 2,
  lockable = true,
  disabled = false,
}: VectorFieldProps) {
  const [locked, setLocked] = useState(false);

  const handleChange = (idx: number, nextVal: number) => {
    if (locked) {
      const delta = nextVal - (values[idx] ?? 0);
      onChange(values.map((v) => v + delta));
    } else {
      onChange(values.map((v, i) => (i === idx ? nextVal : v)));
    }
  };

  return (
    <div data-ui="vector-field" className="org-vecfield">
      {values.map((val, idx) => (
        <div key={idx} className="org-vecfield__item">
          <NumberField
            label={labels[idx] ?? AXIS_LABELS[idx] ?? String(idx)}
            axisTone={AXIS_TONES[idx]}
            value={val}
            baselineValue={baselineValues?.[idx]}
            step={step}
            precision={precision}
            disabled={disabled}
            onChange={(nv) => handleChange(idx, nv)}
          />
        </div>
      ))}
      {lockable && (
        <Button
          variant="icon"
          size="sm"
          pressed={locked}
          disabled={disabled}
          title={locked ? 'Unlock axes' : 'Lock uniform axes'}
          aria-label={locked ? 'Unlock axes' : 'Lock uniform axes'}
          onClick={() => setLocked((l) => !l)}
        >
          <Icon name={locked ? 'lock' : 'unlock'} size="sm" />
        </Button>
      )}
    </div>
  );
}

export interface ColorFieldProps {
  rgba: [number, number, number, number];
  onChange: (rgba: [number, number, number, number]) => void;
  showAlpha?: boolean;
  showChannels?: boolean;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
}

function rgbaToHex([r, g, b]: [number, number, number, number]): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (
    '#' +
    [toByte(r), toByte(g), toByte(b)]
      .map((n) => n.toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

function hexToRgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function ColorField({
  rgba,
  onChange,
  showAlpha = true,
  showChannels = true,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
}: ColorFieldProps) {
  const hex = rgbaToHex(rgba);
  return (
    <div data-ui="color-field" className="org-colorfield">
      <ColorPicker
        value={hex}
        disabled={disabled}
        error={error}
        dirty={dirty}
        forceState={forceState}
        onChange={(nextHex) => {
          const [r, g, b] = hexToRgb01(nextHex);
          onChange([r, g, b, rgba[3]]);
        }}
      />
      {showChannels && (
        <div className="org-colorfield__nums">
        <NumberField
          label="R"
          axisTone="x"
          min={0}
          max={1}
          step={0.01}
          precision={2}
          value={rgba[0]}
          disabled={disabled}
          onChange={(r) => onChange([r, rgba[1], rgba[2], rgba[3]])}
        />
        <NumberField
          label="G"
          axisTone="y"
          min={0}
          max={1}
          step={0.01}
          precision={2}
          value={rgba[1]}
          disabled={disabled}
          onChange={(g) => onChange([rgba[0], g, rgba[2], rgba[3]])}
        />
        <NumberField
          label="B"
          axisTone="z"
          min={0}
          max={1}
          step={0.01}
          precision={2}
          value={rgba[2]}
          disabled={disabled}
          onChange={(b) => onChange([rgba[0], rgba[1], b, rgba[3]])}
        />
        {showAlpha && (
          <NumberField
            label="A"
            min={0}
            max={1}
            step={0.01}
            precision={2}
            value={rgba[3]}
            disabled={disabled}
            onChange={(a) => onChange([rgba[0], rgba[1], rgba[2], a])}
          />
        )}
        </div>
      )}
    </div>
  );
}

