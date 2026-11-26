/** v1 status families used by the 3px left row bar. */
export type RowStatusFamily = 'wip' | 'review' | 'approved' | 'rejected' | 'idle' | 'hold';

const MAP: Record<string, RowStatusFamily> = {
  wip: 'wip',
  ip: 'wip',
  changes: 'wip',
  review: 'review',
  pending: 'review',
  p_lead: 'review',
  p_sup: 'review',
  p_client: 'review',
  approved: 'approved',
  app: 'approved',
  rejected: 'rejected',
  rtk: 'rejected',
  idle: 'idle',
  waiting: 'idle',
  wtg: 'idle',
  rdy: 'idle',
  hold: 'hold',
  hld: 'hold',
};

/** Normalise a v1 family name or a task status code (IP, RTK, P_LEAD…) to a family. */
export function toRowStatus(value: string | null | undefined): RowStatusFamily | undefined {
  if (!value) return undefined;
  return MAP[value.toLowerCase()];
}
