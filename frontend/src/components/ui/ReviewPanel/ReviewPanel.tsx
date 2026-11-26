import { useRef, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { PriorityFlag, PrioritySegmented, type PriorityLevel } from '../PriorityFlag/PriorityFlag';
import { StatusChip } from '../StatusChip/StatusChip';
import { TextArea, TextField } from '../TextField/TextField';
import './ReviewPanel.css';

/** Tag shown on each thread entry. */
export type ReviewThreadTag = 'changes' | 'sent' | 'comment';

export interface ReviewPerson {
  username: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface ReviewThreadItem {
  key: string;
  author?: ReviewPerson;
  role?: string;
  /** Display time (already formatted, shown in mono). */
  time: string;
  tag: ReviewThreadTag;
  body?: ReactNode;
  /** Extra content under the body (image preview, chips, actions). */
  extra?: ReactNode;
  unread?: boolean;
}

/** A status action; omit `onClick` (or pass `disabled`) to render it disabled. */
export interface ReviewAction {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

export interface ReviewPanelProps {
  /** Info label */
  title: string;
  subtitle?: string;
  /** Task status code (IP, P_LEAD, APP, RTK, HLD…) shown as the status chip. */
  status: string;
  /** Optional human label for the chip (e.g. "Changes requested"); the code sets the hue. */
  statusText?: string;
  priority: PriorityLevel | string;
  dueDate?: string | null;
  version?: string | null;
  submitter?: ReviewPerson | null;

  /** Optional live "Title entry" / "Subtitle entry" fields under the info label. */
  onTitleChange?: (v: string) => void;
  onSubtitleChange?: (v: string) => void;

  /** Priority selector; omit to hide. */
  onPriorityChange?: (p: PriorityLevel) => void;
  priorityLevels?: ReadonlyArray<PriorityLevel>;

  thread: ReadonlyArray<ReviewThreadItem>;
  emptyThreadText?: string;

  notes: string;
  onNotesChange: (v: string) => void;
  notesPlaceholder?: string;
  notesAriaLabel?: string;
  /** Extra controls in the notes footer (e.g. client visibility checkbox). */
  notesExtra?: ReactNode;
  /** Hide the notes + action row (read-only viewers). */
  readOnly?: boolean;

  onSend?: () => void;
  onComment?: () => void;
  /** Receives the files picked by the Attach key. Omit to disable Attach. */
  onAttach?: (files: File[]) => void;
  onMarkViewed?: () => void;
  busy?: boolean;

  approve?: ReviewAction;
  requestChanges?: ReviewAction;
  reject?: ReviewAction;
  hold?: ReviewAction;
  className?: string;
}

const TAG_LABEL: Record<ReviewThreadTag, string> = {
  changes: 'Changes',
  sent: 'Sent',
  comment: 'Comment',
};

/**
 * v2 review panel in the v1 visual language: info label, meta row, priority
 * selector, comment thread, notes and the review action row.
 */
export function ReviewPanel({
  title,
  subtitle,
  status,
  statusText,
  priority,
  dueDate,
  version,
  submitter,
  onTitleChange,
  onSubtitleChange,
  onPriorityChange,
  priorityLevels,
  thread,
  emptyThreadText = 'No comments yet.',
  notes,
  onNotesChange,
  notesPlaceholder = 'Write a note for the artist...',
  notesAriaLabel = 'Review notes',
  notesExtra,
  readOnly = false,
  onSend,
  onComment,
  onAttach,
  onMarkViewed,
  busy = false,
  approve,
  requestChanges,
  reject,
  hold,
  className,
}: ReviewPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const empty = notes.trim().length === 0;
  const showEntries = Boolean(onTitleChange || onSubtitleChange);

  const statusKey = (
    variant: 'approve' | 'changes' | 'reject' | 'hold',
    icon: 'check-circle' | 'redo' | 'x-circle' | 'clock',
    label: string,
    action?: ReviewAction,
  ) => (
    <Button
      variant={variant}
      iconLeft={<Icon name={icon} size="md" />}
      disabled={busy || !action?.onClick || action.disabled}
      title={action?.title}
      onClick={action?.onClick}
    >
      {label}
    </Button>
  );

  return (
    <section data-ui="review-panel" className={cn('org-review', className)}>
      {/* Info label */}
      <div className="org-review__info">
        <div className="org-review__info-head">
          <div className="org-review__info-text">
            <span className="org-review__etched">Title</span>
            <span className="org-review__title">{title}</span>
            {subtitle && <span className="org-review__subtitle">{subtitle}</span>}
          </div>
          {statusText ? (
            <span className="org-statuschip" data-status={status.toUpperCase()} data-ui="status-chip">
              <span className="org-statuschip__code">{statusText}</span>
            </span>
          ) : (
            <StatusChip status={status} />
          )}
        </div>
        <div className="org-review__meta">
          <PriorityFlag priority={priority} />
          {dueDate && (
            <span className="org-review__meta-item">
              <Icon name="calendar" size="sm" />
              <span className="org-review__mono">{dueDate}</span>
            </span>
          )}
          {version && (
            <span className="org-review__meta-item">
              <Icon name="film" size="sm" />
              <span className="org-review__mono">{version}</span>
            </span>
          )}
          {submitter && (
            <span className="org-review__meta-item">
              <Avatar
                username={submitter.username}
                fullName={submitter.fullName ?? undefined}
                avatarUrl={submitter.avatarUrl}
                size={20}
              />
              <span>{submitter.fullName || submitter.username}</span>
            </span>
          )}
        </div>
      </div>

      {showEntries && (
        <div className="org-review__entries">
          <label className="org-review__entry">
            <span className="org-review__etched">Title entry</span>
            <TextField
              className="org-review__mono-field"
              value={title}
              aria-label="Title entry"
              onChange={(e) => onTitleChange?.(e.target.value)}
            />
          </label>
          <label className="org-review__entry">
            <span className="org-review__etched">Subtitle entry</span>
            <TextField
              value={subtitle ?? ''}
              aria-label="Subtitle entry"
              onChange={(e) => onSubtitleChange?.(e.target.value)}
            />
          </label>
        </div>
      )}

      {onPriorityChange && (
        <div className="org-review__priority">
          <span className="org-review__etched">Priority</span>
          <PrioritySegmented
            value={typeof priority === 'string' ? (priority as PriorityLevel) : priority}
            levels={priorityLevels}
            onChange={onPriorityChange}
            disabled={busy}
          />
        </div>
      )}

      {/* Comment thread */}
      <div className="org-review__thread" role="list" aria-label="Review thread">
        {thread.length === 0 ? (
          <div className="org-review__empty">{emptyThreadText}</div>
        ) : (
          thread.map((c) => (
            <article
              key={c.key}
              role="listitem"
              className="org-review__comment"
              data-unread={c.unread ? 'true' : undefined}
            >
              {c.author ? (
                <Avatar
                  username={c.author.username}
                  fullName={c.author.fullName ?? undefined}
                  avatarUrl={c.author.avatarUrl}
                  size={32}
                />
              ) : (
                <span className="org-review__avatar-gap" />
              )}
              <div className="org-review__comment-main">
                <div className="org-review__comment-head">
                  <span className="org-review__who">
                    {c.author?.fullName || c.author?.username || 'System'}
                  </span>
                  {c.role && <span className="org-review__role">{c.role}</span>}
                  <span className="org-review__time">{c.time}</span>
                  <span className="org-review__tag" data-tag={c.tag}>
                    {TAG_LABEL[c.tag]}
                  </span>
                </div>
                {c.body && <div className="org-review__body">{c.body}</div>}
                {c.extra}
              </div>
            </article>
          ))
        )}
      </div>

      {!readOnly && (
        <>
          <TextArea
            className="org-review__notes"
            aria-label={notesAriaLabel}
            placeholder={notesPlaceholder}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
          {notesExtra && <div className="org-review__notes-extra">{notesExtra}</div>}

          <div className="org-review__actions">
            <Button
              variant="send"
              iconLeft={<Icon name="send" size="md" />}
              disabled={busy || empty || !onSend}
              onClick={onSend}
            >
              Send
            </Button>
            <Button
              iconLeft={<Icon name="comment" size="md" />}
              disabled={busy || empty || !onComment}
              onClick={onComment}
            >
              Comment
            </Button>
            <Button
              iconLeft={<Icon name="paperclip" size="md" />}
              disabled={busy || !onAttach}
              onClick={() => fileRef.current?.click()}
            >
              Attach
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) onAttach?.(files);
              }}
            />
            <Button
              iconLeft={<Icon name="eye" size="md" />}
              disabled={busy || !onMarkViewed}
              onClick={onMarkViewed}
            >
              Mark viewed
            </Button>
            <span className="org-review__spacer" />
            {statusKey('approve', 'check-circle', 'Approve', approve)}
            {statusKey('changes', 'redo', 'Request changes', requestChanges)}
            {statusKey('reject', 'x-circle', 'Reject', reject)}
            {statusKey('hold', 'clock', 'Hold', hold)}
          </div>
        </>
      )}
    </section>
  );
}
