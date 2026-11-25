import { Group, Panel, Separator, useGroupRef, type GroupProps, type PanelProps, type SeparatorProps } from 'react-resizable-panels';
import { cn } from '../_internal/cn';
import './Splitter.css';

export { useGroupRef };

export function SplitGroup({ className, ...rest }: GroupProps) {
  return <Group data-ui="split-group" className={cn('org-split-group', className)} {...rest} />;
}

export function SplitPane({ className, ...rest }: PanelProps) {
  return <Panel data-ui="split-pane" className={cn('org-split-pane', className)} {...rest} />;
}

export function SplitHandle({ className, ...rest }: SeparatorProps) {
  return (
    <Separator data-ui="split-handle" className={cn('org-split-handle', className)} {...rest}>
      <div className="org-split-handle__line" />
    </Separator>
  );
}

