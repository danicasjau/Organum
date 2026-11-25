import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../Overlays/Overlays';
import { computeTickStep, formatTimecode, Timebar, TransportControls } from './Timebar';

describe('Timebar & TransportControls', () => {
  it('subdivides frame ticks adaptively and formats timecode', () => {
    expect(computeTickStep(24)).toEqual({ minor: 1, major: 5 });
    expect(computeTickStep(80)).toEqual({ minor: 2, major: 10 });
    expect(computeTickStep(200)).toEqual({ minor: 5, major: 25 });
    expect(formatTimecode(0, 24)).toBe('00:00:00:00');
    expect(formatTimecode(25, 24)).toBe('00:00:01:01');
  });

  it('seeks when clicking annotation markers and fires transport actions', () => {
    const onSeek = vi.fn();
    const onStepBack = vi.fn();
    const onPlayForward = vi.fn();
    const onPlayReverse = vi.fn();
    const onPause = vi.fn();

    render(
      <TooltipProvider>
        <Timebar
          startFrame={0}
          endFrame={40}
          currentFrame={10}
          markers={[{ id: 'm1', frameIn: 14, frameOut: 22, label: 'Note A' }]}
          onSeek={onSeek}
        />
        <TransportControls
          playState="paused"
          currentFrame={10}
          startFrame={0}
          endFrame={40}
          fps={24}
          loopMode="loop"
          speed={1}
          onGoStart={vi.fn()}
          onStepBack={onStepBack}
          onPlayReverse={onPlayReverse}
          onPause={onPause}
          onPlayForward={onPlayForward}
          onStepForward={vi.fn()}
          onGoEnd={vi.fn()}
          onSeek={onSeek}
          onCycleLoop={vi.fn()}
          onChangeSpeed={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to annotation frame 14' }));
    expect(onSeek).toHaveBeenCalledWith(14);

    fireEvent.click(screen.getByRole('button', { name: 'Step back' }));
    expect(onStepBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Play backwards' }));
    expect(onPlayReverse).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Play forward' }));
    expect(onPlayForward).toHaveBeenCalledTimes(1);
  });
});
