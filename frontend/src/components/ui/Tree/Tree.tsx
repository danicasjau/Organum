import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import { Icon, type IconName } from '../Icon/Icon';
import './Tree.css';

export interface TreeNode {
  id: string;
  label: string;
  kind?: string;
  icon?: IconName;
  disabled?: boolean;
  tooltip?: string;
  badge?: ReactNode;
  children?: TreeNode[];
  meta?: unknown;
}

export interface TreeProps {
  nodes: ReadonlyArray<TreeNode>;
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  onHoverNode?: (node: TreeNode | null) => void;
  defaultExpandedIds?: ReadonlyArray<string>;
  dropHighlightId?: string | null;
  onNodeDragOver?: (node: TreeNode, e: DragEvent<HTMLDivElement>) => void;
  onNodeDrop?: (node: TreeNode, e: DragEvent<HTMLDivElement>) => void;
  onRootDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onRootDrop?: (e: DragEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
  className?: string;
}

interface FlatNode {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

function TreeRow({
  flat,
  selected,
  dropTarget,
  onSelect,
  onToggle,
  onHover,
  onDragOver,
  onDrop,
}: {
  flat: FlatNode;
  selected: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onHover: (hovering: boolean) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useCssVarRef(rowRef, '--tree-depth', flat.depth);

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={flat.hasChildren ? flat.expanded : undefined}
      aria-disabled={flat.node.disabled}
      title={flat.node.tooltip}
      data-selected={selected ? 'true' : undefined}
      data-disabled={flat.node.disabled ? 'true' : undefined}
      data-drop-target={dropTarget ? 'true' : undefined}
      className="org-tree__row"
      onClick={() => onSelect()}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={flat.expanded ? 'Collapse' : 'Expand'}
        className="org-tree__expander"
        data-hidden={flat.hasChildren ? undefined : 'true'}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {flat.hasChildren && (
          <Icon name={flat.expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
        )}
      </button>
      {flat.node.icon && <Icon name={flat.node.icon} size="sm" className="org-tree__icon" />}
      <span className="org-tree__label">{flat.node.label}</span>
      {flat.node.badge && <span className="org-tree__badge">{flat.node.badge}</span>}
    </div>
  );
}

export function Tree({
  nodes,
  selectedId,
  onSelect,
  onHoverNode,
  defaultExpandedIds,
  dropHighlightId,
  onNodeDragOver,
  onNodeDrop,
  onRootDragOver,
  onRootDrop,
  ariaLabel = 'Tree',
  className,
}: TreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? []),
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const flatRows = useMemo(() => {
    const result: FlatNode[] = [];
    const walk = (list: ReadonlyArray<TreeNode>, depth: number) => {
      for (const node of list) {
        const hasChildren = Boolean(node.children && node.children.length > 0);
        const expanded = expandedSet.has(node.id);
        result.push({ node, depth, hasChildren, expanded });
        if (hasChildren && expanded && node.children) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(nodes, 0);
    return result;
  }, [nodes, expandedSet]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 10,
    initialRect: { width: 300, height: 180 },
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!flatRows.length) return;
    const curIdx = flatRows.findIndex((r) => r.node.id === selectedId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = flatRows[Math.min(flatRows.length - 1, curIdx + 1)];
      if (next) onSelect?.(next.node);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = flatRows[Math.max(0, curIdx - 1)];
      if (prev) onSelect?.(prev.node);
    } else if (e.key === 'ArrowRight' && curIdx >= 0) {
      const cur = flatRows[curIdx];
      if (cur && cur.hasChildren && !cur.expanded) {
        e.preventDefault();
        toggleExpand(cur.node.id);
      }
    } else if (e.key === 'ArrowLeft' && curIdx >= 0) {
      const cur = flatRows[curIdx];
      if (cur && cur.hasChildren && cur.expanded) {
        e.preventDefault();
        toggleExpand(cur.node.id);
      }
    }
  };

  return (
    <div
      ref={scrollRef}
      data-ui="tree"
      role="tree"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn('org-tree', className)}
      onKeyDown={handleKeyDown}
      onDragOver={onRootDragOver}
      onDrop={onRootDrop}
    >
      {virtualizer.getVirtualItems().map((vRow) => {
        const flat = flatRows[vRow.index];
        if (!flat) return null;
        return (
          <TreeRow
            key={flat.node.id}
            flat={flat}
            selected={flat.node.id === selectedId}
            dropTarget={flat.node.id === dropHighlightId}
            onSelect={() => {
              if (flat.hasChildren && !flat.expanded) {
                toggleExpand(flat.node.id);
              }
              onSelect?.(flat.node);
            }}
            onToggle={() => toggleExpand(flat.node.id)}
            onHover={(hovering) => onHoverNode?.(hovering ? flat.node : null)}
            onDragOver={(e) => onNodeDragOver?.(flat.node, e)}
            onDrop={(e) => onNodeDrop?.(flat.node, e)}
          />
        );
      })}
    </div>
  );
}

