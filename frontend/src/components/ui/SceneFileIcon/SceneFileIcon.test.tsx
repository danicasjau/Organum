import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneFileIcon, resolveSceneFamily } from './SceneFileIcon';

describe('SceneFileIcon', () => {
  it('maps major DCC extensions to muted family badges', () => {
    expect(resolveSceneFamily('.hip')).toEqual({ family: 'houdini', badge: 'HIP' });
    expect(resolveSceneFamily('.ma')).toEqual({ family: 'maya', badge: 'MA' });
    expect(resolveSceneFamily('.blend')).toEqual({ family: 'blender', badge: 'BLND' });
    expect(resolveSceneFamily('.nk')).toEqual({ family: 'nuke', badge: 'NK' });
    expect(resolveSceneFamily('.spp')).toEqual({ family: 'substance', badge: 'SPP' });
    expect(resolveSceneFamily('', true)).toEqual({ family: 'folder', badge: 'DIR' });

    const { container } = render(<SceneFileIcon extension=".hipnc" />);
    expect(screen.getByText('HIPNC')).toBeInTheDocument();
    expect(container.querySelector('[data-family="houdini"]')).not.toBeNull();
  });
});

