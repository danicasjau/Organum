import { describe, expect, it } from 'vitest';
import { useViewerStore } from './viewerStore';

describe('viewerStore LRU state', () => {
  it('preserves per-file zoom, exposure, and colorspace across switches', () => {
    const store = useViewerStore.getState();
    store.selectFile('file-a', 'srgb');
    store.updateFileState('file-a', { zoom: 4.0, exposure: 1.5, channel: 'R' });

    store.selectFile('file-b', 'acescg');
    expect(useViewerStore.getState().byFile['file-b']?.colorspace).toBe('acescg');
    expect(useViewerStore.getState().byFile['file-b']?.zoom).toBe(-1);

    store.selectFile('file-a');
    expect(useViewerStore.getState().byFile['file-a']?.zoom).toBe(4.0);
    expect(useViewerStore.getState().byFile['file-a']?.exposure).toBe(1.5);
    expect(useViewerStore.getState().byFile['file-a']?.channel).toBe('R');
  });
});

