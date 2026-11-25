import { describe, expect, it } from 'vitest';
import { hasLayerStripContent } from './LayerStrip';
import type { FileSummaryOut, InspectionDocument } from '../../lib/api/client';

function fakeFile(fmt: string, isSeq = false): FileSummaryOut {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    filename: `test.${fmt}`,
    relative_path: `hero/Lookdev/textures/products/v0001/test.${fmt}`,
    size: 128,
    sha256: 'abc',
    detected_format: fmt,
    media_kind: 'image2d',
    is_sequence: isSeq,
    sequence_kind: isSeq ? 'udim' : 'none',
    sequence_kind_user_override: false,
    is_missing: false,
  };
}

describe('hasLayerStripContent', () => {
  it('detects EXR AOVs, PSD layers, multi-page TIFF, and UDIM tile sets', () => {
    expect(
      hasLayerStripContent(fakeFile('exr'), {
        kind: 'image2d',
        aovs: [{ name: 'RGBA' }, { name: 'depth.Z' }],
      } as InspectionDocument),
    ).toBe(true);

    expect(
      hasLayerStripContent(fakeFile('psd'), {
        kind: 'image2d',
        layers: [{ id: '0', name: 'Background' }],
      } as InspectionDocument),
    ).toBe(true);

    expect(
      hasLayerStripContent(fakeFile('png', true), {
        kind: 'image2d',
        capabilities: { udim: true },
      } as InspectionDocument),
    ).toBe(true);

    expect(
      hasLayerStripContent(fakeFile('png'), {
        kind: 'image2d',
      } as InspectionDocument),
    ).toBe(false);
  });
});

