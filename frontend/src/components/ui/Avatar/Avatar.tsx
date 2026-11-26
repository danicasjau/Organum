import './Avatar.css';

export interface AvatarProps {
  username: string;
  fullName?: string;
  avatarUrl?: string | null;
  /** Named sizes (sm 20, md 32, lg 40) or an exact v1 size in px. */
  size?: 'sm' | 'md' | 'lg' | AvatarPx;
  title?: string;
  /** Optional presence LED anchored bottom-right. */
  presence?: 'online' | 'away' | 'offline';
  className?: string;
}

export type AvatarPx = 18 | 20 | 24 | 32 | 40 | 56 | 72;

function hashTone(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return hash % 8;
}

function initialsFor(fullName: string | undefined, username: string): string {
  const source = (fullName || username || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function Avatar({
  username,
  fullName,
  avatarUrl,
  size = 'sm',
  title,
  presence,
  className,
}: AvatarProps) {
  const tone = hashTone(username || fullName || 'u');
  const label = title ?? (fullName ? `${fullName} (@${username})` : username);
  const initials = initialsFor(fullName, username);

  return (
    <span
      data-ui="avatar"
      data-size={size}
      data-avatar-tone={tone}
      data-presence={presence}
      className={className ? `org-avatar ${className}` : 'org-avatar'}
      title={label}
      aria-label={label}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={label} className="org-avatar__img" />
      ) : (
        <span className="org-avatar__initials">{initials}</span>
      )}
      {presence && <span className="org-avatar__presence" aria-hidden="true" />}
    </span>
  );
}
