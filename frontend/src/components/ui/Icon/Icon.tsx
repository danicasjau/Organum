import { cn } from '../_internal/cn';
import './Icon.css';

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
  | 'message';

export interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const PATHS: Record<IconName, string> = {
  search:
    'M6.5 2a4.5 4.5 0 1 0 2.84 7.99l3.33 3.34.71-.71-3.34-3.33A4.5 4.5 0 0 0 6.5 2Zm0 1a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
  close:
    'M3.35 2.65 8 7.29l4.65-4.64.7.7L8.71 8l4.64 4.65-.7.7L8 8.71l-4.65 4.64-.7-.7L7.29 8 2.65 3.35l.7-.7Z',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6l-.7-.7L8 9.09 4.2 5.3l-.7.7Z',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5l-.7-.7L9.09 8 5.3 4.2l.7-.7Z',
  'chevron-up': 'M3.5 10 8 5.5 12.5 10l-.7.7L8 6.91 4.2 10.7l-.7-.7Z',
  'chevron-left': 'M10 3.5 5.5 8 10 12.5l.7-.7L6.91 8l3.79-3.8-.7-.7Z',
  check: 'M3 8.2 6.4 11.5 13 4.8l-.7-.7L6.4 10.1 3.7 7.5l-.7.7Z',
  minus: 'M3 7.5h10v1H3v-1Z',
  plus: 'M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z',
  eye: 'M8 3.5c-3.3 0-6 2.5-6.9 4.5.9 2 3.6 4.5 6.9 4.5s6-2.5 6.9-4.5c-.9-2-3.6-4.5-6.9-4.5Zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5A1.5 1.5 0 1 0 8 9.5 1.5 1.5 0 0 0 8 6.5Z',
  'eye-off':
    'M2.7 2 14 13.3l-.7.7-2.2-2.2A7.8 7.8 0 0 1 8 12.5c-3.3 0-6-2.5-6.9-4.5.5-1.1 1.6-2.4 3-3.4L2 2.7l.7-.7Zm3.5 4.2A2 2 0 0 0 9.8 9.8L6.2 6.2ZM8 3.5c3.3 0 6 2.5 6.9 4.5-.4.9-1.1 1.8-2 2.6l-.7-.7c.7-.6 1.2-1.2 1.6-1.9-.8-1.6-3-3.5-5.8-3.5-.6 0-1.1.1-1.6.2l-.8-.8C6.4 3.6 7.2 3.5 8 3.5Z',
  reset: 'M4 5.5A4.5 4.5 0 1 1 3.6 9H2.5a5.5 5.5 0 1 0 .6-4.3V2.5H2v4h4v-1H4Z',
  alert: 'M8 2 1.5 13.5h13L8 2Zm-.5 4h1v4h-1V6Zm0 5h1v1.2h-1V11Z',
  info: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.5 3h1v1h-1v-1Zm0 2.5h1v4.5h-1V7Z',
  'check-circle':
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-1.2 9.2L4.2 8.1l.7-.7 1.9 1.9 4.3-4.3.7.7-5 5Z',
  sun: 'M8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-.5-3h1v2h-1v-2Zm0 11h1v2h-1v-2Zm6-5h2v1h-2v-1Zm-11 0h2v1h-2v-1Zm9-3.7 1.4-1.4.7.7-1.4 1.4-.7-.7Zm-8.4 8.4 1.4-1.4.7.7-1.4 1.4-.7-.7Zm8.4 0 .7-.7 1.4 1.4-.7.7-1.4-1.4Zm-8.4-8.4.7-.7 1.4 1.4-.7.7-1.4-1.4Z',
  moon: 'M9.8 2.2a5.8 5.8 0 1 0 4 9.9 5.5 5.5 0 0 1-4-9.9Z',
  grid: 'M2 2h12v12H2V2Zm1 1v3h3V3H3Zm4 0v3h2V3H7Zm3 0v3h3V3h-3ZM3 7v2h3V7H3Zm4 0v2h2V7H7Zm3 0v2h3V7h-3ZM3 10v3h3v-3H3Zm4 0v3h2v-3H7Zm3 0v3h3v-3h-3Z',
  sliders:
    'M2 4h5v1H2V4Zm7 0h5v1H9V4ZM7 3h2v3H7V3Zm-5 4.5h3v1H2v-1Zm5 0h7v1H7v-1ZM5 6.5h2v3H5v-3ZM2 11h7v1H2v-1Zm9 0h3v1h-3v-1Zm-2-1h2v3H9v-3Z',
  lock: 'M5 7V5a3 3 0 0 1 6 0v2h1.5v7h-9V7H5Zm1 0h4V5a2 2 0 1 0-4 0v2Z',
  unlock: 'M5 7V5a3 3 0 0 1 5.8-1h-1a2 2 0 0 0-3.8.8V7h6.5v7h-9V7H5Z',
  copy: 'M5 2h8v10h-2v2H3V4h2V2Zm1 1v1h5v7h1V3H6ZM4 5v8h6V5H4Z',
  folder: 'M2 3h4.5l1.2 1.5H14v8.5H2V3Z',
  file: 'M4 2h5.5L13 5.5V14H4V2Zm5 1v3h3l-3-3Z',
  image:
    'M2 3h12v10H2V3Zm1 1v6.2l2.8-2.8 2.4 2.4 2-2 2.8 2.8V4H3Zm2.5 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  video: 'M2 4h9v8H2V4Zm10 2.2 2.5-1.5v6.6L12 9.8V6.2Z',
  box3d:
    'M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Zm0 1.1L3.7 5.4 8 7.9l4.3-2.5L8 2.9Zm-4.5 3.4v4.1l4 2.3V8.6l-4-2.3Zm9 0-4 2.3v4.1l4-2.3V6.3Z',
  audio: 'M3 6v4h2.5L9 13V3L5.5 6H3Zm8.5-1a4 4 0 0 1 0 6l-.7-.7a3 3 0 0 0 0-4.6l.7-.7Z',
  doc: 'M3.5 2h6L13 5.5V14H3.5V2ZM5 7h6v1H5V7Zm0 2.5h6v1H5v-1Zm0 2.5h4v1H5v-1Z',
  table: 'M2 3h12v10H2V3Zm1 3v2h4V6H3Zm5 0v2h5V6H8ZM3 9v3h4V9H3Zm5 0v3h5V9H8Z',
  play: 'M4 3v10l9-5-9-5Z',
  pause: 'M4 3h3v10H4V3Zm5 0h3v10H9V3Z',
  'step-back': 'M4 3h1v10H4V3Zm8 0v10L6 8l6-5Z',
  'step-forward': 'M11 3h1v10h-1V3ZM4 3l6 5-6 5V3Z',
  'skip-start': 'M3 3h1.5v10H3V3Zm9.5 0v10L6 8l6.5-5Z',
  'skip-end': 'M11.5 3H13v10h-1.5V3ZM3.5 3 10 8l-6.5 5V3Z',
  'play-reverse': 'M12 3v10L3 8l9-5Z',
  loop: 'M3.5 5h8V3l3 2.5-3 2.5V6h-7v3H3.5V5Zm9 6h-8v2L1.5 10.5 4.5 8v2h7V7h1v4Z',
  volume:
    'M2.5 6v4h2.5l3.5 3V3L5 6H2.5Zm8.5-1a4 4 0 0 1 0 6l-.7-.7a3 3 0 0 0 0-4.6l.7-.7Zm1.8-1.8a6.5 6.5 0 0 1 0 9.6l-.7-.7a5.5 5.5 0 0 0 0-8.2l.7-.7Z',
  mute: 'M2.5 6v4h2.5l3.5 3V3L5 6H2.5Zm8-.5.7-.7L13 6.6l1.8-1.8.7.7L13.7 7.3l1.8 1.8-.7.7L13 8l-1.8 1.8-.7-.7 1.8-1.8-1.8-1.8Z',
  ruler: 'M2 5h12v6H2V5Zm1 1v4h10V6h-2v2h-1V6H8v2H7V6H5v2H4V6H3Z',
  crosshair:
    'M7.5 1.5h1V4h-1V1.5Zm0 10.5h1v2.5h-1V12ZM1.5 7.5H4v1H1.5v-1Zm10.5 0h2.5v1H12v-1ZM8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  pencil: 'M11.6 2.4 13.6 4.4 5.4 12.6 2.5 13.5 3.4 10.6 11.6 2.4Z',
  lasso:
    'M8 3c3.3 0 6 1.8 6 4s-2.7 4-6 4c-1 0-2-.2-2.8-.5L4 13.5l-.8-.5 1-2.8C2.9 9.5 2 8.3 2 7c0-2.2 2.7-4 6-4Z',
  eraser: 'M7.5 3 13 8.5 8.5 13H4l-2-2L7.5 3Z',
  laser: 'M2.5 12.5 10.5 4.5l1 1-8 8-1-1ZM11 2h1v2h-1V2Zm2.5 2.5h2v1h-2v-1Z',
  rect: 'M2.5 3.5h11v9h-11v-9Zm1 1v7h9v-7h-9Z',
  circle: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z',
  note: 'M3 2.5h10v9H6.5L3 14V2.5Zm2 3v1h6v-1H5Zm0 2.5v1h4v-1H5Z',
  settings:
    'M9.2 1.5h-2.4l-.4 1.7a4.9 4.9 0 0 0-1.2.7L3.6 3.2 2.2 4.6l.7 1.6a4.9 4.9 0 0 0-.4 1.2L1 7.8v2.4l1.5.4c.1.4.3.8.5 1.2l-.7 1.6 1.4 1.4 1.6-.7c.4.2.8.4 1.2.5l.4 1.4h2.4l.4-1.4c.4-.1.8-.3 1.2-.5l1.6.7 1.4-1.4-.7-1.6c.2-.4.4-.8.5-1.2l1.3-.4V7.8l-1.3-.4a4.9 4.9 0 0 0-.5-1.2l.7-1.6-1.4-1.4-1.6.7a4.9 4.9 0 0 0-1.2-.5l-.4-1.9ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  star: 'M8 1.8 9.8 5.6l4.2.6-3 3 .7 4.2L8 11.4l-3.7 2 .7-4.2-3-3 4.2-.6L8 1.8Zm0 2.1L6.9 6.2l-2.5.4 1.8 1.8-.4 2.5L8 9.7l2.2 1.2-.4-2.5 1.8-1.8-2.5-.4L8 3.9Z',
  'star-filled': 'M8 1.8 9.8 5.6l4.2.6-3 3 .7 4.2L8 11.4l-3.7 2 .7-4.2-3-3 4.2-.6L8 1.8Z',
  'folder-plus': 'M2 3h4.5l1.2 1.5H14v8.5H2V3Zm6.5 3v2H6.5v1h2v2h1v-2h2V8h-2V6h-1Z',
  grip: 'M5 3h2v2H5V3Zm4 0h2v2H9V3ZM5 7h2v2H5V7Zm4 0h2v2H9V7Zm-4 4h2v2H5v-2Zm4 0h2v2H9v-2Z',
  trash:
    'M5.5 2h5l.7 1H14v1.2H2V3h2.8l.7-1ZM3.5 5h9l-.7 9H4.2l-.7-9Zm2.5 1.5v6h1v-6H6Zm3 0v6h1v-6H9Z',
  refresh:
    'M12.5 6.5A4.8 4.8 0 0 0 4 5.1V3H2.8v4.2H7V6H5a3.6 3.6 0 1 1-.3 4.2l-1 .7A4.8 4.8 0 1 0 12.5 6.5Z',
  'external-link':
    'M9 2h5v5h-1.2V4.1L7.4 9.5l-.9-.9L11.9 3.2H9V2ZM3 4h4v1.2H4.2v7.6h7.6V10H13v4H3V4Z',
  'arrow-up': 'M8 2.5 3.5 7l.8.8L7.4 4.7V13.5h1.2V4.7l3.1 3.1.8-.8L8 2.5Z',
  layers:
    'M8 2 14 5.5 8 9 2 5.5 8 2ZM2.8 8.3 8 11.3l5.2-3 .8.7L8 12.5 2 9l.8-.7Zm0 2.8L8 14.1l5.2-3 .8.7L8 15.3 2 11.8l.8-.7Z',
  maximize:
    'M2.5 2.5h4.2v1.2H3.7v3H2.5V2.5Zm6.8 0h4.2v4.2h-1.2v-3h-3V2.5ZM2.5 9.3h1.2v3h3v1.2H2.5V9.3Zm9.8 0h1.2v4.2H9.3v-1.2h3v-3Z',
  calendar:
    'M4.5 1.5h1V3h5V1.5h1V3H14v11H2V3h2.5V1.5ZM3 6v7h10V6H3Zm1.5 1.5h2v2h-2v-2Zm3 0h2v2h-2v-2Zm3 0h1.5v2H10.5v-2Zm-6 3h2v2h-2v-2Zm3 0h2v2h-2v-2Z',
  message:
    'M2 2.5h12v8.5H6.5L3.5 13.5V11H2V2.5Zm1 1V10h1.5v1.4L6.1 10H13V3.5H3Zm2 2h6v1H5v-1Zm0 2h4v1H5v-1Z',
};

export function Icon({ name, size = 'md', className, label }: IconProps) {
  return (
    <svg
      className={cn('org-icon', `org-icon--${size}`, className)}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
