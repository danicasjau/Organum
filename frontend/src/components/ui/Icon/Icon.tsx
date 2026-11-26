import { cn } from '../_internal/cn';
import './Icon.css';

/**
 * v1 icon set: one registry on a 24x24 grid, stroke 1.75, fill none,
 * square caps and miter joins (miterlimit 2) for a machined look.
 * Rendered at 16px inline (md) and 18px in tiles (lg). Colour is currentColor.
 */
export type IconName =
  | 'search'
  | 'grip'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-left'
  | 'check'
  | 'minus'
  | 'plus'
  | 'eye'
  | 'eye-off'
  | 'reset'
  | 'alert'
  | 'info'
  | 'check-circle'
  | 'sun'
  | 'moon'
  | 'grid'
  | 'sliders'
  | 'lock'
  | 'unlock'
  | 'copy'
  | 'folder'
  | 'file'
  | 'image'
  | 'video'
  | 'box3d'
  | 'audio'
  | 'doc'
  | 'table'
  | 'play'
  | 'pause'
  | 'step-back'
  | 'step-forward'
  | 'skip-start'
  | 'skip-end'
  | 'play-reverse'
  | 'loop'
  | 'volume'
  | 'mute'
  | 'ruler'
  | 'crosshair'
  | 'pencil'
  | 'lasso'
  | 'eraser'
  | 'laser'
  | 'rect'
  | 'circle'
  | 'note'
  | 'settings'
  | 'star'
  | 'star-filled'
  | 'folder-plus'
  | 'trash'
  | 'refresh'
  | 'external-link'
  | 'arrow-up'
  | 'layers'
  | 'maximize'
  | 'calendar'
  | 'message'
  | 'x-circle'
  | 'send'
  | 'comment'
  | 'redo'
  | 'paperclip'
  | 'user'
  | 'users'
  | 'bell'
  | 'flag'
  | 'clock'
  | 'edit'
  | 'log-out'
  | 'film'
  | 'mail';

export const ICON_NAMES: ReadonlyArray<IconName> = [
  'search',
  'grip',
  'close',
  'chevron-down',
  'chevron-right',
  'chevron-up',
  'chevron-left',
  'check',
  'minus',
  'plus',
  'eye',
  'eye-off',
  'reset',
  'alert',
  'info',
  'check-circle',
  'sun',
  'moon',
  'grid',
  'sliders',
  'lock',
  'unlock',
  'copy',
  'folder',
  'file',
  'image',
  'video',
  'box3d',
  'audio',
  'doc',
  'table',
  'play',
  'pause',
  'step-back',
  'step-forward',
  'skip-start',
  'skip-end',
  'play-reverse',
  'loop',
  'volume',
  'mute',
  'ruler',
  'crosshair',
  'pencil',
  'lasso',
  'eraser',
  'laser',
  'rect',
  'circle',
  'note',
  'settings',
  'star',
  'star-filled',
  'folder-plus',
  'trash',
  'refresh',
  'external-link',
  'arrow-up',
  'layers',
  'maximize',
  'calendar',
  'message',
  'x-circle',
  'send',
  'comment',
  'redo',
  'paperclip',
  'user',
  'users',
  'bell',
  'flag',
  'clock',
  'edit',
  'log-out',
  'film',
  'mail',
];

export interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

interface IconPart {
  d: string;
  fill?: boolean;
}

const ICONS: Record<IconName, ReadonlyArray<IconPart>> = {
  search: [{ d: 'M16.5 10.5a6 6 0 1 1-12 0a6 6 0 1 1 12 0Z' }, { d: 'M15 15l5 5' }],
  grip: [{ d: 'M8.5 5.5h2v2h-2ZM13.5 5.5h2v2h-2ZM8.5 11h2v2h-2ZM13.5 11h2v2h-2ZM8.5 16.5h2v2h-2ZM13.5 16.5h2v2h-2Z', fill: true }],
  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
  'chevron-down': [{ d: 'M6 9l6 6 6-6' }],
  'chevron-right': [{ d: 'M9 6l6 6-6 6' }],
  'chevron-up': [{ d: 'M6 15l6-6 6 6' }],
  'chevron-left': [{ d: 'M15 6l-6 6 6 6' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  minus: [{ d: 'M5 12h14' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  eye: [{ d: 'M2.5 12C5 7.5 8.3 5.5 12 5.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S5 16.5 2.5 12Z' }, { d: 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z' }],
  'eye-off': [{ d: 'M2.5 12C5 7.5 8.3 5.5 12 5.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S5 16.5 2.5 12Z' }, { d: 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z' }, { d: 'M4 4l16 16' }],
  reset: [{ d: 'M4 4.5v5h5' }, { d: 'M5.2 14.5a7.5 7.5 0 1 0 .8-6.5L4 9.5' }],
  alert: [{ d: 'M12 3.5L21.5 20h-19Z' }, { d: 'M12 9.5v5' }, { d: 'M12 16.5v1.75' }],
  info: [{ d: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z' }, { d: 'M12 10.5v6.5' }, { d: 'M12 7v1.75' }],
  'check-circle': [{ d: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z' }, { d: 'M8 12.3l2.8 2.8L16.2 9.5' }],
  sun: [{ d: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z' }, { d: 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8' }],
  moon: [{ d: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z' }],
  grid: [{ d: 'M4 4h16v16H4ZM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16' }],
  sliders: [{ d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }, { d: 'M13 4h4v4h-4ZM7 10h4v4H7ZM15 16h4v4h-4Z' }],
  lock: [{ d: 'M5 11h14v10H5Z' }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  unlock: [{ d: 'M5 11h14v10H5Z' }, { d: 'M8 11V8a4 4 0 0 1 7.7-1.5' }],
  copy: [{ d: 'M8 8h12v12H8Z' }, { d: 'M16 8V4H4v12h4' }],
  folder: [{ d: 'M3 5h6.5l2 2.5H21V19H3Z' }],
  file: [{ d: 'M6 3h8l4 4v14H6Z' }, { d: 'M14 3v4h4' }],
  image: [{ d: 'M3.5 5h17v14h-17Z' }, { d: 'M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5' }, { d: 'M17 9a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 1 1 2.5 0Z' }],
  video: [{ d: 'M3 6.5h12v11H3Z' }, { d: 'M15 10.5l6-3.5v10l-6-3.5' }],
  box3d: [{ d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9Z' }, { d: 'M4 7.5l8 4.5 8-4.5' }, { d: 'M12 12v9' }],
  audio: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z' }, { d: 'M15.5 9a4 4 0 0 1 0 6' }, { d: 'M18 6.5a7.5 7.5 0 0 1 0 11' }],
  doc: [{ d: 'M6 3h8l4 4v14H6Z' }, { d: 'M14 3v4h4' }, { d: 'M9 11.5h6M9 15h6M9 18.5h4' }],
  table: [{ d: 'M3.5 5h17v14h-17ZM3.5 10h17M3.5 14.5h17M9.5 10v9' }],
  play: [{ d: 'M7 4.5v15L19 12Z' }],
  pause: [{ d: 'M7 5h3.5v14H7ZM13.5 5H17v14h-3.5Z' }],
  'step-back': [{ d: 'M17 5.5v13L8.5 12Z' }, { d: 'M6.5 5v14' }],
  'step-forward': [{ d: 'M7 5.5v13l8.5-6.5Z' }, { d: 'M17.5 5v14' }],
  'skip-start': [{ d: 'M5.5 5v14' }, { d: 'M13 5.5v13L6.5 12Z' }, { d: 'M20 5.5v13L13.5 12Z' }],
  'skip-end': [{ d: 'M18.5 5v14' }, { d: 'M11 5.5v13l6.5-6.5Z' }, { d: 'M4 5.5v13l6.5-6.5Z' }],
  'play-reverse': [{ d: 'M17 4.5v15L5 12Z' }],
  loop: [{ d: 'M4 11V7.5h14' }, { d: 'M15 4.5l3 3-3 3' }, { d: 'M20 13v3.5H6' }, { d: 'M9 13.5l-3 3 3 3' }],
  volume: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z' }, { d: 'M15.5 9a4 4 0 0 1 0 6' }, { d: 'M18 6.5a7.5 7.5 0 0 1 0 11' }],
  mute: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z' }, { d: 'M15.5 9.5l5 5M20.5 9.5l-5 5' }],
  ruler: [{ d: 'M2.5 8h19v8h-19Z' }, { d: 'M6.5 8v3M10.5 8v4.5M14.5 8v3M18.5 8v4.5' }],
  crosshair: [{ d: 'M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0Z' }, { d: 'M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5' }],
  pencil: [{ d: 'M15.5 4.5l4 4L8.5 19.5 4 20l.5-4.5Z' }, { d: 'M13.5 6.5l4 4' }],
  lasso: [{ d: 'M12 4.5c5 0 8.5 2.3 8.5 5.2s-3.5 5.3-8.5 5.3-8.5-2.3-8.5-5.3S7 4.5 12 4.5Z' }, { d: 'M6 13.5c-1.5 2-.5 4 1.5 4s2.5 2 1 3.5' }],
  eraser: [{ d: 'M14 4.5l6 6-9 9H6.5l-3-3Z' }, { d: 'M9 9.5l6 6' }, { d: 'M11 19.5h9' }],
  laser: [{ d: 'M4 20L15 9' }, { d: 'M17.5 2.5v3M21.5 6.5h-3M20 4l-2 2' }],
  rect: [{ d: 'M4 6h16v12H4Z' }],
  circle: [{ d: 'M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0Z' }],
  note: [{ d: 'M5 4h14v10l-6 6H5Z' }, { d: 'M13 20v-6h6' }],
  settings: [{ d: 'M10.5 3h3l.6 2.4 1.8.8 2.2-1.3 2.1 2.1-1.3 2.2.8 1.8 2.3.5v3l-2.3.6-.8 1.8 1.3 2.2-2.1 2.1-2.2-1.3-1.8.8-.6 2.3h-3l-.6-2.3-1.8-.8-2.2 1.3-2.1-2.1 1.3-2.2-.8-1.8L3 13.5v-3l2.3-.6.8-1.8-1.3-2.2 2.1-2.1 2.2 1.3 1.8-.8Z' }, { d: 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z' }],
  star: [{ d: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z' }],
  'star-filled': [{ d: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z', fill: true }, { d: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z' }],
  'folder-plus': [{ d: 'M3 5h6.5l2 2.5H21V19H3Z' }, { d: 'M12 10.5v6M9 13.5h6' }],
  trash: [{ d: 'M4 6.5h16' }, { d: 'M9 6.5V4h6v2.5' }, { d: 'M6 6.5l1 14h10l1-14' }, { d: 'M10 10.5v6M14 10.5v6' }],
  refresh: [{ d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }, { d: 'M20 4v5h-5' }],
  'external-link': [{ d: 'M13 4h7v7' }, { d: 'M20 4l-9 9' }, { d: 'M18 14v6H4V6h6' }],
  'arrow-up': [{ d: 'M12 20V4.5' }, { d: 'M5.5 11L12 4.5 18.5 11' }],
  layers: [{ d: 'M12 3.5l9 4.5-9 4.5L3 8Z' }, { d: 'M3 12l9 4.5 9-4.5' }, { d: 'M3 16l9 4.5 9-4.5' }],
  maximize: [{ d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }],
  calendar: [{ d: 'M3.5 5.5h17v15h-17Z' }, { d: 'M3.5 10h17' }, { d: 'M8 3v5M16 3v5' }],
  message: [{ d: 'M3.5 4.5h17v12H10l-4.5 4v-4h-2Z' }, { d: 'M8 9h8M8 12.5h5' }],
  'x-circle': [{ d: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z' }, { d: 'M9 9l6 6M15 9l-6 6' }],
  send: [{ d: 'M3 11.5L21 3l-6.5 18-3-7.5Z' }, { d: 'M11.5 13.5L21 3' }],
  comment: [{ d: 'M3.5 4.5h17v12H10l-4.5 4v-4h-2Z' }, { d: 'M8 9h8M8 12.5h5' }],
  redo: [{ d: 'M15 5l5 4.5-5 4.5' }, { d: 'M20 9.5H9.5a5.5 5.5 0 0 0 0 11H13' }],
  paperclip: [{ d: 'M19 11.5l-7.3 7.3a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7-7' }],
  user: [{ d: 'M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z' }, { d: 'M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5' }],
  users: [{ d: 'M13 8.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0Z' }, { d: 'M2.5 20c0-3.6 3-5.5 7-5.5s7 1.9 7 5.5' }, { d: 'M15 5.2a3.5 3.5 0 0 1 0 6.6' }, { d: 'M18 14.8c2.2.6 3.5 2.4 3.5 5.2' }],
  bell: [{ d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z' }, { d: 'M10 21h4' }],
  flag: [{ d: 'M5 21V3.5' }, { d: 'M5 4.5h12.5L15 9l2.5 4.5H5' }],
  clock: [{ d: 'M20.5 12a8.5 8.5 0 1 1-17 0a8.5 8.5 0 1 1 17 0Z' }, { d: 'M12 7v5.5l3.5 2' }],
  edit: [{ d: 'M15.5 4.5l4 4L8.5 19.5 4 20l.5-4.5Z' }, { d: 'M13.5 6.5l4 4' }, { d: 'M13 20h7' }],
  'log-out': [{ d: 'M10 4H4v16h6' }, { d: 'M15 7.5l4.5 4.5-4.5 4.5' }, { d: 'M19.5 12H9' }],
  film: [{ d: 'M3.5 4h17v16h-17Z' }, { d: 'M7.5 4v16M16.5 4v16' }, { d: 'M3.5 8h4M3.5 12h4M3.5 16h4M16.5 8h4M16.5 12h4M16.5 16h4' }],
  mail: [{ d: 'M3 5.5h18v13H3Z' }, { d: 'M3 6l9 7 9-7' }],
};

export function Icon({ name, size = 'md', className, label }: IconProps) {
  const parts = ICONS[name] ?? [];
  return (
    <svg
      data-ui="icon"
      data-icon={name}
      className={cn('org-icon', `org-icon--${size}`, className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={2}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {parts.map((p, i) =>
        p.fill ? (
          <path key={i} d={p.d} fill="currentColor" stroke="none" />
        ) : (
          <path key={i} d={p.d} />
        ),
      )}
    </svg>
  );
}
