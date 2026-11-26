import type { ReviewCardPerson, Tone } from '../../components/ui';

/**
 * Normalises the different review sources of a task (stage review decisions,
 * review/note comments and painted media annotations) into one feed so every
 * view renders them with the same ReviewCard format.
 */
export interface ReviewFeedItem {
  key: string;
  title: string;
  tone: Tone;
  tag?: string;
  author?: ReviewCardPerson;
  authorId?: string | null;
  authorLabel?: string;
  at: string;
  chips: Array<{ label: string; tone?: Tone }>;
  fileId?: string | null;
  frame?: number | null;
  body?: string;
  unread?: boolean;
}

interface ReviewLike {
  id: string;
  round_no: number;
  version_id?: string | null;
  stage: 'lead' | 'sup' | 'client';
  decision: 'pending' | 'approved' | 'retake';
  reviewer_id?: string | null;
  reviewer_name?: string | null;
  on_behalf_of?: string | null;
  comment_id?: string | null;
  created_at: string;
}

interface CommentLike {
  id: string;
  author_id?: string | null;
  author_username?: string | null;
  author_full_name?: string | null;
  kind: string;
  visibility: 'internal' | 'client';
  body: string;
  version_id?: string | null;
  file_id?: string | null;
  frame?: number | null;
  review_decision?: string | null;
  created_at: string;
}

const STAGE_LABEL: Record<ReviewLike['stage'], string> = {
  lead: 'Lead',
  sup: 'Supervisor',
  client: 'Client',
};

function decisionTone(decision: string | null | undefined): Tone {
  if (decision === 'approved') return 'success';
  if (decision === 'retake') return 'danger';
  if (decision === 'pending') return 'info';
  return 'neutral';
}

export function buildReviewFeed(opts: {
  reviews: ReadonlyArray<ReviewLike>;
  comments: ReadonlyArray<CommentLike>;
  versionLabels?: ReadonlyMap<string, string>;
  avatarUrlFor?: (userId: string | null | undefined) => string | null;
  currentUserId?: string | null;
  /** Feedback newer than this ISO timestamp (and not by the current user) is flagged unread. */
  unreadAfter?: string | null;
}): ReviewFeedItem[] {
  const { reviews, comments, versionLabels, avatarUrlFor, currentUserId, unreadAfter } = opts;
  const commentById = new Map(comments.map((c) => [c.id, c]));
  const used = new Set<string>();
  const items: ReviewFeedItem[] = [];

  const versionChip = (vid: string | null | undefined) => {
    const label = vid ? versionLabels?.get(vid) : undefined;
    return label ? [{ label, tone: 'neutral' as Tone }] : [];
  };
  const frameChip = (frame: number | null | undefined) =>
    frame !== null && frame !== undefined ? [{ label: `F${frame}`, tone: 'neutral' as Tone }] : [];

  for (const rev of reviews) {
    const cmt = rev.comment_id ? commentById.get(rev.comment_id) : undefined;
    if (cmt) used.add(cmt.id);
    const stage = STAGE_LABEL[rev.stage] ?? rev.stage;
    const title =
      rev.decision === 'approved'
        ? `Approved — ${stage} review`
        : rev.decision === 'retake'
          ? `Retake — ${stage} review`
          : `Awaiting ${stage} review`;
    const reviewerName = rev.reviewer_name ?? cmt?.author_full_name ?? null;
    items.push({
      key: `rev:${rev.id}`,
      title,
      tone: decisionTone(rev.decision),
      tag: `R${rev.round_no}`,
      author: reviewerName
        ? {
            username: cmt?.author_username ?? reviewerName,
            fullName: reviewerName,
            avatarUrl: avatarUrlFor?.(rev.reviewer_id ?? cmt?.author_id) ?? null,
          }
        : undefined,
      authorId: rev.reviewer_id ?? cmt?.author_id ?? null,
      authorLabel: rev.decision === 'pending' ? 'Waiting for reviewer' : 'Reviewer',
      at: rev.created_at,
      chips: [
        ...versionChip(rev.version_id ?? cmt?.version_id),
        ...frameChip(cmt?.frame),
        ...(rev.on_behalf_of
          ? [{ label: `on behalf of ${rev.on_behalf_of}`, tone: 'accent' as Tone }]
          : []),
      ],
      fileId: cmt?.file_id ?? null,
      frame: cmt?.frame ?? null,
      body: cmt?.body || undefined,
    });
  }

  for (const cmt of comments) {
    if (used.has(cmt.id)) continue;
    const isMedia = cmt.kind === 'media' || Boolean(cmt.file_id);
    const title =
      cmt.kind === 'review'
        ? cmt.review_decision
          ? `Review — ${cmt.review_decision}`
          : 'Review note'
        : isMedia
          ? 'Painted review'
          : 'Comment';
    const name = cmt.author_full_name || cmt.author_username || null;
    items.push({
      key: `cmt:${cmt.id}`,
      title,
      tone:
        cmt.kind === 'review' ? decisionTone(cmt.review_decision) : isMedia ? 'accent' : 'neutral',
      tag: cmt.visibility === 'client' ? 'client' : undefined,
      author: name
        ? {
            username: cmt.author_username ?? name,
            fullName: cmt.author_full_name ?? name,
            avatarUrl: avatarUrlFor?.(cmt.author_id) ?? null,
          }
        : undefined,
      authorId: cmt.author_id ?? null,
      authorLabel: 'User',
      at: cmt.created_at,
      chips: [...versionChip(cmt.version_id), ...frameChip(cmt.frame)],
      fileId: cmt.file_id ?? null,
      frame: cmt.frame ?? null,
      body: cmt.body || undefined,
    });
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  if (unreadAfter !== undefined) {
    for (const it of items) {
      it.unread =
        (!unreadAfter || it.at > unreadAfter) &&
        Boolean(it.authorId) &&
        it.authorId !== currentUserId &&
        it.tone !== 'info';
    }
  }
  return items;
}
