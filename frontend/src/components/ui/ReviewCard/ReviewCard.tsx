import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Avatar } from '../Avatar/Avatar';
import { Badge, type Tone } from '../Badge/Badge';
import { UnreadDot } from '../UnreadDot/UnreadDot';
import './ReviewCard.css';

export interface ReviewCardPerson {
  username: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface ReviewCardProps {
  /** Headline, e.g. "Retake — Lead review" or "Annotation · F12". */
  title: string;
  tone?: Tone;
  /** Short decision/kind tag shown next to the title. */
  tag?: string;
  author?: ReviewCardPerson | null;
  /** Fallback author label when no person is known. */
  authorLabel?: string;
  /** ISO timestamp. */
  at?: string | null;
  /** The task this review belongs to (code + optional name). */
  taskLabel?: string | null;
  onTaskClick?: () => void;
  /** Extra context chips (version, frame, visibility...). */
  chips?: ReadonlyArray<{ label: string; tone?: Tone }>;
  /** Optional painting / annotation preview image. */
  imageUrl?: string | null;
  imageAlt?: string;
  onImageClick?: () => void;
  /** Optional text body. */
  body?: ReactNode;
  unread?: boolean;
  actions?: ReactNode;
  className?: string;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

/**
 * Single visual format for every kind of review feedback in the app: review
 * decisions, comments, and paintings/annotations. Every card has a title, the
 * people involved and the task it belongs to; image and text are optional.
 */
export function ReviewCard({
  title,
  tone = 'neutral',
  tag,
  author,
  authorLabel,
  at,
  taskLabel,
  onTaskClick,
  chips = [],
  imageUrl,
  imageAlt,
  onImageClick,
  body,
  unread = false,
  actions,
  className,
}: ReviewCardProps) {
  const who = author?.fullName || author?.username || authorLabel || 'Unknown';
  return (
    <article data-ui="review-card" data-tone={tone} className={cn('org-rcard', className)}>
      <div className="org-rcard__avatar">
        <Avatar
          username={author?.username ?? who}
          fullName={author?.fullName ?? who}
          avatarUrl={author?.avatarUrl}
          size="md"
        />
      </div>
      <div className="org-rcard__main">
        <header className="org-rcard__head">
          <span className="org-rcard__title">{title}</span>
          {tag && <Badge tone={tone}>{tag}</Badge>}
          {unread && <UnreadDot />}
          <span className="org-rcard__when">{formatWhen(at)}</span>
        </header>
        <div className="org-rcard__meta">
          <span className="org-rcard__who">{who}</span>
          {taskLabel &&
            (onTaskClick ? (
              <button type="button" className="org-rcard__task" onClick={onTaskClick}>
                {taskLabel}
              </button>
            ) : (
              <span className="org-rcard__task">{taskLabel}</span>
            ))}
          {chips.map((c) => (
            <Badge key={c.label} tone={c.tone ?? 'neutral'}>
              {c.label}
            </Badge>
          ))}
        </div>
        {imageUrl && (
          <button
            type="button"
            className="org-rcard__image"
            onClick={onImageClick}
            disabled={!onImageClick}
            aria-label={imageAlt ?? 'Open painting'}
          >
            <img src={imageUrl} alt={imageAlt ?? ''} />
          </button>
        )}
        {body && <div className="org-rcard__body">{body}</div>}
        {actions && <div className="org-rcard__actions">{actions}</div>}
      </div>
    </article>
  );
}
