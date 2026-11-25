import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BarChart,
  GaugeBar,
  Heatmap,
  Histogram,
  LineChart,
  NodeGraph,
  ScatterPlot,
  Sparkline,
} from './Charts';

describe('Charts', () => {
  it('renders all retro chart primitives cleanly with ARIA roles', () => {
    render(
      <div>
        <LineChart
          title="Frame Timing"
          series={[{ id: 'ms', label: 'ms', data: [{ x: 1, y: 12 }, { x: 2, y: 15 }] }]}
        />
        <ScatterPlot title="Samples" points={[{ x: 1, y: 2 }, { x: 3, y: 4 }]} />
        <BarChart title="Memory" bars={[{ label: 'F1', value: 512 }, { label: 'F2', value: 640 }]} />
        <Histogram
          title="RGB Histogram"
          channels={[{ id: 'luma', label: 'Y', bins: [1, 4, 8, 2], color: 'var(--series-8)' }]}
        />
        <Heatmap title="Buckets" matrix={[[1, 2], [3, 4]]} />
        <Sparkline values={[1, 3, 2, 5]} />
        <GaugeBar label="VRAM" value={64} max={100} />
        <NodeGraph
          title="Comp DAG"
          nodes={[
            { id: 'read', label: 'Read', x: 12, y: 40 },
            { id: 'grade', label: 'Grade', x: 160, y: 40 },
          ]}
          edges={[{ from: 'read', to: 'grade' }]}
        />
      </div>,
    );

    expect(screen.getByRole('img', { name: 'Frame Timing' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'RGB Histogram' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'VRAM' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Comp DAG' })).toBeInTheDocument();
  });
});

