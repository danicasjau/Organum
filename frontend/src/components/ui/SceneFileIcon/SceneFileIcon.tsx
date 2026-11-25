import { useState } from 'react';
import { cn } from '../_internal/cn';
import './SceneFileIcon.css';

export type SceneFamily =
  | 'houdini'
  | 'maya'
  | 'blender'
  | 'max'
  | 'c4d'
  | 'substance'
  | 'adobe'
  | 'nuke'
  | 'zbrush'
  | 'doc'
  | 'folder'
  | 'unknown';

interface FamilySpec {
  family: SceneFamily;
  badge: string;
}

const EXT_MAP: Record<string, FamilySpec> = {
  '.hip': { family: 'houdini', badge: 'HIP' },
  '.hiplc': { family: 'houdini', badge: 'HIPLC' },
  '.hipnc': { family: 'houdini', badge: 'HIPNC' },
  '.ma': { family: 'maya', badge: 'MA' },
  '.mb': { family: 'maya', badge: 'MB' },
  '.blend': { family: 'blender', badge: 'BLND' },
  '.max': { family: 'max', badge: 'MAX' },
  '.c4d': { family: 'c4d', badge: 'C4D' },
  '.spp': { family: 'substance', badge: 'SPP' },
  '.sbs': { family: 'substance', badge: 'SBS' },
  '.sbsar': { family: 'substance', badge: 'SBSAR' },
  '.psd': { family: 'adobe', badge: 'PSD' },
  '.psb': { family: 'adobe', badge: 'PSB' },
  '.aep': { family: 'adobe', badge: 'AEP' },
  '.nk': { family: 'nuke', badge: 'NK' },
  '.nknc': { family: 'nuke', badge: 'NKNC' },
  '.ztl': { family: 'zbrush', badge: 'ZTL' },
  '.zpr': { family: 'zbrush', badge: 'ZPR' },
  '.txt': { family: 'doc', badge: 'TXT' },
  '.md': { family: 'doc', badge: 'MD' },
  '.pdf': { family: 'doc', badge: 'PDF' },
  '.csv': { family: 'doc', badge: 'CSV' },
  '.json': { family: 'doc', badge: 'JSON' },
  '.yaml': { family: 'doc', badge: 'YAML' },
  '.yml': { family: 'doc', badge: 'YML' },
};

export function resolveSceneFamily(extension: string, isDir = false): FamilySpec {
  if (isDir) return { family: 'folder', badge: 'DIR' };
  const norm = extension.trim().toLowerCase();
  const key = norm ? (norm.startsWith('.') ? norm : `.${norm}`) : '';
  const hit = EXT_MAP[key];
  if (hit) return hit;
  const fallbackBadge = key ? key.slice(1, 5).toUpperCase() : 'FILE';
  return { family: 'unknown', badge: fallbackBadge };
}

export interface SceneFileIconProps {
  extension?: string;
  isDir?: boolean;
  customIconUrl?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function SceneFileIcon({
  extension = '',
  isDir = false,
  customIconUrl,
  className,
  size = 'md',
}: SceneFileIconProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const spec = resolveSceneFamily(extension, isDir);

  if (customIconUrl && !imgFailed && !isDir) {
    return (
      <span
        data-ui="scene-file-icon"
        data-family={spec.family}
        data-size={size}
        className={cn('org-scenefile-icon', className)}
      >
        <img
          src={customIconUrl}
          alt={spec.badge}
          className="org-scenefile-icon__img"
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      data-ui="scene-file-icon"
      data-family={spec.family}
      data-size={size}
      className={cn('org-scenefile-icon', className)}
    >
      <span className="org-scenefile-icon__tab" aria-hidden="true" />
      <span className="org-scenefile-icon__label">{spec.badge}</span>
    </span>
  );
}

