import { useRef } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import { Badge } from '../Badge/Badge';
import { Icon } from '../Icon/Icon';
import './LayerList.css';

export interface LayerItem {
  id: string;
  name: string;
  visible: boolean;
  blendMode?: string;
  opacity?: number;
  isGroup?: boolean;
  depth?: number;
  children?: LayerItem[];
}

export interface LayerListProps {
  layers: ReadonlyArray<LayerItem>;
  isolatedId?: string | null;
  hiddenIds?: ReadonlySet<string>;
  onToggleVisibility?: (layerId: string) => void;
  onIsolate?: (layerId: string | null) => void;
  className?: string;
}

function LayerRowItem({
  layer,
  depth,
  visible,
  isolated,
  onToggleVisibility,
  onIsolate,
}: {
  layer: LayerItem;
  depth: number;
  visible: boolean;
  isolated: boolean;
  onToggleVisibility?: (layerId: string) => void;
  onIsolate?: (layerId: string | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useCssVarRef(rowRef, '--layer-depth', depth);

  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={isolated}
      data-isolated={isolated ? 'true' : undefined}
      data-hidden-layer={visible ? undefined : 'true'}
      className="org-layerlist__row"
      onClick={() => onIsolate?.(isolated ? null : layer.id)}
    >
      <button
        type="button"
        aria-label={visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        className="org-layerlist__eye"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility?.(layer.id);
        }}
      >
        <Icon name={visible ? 'eye' : 'eye-off'} size="sm" />
      </button>
      {layer.isGroup && <Icon name="folder" size="sm" />}
      <span className="org-layerlist__name">{layer.name}</span>
      {layer.blendMode && <Badge tone="neutral">{layer.blendMode}</Badge>}
      {layer.opacity !== undefined && (
        <span className="org-layerlist__opacity">{Math.round(layer.opacity * 100)}%</span>
      )}
    </div>
  );
}

export function LayerList({
  layers,
  isolatedId,
  hiddenIds,
  onToggleVisibility,
  onIsolate,
  className,
}: LayerListProps) {
  const flat: Array<{ layer: LayerItem; depth: number }> = [];
  const walk = (list: ReadonlyArray<LayerItem>, depth: number) => {
    for (const l of list) {
      flat.push({ layer: l, depth });
      if (l.children && l.children.length > 0) {
        walk(l.children, depth + 1);
      }
    }
  };
  walk(layers, 0);

  return (
    <div data-ui="layer-list" role="listbox" aria-label="Layers" className={cn('org-layerlist', className)}>
      {flat.map(({ layer, depth }) => {
        const visible = hiddenIds ? !hiddenIds.has(layer.id) : layer.visible;
        const isolated = isolatedId === layer.id;
        return (
          <LayerRowItem
            key={layer.id}
            layer={layer}
            depth={depth}
            visible={visible}
            isolated={isolated}
            onToggleVisibility={onToggleVisibility}
            onIsolate={onIsolate}
          />
        );
      })}
    </div>
  );
}

