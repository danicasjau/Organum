import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './Layout.css';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: '0' | '1' | '2' | '3' | '4' | '5' | '6';
  padding?: '0' | '1' | '2' | '3' | '4' | '5' | '6';
  align?: 'stretch' | 'start' | 'center' | 'end';
  fill?: boolean;
}

export function Stack({
  gap = '2',
  padding = '0',
  align = 'stretch',
  fill,
  className,
  children,
  ...rest
}: StackProps) {
  return (
    <div
      data-ui="stack"
      data-gap={gap}
      data-pad={padding}
      data-align={align}
      data-fill={fill ? 'true' : undefined}
      className={cn('org-stack', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: '0' | '1' | '2' | '3' | '4' | '5';
  align?: 'center' | 'start' | 'end' | 'stretch';
  justify?: 'start' | 'between' | 'end';
  wrap?: boolean;
}

export function Inline({
  gap = '2',
  align = 'center',
  justify = 'start',
  wrap = false,
  className,
  children,
  ...rest
}: InlineProps) {
  return (
    <div
      data-ui="inline"
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap ? 'true' : undefined}
      className={cn('org-inline', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4 | 6 | 8;
  gap?: '1' | '2' | '3' | '4';
}

export function Grid({ columns = 2, gap = '3', className, children, ...rest }: GridProps) {
  return (
    <div
      data-ui="grid"
      data-cols={columns}
      data-gap={gap}
      className={cn('org-grid', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Spacer() {
  return <div className="org-spacer" />;
}

export function ScrollArea({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-ui="scroll-area" className={cn('org-scroll-area', className)}>
      {children}
    </div>
  );
}

export function TokenTile({
  name,
  tokenVar,
  role,
}: {
  name: string;
  tokenVar: string;
  role: string;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  useCssVarRef(chipRef, '--tile-bg', `var(${tokenVar})`);
  return (
    <div data-ui="token-tile" className="org-token-tile">
      <div ref={chipRef} className="org-token-tile__chip" />
      <div className="org-token-tile__meta">
        <span className="org-token-tile__name">{name}</span>
        <span className="org-token-tile__var">{tokenVar}</span>
        <span className="org-token-tile__role">{role}</span>
      </div>
    </div>
  );
}

