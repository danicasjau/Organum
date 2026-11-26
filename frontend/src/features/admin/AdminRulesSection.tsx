import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Panel,
  Select,
  SortableList,
  Stack,
  Text,
  TextField,
} from '../../components/ui';
import {
  apiClient,
  type DepartmentOut,
  type EntityOut,
  type RuleOut,
  type RulePreviewOut,
  type UserOut,
} from '../../lib/api/client';
import './AdminRulesSection.css';

type RuleTrigger = RuleOut['trigger'];

interface ConditionLeaf {
  kind: 'leaf';
  field: string;
  operator: string;
  value: string;
}

interface ConditionSubgroup {
  kind: 'group';
  op: 'AND' | 'OR';
  items: ConditionLeaf[];
}

type ConditionItem = ConditionLeaf | ConditionSubgroup;

interface RuleActionDraft {
  type:
    | 'assign'
    | 'set_priority'
    | 'set_bid_hours'
    | 'set_review_flags'
    | 'set_ideal_dates'
    | 'add_tag'
    | 'add_dependency';
  department: string;
  task_name: string;
  role: 'artist' | 'lead' | 'supervisor';
  user_id: string;
  priority: 'normal' | 'high' | 'stopper';
  bid_hours: string;
  needs_lead_review: boolean;
  needs_sup_review: boolean;
  needs_client_review: boolean;
  start_offset_days: string;
  duration_days: string;
  tag: string;
  scope: 'same' | 'uses' | 'used_in';
  upstream_department: string;
  upstream_task_name: string;
  threshold: 'APP' | 'PUBLISHED' | 'ANY_STATUS';
  override_manual: boolean;
}

const CONDITION_FIELDS = [
  { value: 'entity.name', label: 'entity.name' },
  { value: 'entity.type', label: 'entity.type' },
  { value: 'entity.tags', label: 'entity.tags' },
  { value: 'entity.path', label: 'entity.path' },
  { value: 'entity.uses.name', label: 'entity.uses.name' },
  { value: 'entity.used_in.name', label: 'entity.used_in.name' },
  { value: 'entity.uses.type', label: 'entity.uses.type' },
  { value: 'department', label: 'department' },
  { value: 'task.name', label: 'task.name' },
  { value: 'task.code', label: 'task.code' },
];

const CONDITION_OPS = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts_with' },
  { value: 'in', label: 'in (a, b)' },
  { value: 'matches', label: 'matches (regex)' },
  { value: '>', label: '> (natural)' },
  { value: '>=', label: '>= (natural)' },
  { value: '<', label: '< (natural)' },
  { value: '<=', label: '<= (natural)' },
];

const ACTION_TYPES = [
  { value: 'assign', label: 'Assign user' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'set_bid_hours', label: 'Set bid hours' },
  { value: 'set_review_flags', label: 'Set review flags' },
  { value: 'set_ideal_dates', label: 'Set ideal dates' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'add_dependency', label: 'Add dependency' },
];

/** Inline validation for one condition (mirrors the server's checks). */
export function validateConditionLeaf(leaf: { operator: string; value: string }): string | null {
  const value = leaf.value.trim();
  if (!value) return 'Value is required';
  if (leaf.operator === 'in' && value.split(',').every((v) => !v.trim())) {
    return 'List at least one value (a, b)';
  }
  if (leaf.operator === 'matches') {
    if (value.length > 256) return 'Regex is too long (max 256)';
    try {
      new RegExp(value);
    } catch {
      return 'Invalid regular expression';
    }
  }
  return null;
}

function defaultLeaf(): ConditionLeaf {
  return { kind: 'leaf', field: 'entity.type', operator: '=', value: 'shot' };
}

function defaultAction(): RuleActionDraft {
  return {
    type: 'set_priority',
    department: '',
    task_name: '',
    role: 'artist',
    user_id: '',
    priority: 'high',
    bid_hours: '8',
    needs_lead_review: true,
    needs_sup_review: false,
    needs_client_review: false,
    start_offset_days: '0',
    duration_days: '3',
    tag: '',
    scope: 'uses',
    upstream_department: '',
    upstream_task_name: '',
    threshold: 'APP',
    override_manual: false,
  };
}

function parseConditionsFromRule(raw: Record<string, unknown> | undefined): {
  rootOp: 'AND' | 'OR';
  items: ConditionItem[];
} {
  const op = String(raw?.op ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const items: ConditionItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      const subOp = String(obj.op ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
      const leaves: ConditionLeaf[] = obj.items
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        .map((x) => ({
          kind: 'leaf',
          field: String(x.field ?? 'entity.name'),
          operator: String(x.operator ?? '='),
          value: String(x.value ?? ''),
        }));
      items.push({ kind: 'group', op: subOp, items: leaves.length > 0 ? leaves : [defaultLeaf()] });
    } else {
      items.push({
        kind: 'leaf',
        field: String(obj.field ?? 'entity.name'),
        operator: String(obj.operator ?? '='),
        value: String(obj.value ?? ''),
      });
    }
  }
  return { rootOp: op, items: items.length > 0 ? items : [defaultLeaf()] };
}

function parseActionsFromRule(
  rawList: Array<Record<string, unknown>> | undefined,
): RuleActionDraft[] {
  if (!Array.isArray(rawList) || rawList.length === 0) return [defaultAction()];
  return rawList.map((raw) => ({
    ...defaultAction(),
    type: (raw.type as RuleActionDraft['type']) ?? 'set_priority',
    department: String(raw.department ?? ''),
    task_name: String(raw.task_name ?? ''),
    role: (raw.role as RuleActionDraft['role']) ?? 'artist',
    user_id: String(raw.user_id ?? ''),
    priority: (raw.priority as RuleActionDraft['priority']) ?? 'normal',
    bid_hours: raw.bid_hours !== undefined ? String(raw.bid_hours) : '8',
    needs_lead_review: raw.needs_lead_review !== undefined ? Boolean(raw.needs_lead_review) : true,
    needs_sup_review: raw.needs_sup_review !== undefined ? Boolean(raw.needs_sup_review) : false,
    needs_client_review:
      raw.needs_client_review !== undefined ? Boolean(raw.needs_client_review) : false,
    start_offset_days: raw.start_offset_days !== undefined ? String(raw.start_offset_days) : '0',
    duration_days: raw.duration_days !== undefined ? String(raw.duration_days) : '3',
    tag: String(raw.tag ?? ''),
    scope: (raw.scope as RuleActionDraft['scope']) ?? 'same',
    upstream_department: String(raw.upstream_department ?? ''),
    upstream_task_name: String(raw.upstream_task_name ?? ''),
    threshold: (raw.threshold as RuleActionDraft['threshold']) ?? 'APP',
    override_manual: Boolean(raw.override_manual),
  }));
}

function serializeConditions(
  rootOp: 'AND' | 'OR',
  items: ConditionItem[],
): Record<string, unknown> {
  return {
    op: rootOp,
    items: items.map((it) => {
      if (it.kind === 'group') {
        return {
          op: it.op,
          items: it.items.map((leaf) => ({
            field: leaf.field,
            operator: leaf.operator,
            value: leaf.value,
          })),
        };
      }
      return { field: it.field, operator: it.operator, value: it.value };
    }),
  };
}

function serializeActions(actions: RuleActionDraft[]): Array<Record<string, unknown>> {
  return actions.map((a) => {
    const base: Record<string, unknown> = {
      type: a.type,
      department: a.department.trim() || undefined,
      task_name: a.task_name.trim() || undefined,
      override_manual: a.override_manual,
    };
    if (a.type === 'assign') {
      return { ...base, role: a.role, user_id: a.user_id };
    }
    if (a.type === 'set_priority') {
      return { ...base, priority: a.priority };
    }
    if (a.type === 'set_bid_hours') {
      return { ...base, bid_hours: Number(a.bid_hours) || 0 };
    }
    if (a.type === 'set_review_flags') {
      return {
        ...base,
        needs_lead_review: a.needs_lead_review,
        needs_sup_review: a.needs_sup_review,
        needs_client_review: a.needs_client_review,
      };
    }
    if (a.type === 'set_ideal_dates') {
      return {
        ...base,
        start_offset_days: Number(a.start_offset_days) || 0,
        duration_days: Math.max(1, Number(a.duration_days) || 3),
      };
    }
    if (a.type === 'add_tag') {
      return { ...base, tag: a.tag.trim() };
    }
    return {
      ...base,
      scope: a.scope,
      upstream_department: a.upstream_department.trim(),
      upstream_task_name: a.upstream_task_name.trim() || undefined,
      threshold: a.threshold,
    };
  });
}

function buildSentencePreview(
  trigger: RuleTrigger,
  rootOp: 'AND' | 'OR',
  items: ConditionItem[],
  actions: RuleActionDraft[],
  usersById: Map<string, UserOut>,
): string {
  const condStr = items
    .map((it) => {
      if (it.kind === 'group') {
        const inner = it.items
          .map((l) => `${l.field} ${l.operator} ${l.value || '?'}`)
          .join(` ${it.op} `);
        return `(${inner})`;
      }
      return `${it.field} ${it.operator} ${it.value || '?'}`;
    })
    .join(` ${rootOp} `);

  const actStr = actions
    .map((a) => {
      const target = `${a.department || '*'}.${a.task_name || '*'}`;
      if (a.type === 'assign') {
        const u = usersById.get(a.user_id);
        return `${target} assign ${a.role} = ${u ? u.username : '?'}`;
      }
      if (a.type === 'set_priority') return `${target} priority = ${a.priority}`;
      if (a.type === 'set_bid_hours') return `${target} bid = ${a.bid_hours || '0'}h`;
      if (a.type === 'set_review_flags') {
        return `${target} review (lead=${a.needs_lead_review}, sup=${a.needs_sup_review}, client=${a.needs_client_review})`;
      }
      if (a.type === 'set_ideal_dates') {
        return `${target} dates +${a.start_offset_days}d (${a.duration_days}d)`;
      }
      if (a.type === 'add_tag') return `${target} +tag '${a.tag || '?'}'`;
      return `${target} dep (${a.scope}, ${a.upstream_department || '?'}, ${a.threshold})`;
    })
    .join('; ');

  return `WHEN [${trigger}] IF ${condStr || 'always'} THEN ${actStr || '—'}`;
}

export function AdminRulesSection({ projectUuid }: { projectUuid: string | null }) {
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: ['admin-rules', projectUuid],
    queryFn: () => apiClient.listRules(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const deptsQuery = useQuery({
    queryKey: ['departments', projectUuid],
    queryFn: () => apiClient.listDepartments(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const usersQuery = useQuery({
    queryKey: ['users', projectUuid],
    queryFn: () => apiClient.listUsers(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const entitiesQuery = useQuery({
    queryKey: ['entities', projectUuid],
    queryFn: () => apiClient.listEntities(projectUuid),
    enabled: Boolean(projectUuid),
  });

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const departments: DepartmentOut[] = useMemo(() => deptsQuery.data ?? [], [deptsQuery.data]);
  const users: UserOut[] = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const entities: EntityOut[] = useMemo(
    () => entitiesQuery.data?.entities ?? [],
    [entitiesQuery.data?.entities],
  );
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [name, setName] = useState('New Rule');
  const [trigger, setTrigger] = useState<RuleTrigger>('manual');
  const [enabled, setEnabled] = useState(true);
  const [rootOp, setRootOp] = useState<'AND' | 'OR'>('AND');
  const [condItems, setCondItems] = useState<ConditionItem[]>([defaultLeaf()]);
  const [actions, setActions] = useState<RuleActionDraft[]>([defaultAction()]);
  const [preview, setPreview] = useState<RulePreviewOut | null>(null);
  const [previewMatchesCurrent, setPreviewMatchesCurrent] = useState(false);
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRuleIntoForm = (rule: RuleOut) => {
    setSelectedRuleId(rule.id);
    setName(rule.name);
    setTrigger(rule.trigger);
    setEnabled(rule.enabled);
    const parsedCond = parseConditionsFromRule(rule.conditions_json);
    setRootOp(parsedCond.rootOp);
    setCondItems(parsedCond.items);
    setActions(parseActionsFromRule(rule.actions_json));
    setPreview(null);
    setPreviewMatchesCurrent(false);
    setStatusMsg(null);
    setErrorMsg(null);
  };

  useEffect(() => {
    if (selectedRuleId === null && rules.length > 0 && rules[0]) {
      loadRuleIntoForm(rules[0]);
    }
  }, [rules, selectedRuleId]);

  const handleNewRule = () => {
    setSelectedRuleId('__new__');
    setName('Shot priority / assignment rule');
    setTrigger('manual');
    setEnabled(true);
    setRootOp('AND');
    setCondItems([defaultLeaf()]);
    setActions([defaultAction()]);
    setPreview(null);
    setPreviewMatchesCurrent(false);
    setStatusMsg(null);
    setErrorMsg(null);
  };

  const invalidatePreview = () => {
    setPreviewMatchesCurrent(false);
  };

  const validationErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Rule name is required';
    condItems.forEach((it, idx) => {
      if (it.kind === 'leaf') {
        const msg = validateConditionLeaf(it);
        if (msg) errs[`cond-${idx}`] = msg;
      } else {
        it.items.forEach((leaf, sIdx) => {
          const msg = validateConditionLeaf(leaf);
          if (msg) errs[`cond-${idx}-${sIdx}`] = msg;
        });
      }
    });
    if (actions.length === 0) errs.actions = 'Add at least one action';
    actions.forEach((a, idx) => {
      if (a.type === 'assign' && !a.user_id) {
        errs[`act-${idx}`] = 'Select a target user';
      } else if (a.type === 'add_tag' && !a.tag.trim()) {
        errs[`act-${idx}`] = 'Tag name is required';
      } else if (a.type === 'add_dependency' && !a.upstream_department.trim()) {
        errs[`act-${idx}`] = 'Upstream department is required';
      } else if (
        a.type === 'set_bid_hours' &&
        (Number.isNaN(Number(a.bid_hours)) || Number(a.bid_hours) < 0)
      ) {
        errs[`act-${idx}`] = 'Bid hours must be >= 0';
      }
    });
    return errs;
  }, [name, condItems, actions]);

  const liveSentence = useMemo(
    () => buildSentencePreview(trigger, rootOp, condItems, actions, usersById),
    [trigger, rootOp, condItems, actions, usersById],
  );

  const suggestionValues = useMemo(() => {
    const vals = new Set<string>(['shot', 'asset', 'character', 'prop']);
    entities.forEach((e) => {
      vals.add(e.name);
      if (e.entity_type) vals.add(e.entity_type);
      e.tags?.forEach((t) => vals.add(t));
    });
    departments.forEach((d) => {
      vals.add(d.name);
      if (d.short_code) vals.add(d.short_code);
    });
    return Array.from(vals).slice(0, 80);
  }, [entities, departments]);

  const handleSave = async (): Promise<RuleOut | null> => {
    if (Object.keys(validationErrors).length > 0) {
      setErrorMsg('Fix inline rule validation errors before saving.');
      return null;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = {
        name: name.trim(),
        enabled,
        trigger,
        conditions_json: serializeConditions(rootOp, condItems),
        actions_json: serializeActions(actions),
      };
      let saved: RuleOut;
      if (selectedRuleId && selectedRuleId !== '__new__') {
        saved = await apiClient.updateRule(selectedRuleId, payload, projectUuid);
      } else {
        saved = await apiClient.createRule({ ...payload, sort_order: rules.length }, projectUuid);
      }
      setSelectedRuleId(saved.id);
      await queryClient.invalidateQueries({ queryKey: ['admin-rules', projectUuid] });
      setStatusMsg(`Saved rule "${saved.name}".`);
      return saved;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save rule');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async () => {
    if (Object.keys(validationErrors).length > 0) {
      setErrorMsg('Fix inline rule validation errors before previewing.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.previewRule(
        {
          trigger,
          conditions_json: serializeConditions(rootOp, condItems),
          actions_json: serializeActions(actions),
        },
        projectUuid,
      );
      setPreview(res);
      setPreviewMatchesCurrent(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!previewMatchesCurrent) {
      setErrorMsg('Run "Preview matches" first to review affected tasks before applying.');
      return;
    }
    let targetId = selectedRuleId;
    if (!targetId || targetId === '__new__') {
      const saved = await handleSave();
      if (!saved) return;
      targetId = saved.id;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiClient.applyRules({ rule_ids: [targetId] }, projectUuid);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', projectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['task', projectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['admin-audit', projectUuid] }),
      ]);
      setStatusMsg(
        `Applied rule: ${res.applied_count} change(s) across ${res.matched_tasks} matched task(s).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRuleId || selectedRuleId === '__new__') return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await apiClient.deleteRule(selectedRuleId, projectUuid);
      setSelectedRuleId(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-rules', projectUuid] });
      setStatusMsg('Deleted rule.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const moveOrder = async (ruleId: string, dir: -1 | 1) => {
    const idx = rules.findIndex((r) => r.id === ruleId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= rules.length) return;
    const ids = rules.map((r) => r.id);
    const tmp = ids[idx]!;
    ids[idx] = ids[swapIdx]!;
    ids[swapIdx] = tmp;
    await apiClient.reorderRules(ids, projectUuid);
    await queryClient.invalidateQueries({ queryKey: ['admin-rules', projectUuid] });
  };

  const dropReorder = async (targetId: string) => {
    if (!dragRuleId || dragRuleId === targetId) return;
    const ids = rules.map((r) => r.id).filter((id) => id !== dragRuleId);
    const idx = ids.indexOf(targetId);
    ids.splice(idx >= 0 ? idx : ids.length, 0, dragRuleId);
    setDragRuleId(null);
    await apiClient.reorderRules(ids, projectUuid);
    await queryClient.invalidateQueries({ queryKey: ['admin-rules', projectUuid] });
  };

  return (
    <div className="org-rules" data-ui="admin-rules">
      <datalist id="org-rule-value-suggestions">
        {suggestionValues.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <aside className="org-rules__list-pane" aria-label="Project rules">
        <div className="org-rules__list-hdr">
          <Text size="sm">Rules ({rules.length})</Text>
          <Button size="sm" variant="primary" onClick={handleNewRule}>
            + New Rule
          </Button>
        </div>
        <div className="org-rules__list">
          {rules.length === 0 ? (
            <div className="org-rules__empty">
              <Text size="sm" variant="muted">
                No rules yet. Click + New Rule to automate assignments, priorities, and
                dependencies.
              </Text>
            </div>
          ) : (
            rules.map((r, idx) => (
              <div
                key={r.id}
                draggable
                onDragStart={() => setDragRuleId(r.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void dropReorder(r.id)}
                className={`org-rules__item ${selectedRuleId === r.id ? 'is-selected' : ''}`}
                onClick={() => loadRuleIntoForm(r)}
              >
                <div className="org-rules__item-top">
                  <Checkbox
                    ariaLabel={`Enable rule ${r.name}`}
                    checked={r.enabled}
                    onChange={(checked) => {
                      void apiClient
                        .updateRule(r.id, { enabled: checked }, projectUuid)
                        .then(() =>
                          queryClient.invalidateQueries({ queryKey: ['admin-rules', projectUuid] }),
                        );
                    }}
                  />
                  <span className="org-rules__item-name">{r.name}</span>
                </div>
                <div className="org-rules__item-meta">
                  <Badge tone="neutral">{r.trigger}</Badge>
                  <div className="org-rules__item-btns">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={idx === 0}
                      aria-label={`Move ${r.name} up`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void moveOrder(r.id, -1);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={idx === rules.length - 1}
                      aria-label={`Move ${r.name} down`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void moveOrder(r.id, 1);
                      }}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="org-rules__editor">
        {errorMsg && <Banner severity="danger">{errorMsg}</Banner>}
        {statusMsg && <Banner severity="success">{statusMsg}</Banner>}

        <Panel
          title={
            selectedRuleId && selectedRuleId !== '__new__' ? `Rule Editor — ${name}` : 'New Rule'
          }
        >
          <Stack gap="2">
            <div className="org-rules__form-row">
              <label className="org-rules__field">
                <Text size="sm" variant="muted">
                  Rule Name
                </Text>
                <TextField
                  aria-label="Rule Name"
                  value={name}
                  error={Boolean(validationErrors.name)}
                  onChange={(e) => {
                    setName(e.target.value);
                    invalidatePreview();
                  }}
                />
                {validationErrors.name && (
                  <Text size="sm" variant="danger">
                    {validationErrors.name}
                  </Text>
                )}
              </label>

              <label className="org-rules__field">
                <Text size="sm" variant="muted">
                  WHEN Trigger
                </Text>
                <Select
                  ariaLabel="Rule trigger"
                  value={trigger}
                  onChange={(v) => {
                    setTrigger(v as RuleTrigger);
                    invalidatePreview();
                  }}
                  options={[
                    { value: 'manual', label: 'manual' },
                    { value: 'entity_created', label: 'entity_created' },
                    { value: 'task_created', label: 'task_created' },
                    { value: 'link_created', label: 'link_created' },
                  ]}
                />
              </label>

              <Checkbox
                label="Enabled"
                checked={enabled}
                onChange={(v) => {
                  setEnabled(v);
                  invalidatePreview();
                }}
              />
            </div>

            <div className="org-rules__block">
              <div className="org-rules__block-hdr">
                <Text size="sm">IF Conditions</Text>
                <div className="org-rules__inline">
                  <Select
                    ariaLabel="Root condition combinator"
                    value={rootOp}
                    onChange={(v) => {
                      setRootOp(v as 'AND' | 'OR');
                      invalidatePreview();
                    }}
                    options={[
                      { value: 'AND', label: 'AND (all)' },
                      { value: 'OR', label: 'OR (any)' },
                    ]}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      setCondItems((prev) => [...prev, defaultLeaf()]);
                      invalidatePreview();
                    }}
                  >
                    + Condition
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setCondItems((prev) => [
                        ...prev,
                        { kind: 'group', op: 'OR', items: [defaultLeaf()] },
                      ]);
                      invalidatePreview();
                    }}
                  >
                    + Subgroup
                  </Button>
                </div>
              </div>

              {condItems.length === 0 && (
                <Text size="sm" variant="muted" data-ui="rule-no-conditions">
                  No conditions: the rule applies to every task (always).
                </Text>
              )}
              <SortableList
                ariaLabel="Conditions"
                items={condItems.map((it, idx) => ({ it, idx }))}
                getId={(x) => String(x.idx)}
                getLabel={(x) =>
                  x.it.kind === 'leaf' ? `condition ${x.idx + 1}` : `subgroup ${x.idx + 1}`
                }
                onReorder={(ids) => {
                  setCondItems((prev) => ids.map((i) => prev[Number(i)]!));
                  invalidatePreview();
                }}
                renderItem={({ it, idx }) =>
                  it.kind === 'leaf' ? (
                    <div key={`c-${idx}`} className="org-rules__cond-row">
                      <Select
                        ariaLabel={`Condition ${idx + 1} field`}
                        value={it.field}
                        onChange={(v) => {
                          setCondItems((prev) =>
                            prev.map((x, i) =>
                              i === idx && x.kind === 'leaf' ? { ...x, field: v } : x,
                            ),
                          );
                          invalidatePreview();
                        }}
                        options={CONDITION_FIELDS}
                      />
                      <Select
                        ariaLabel={`Condition ${idx + 1} operator`}
                        value={it.operator}
                        onChange={(v) => {
                          setCondItems((prev) =>
                            prev.map((x, i) =>
                              i === idx && x.kind === 'leaf' ? { ...x, operator: v } : x,
                            ),
                          );
                          invalidatePreview();
                        }}
                        options={CONDITION_OPS}
                      />
                      <TextField
                        aria-label={`Condition ${idx + 1} value`}
                        list="org-rule-value-suggestions"
                        value={it.value}
                        error={Boolean(validationErrors[`cond-${idx}`])}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCondItems((prev) =>
                            prev.map((x, i) =>
                              i === idx && x.kind === 'leaf' ? { ...x, value: val } : x,
                            ),
                          );
                          invalidatePreview();
                        }}
                      />
                      {validationErrors[`cond-${idx}`] && (
                        <Text size="sm" variant="danger">
                          {validationErrors[`cond-${idx}`]}
                        </Text>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove condition ${idx + 1}`}
                        onClick={() => {
                          setCondItems((prev) => prev.filter((_, i) => i !== idx));
                          invalidatePreview();
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div key={`g-${idx}`} className="org-rules__subgroup">
                      <div className="org-rules__block-hdr">
                        <Select
                          ariaLabel={`Subgroup ${idx + 1} combinator`}
                          value={it.op}
                          onChange={(v) => {
                            setCondItems((prev) =>
                              prev.map((x, i) =>
                                i === idx && x.kind === 'group'
                                  ? { ...x, op: v as 'AND' | 'OR' }
                                  : x,
                              ),
                            );
                            invalidatePreview();
                          }}
                          options={[
                            { value: 'AND', label: 'Subgroup AND' },
                            { value: 'OR', label: 'Subgroup OR' },
                          ]}
                        />
                        <div className="org-rules__inline">
                          <Button
                            size="sm"
                            onClick={() => {
                              setCondItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx && x.kind === 'group'
                                    ? { ...x, items: [...x.items, defaultLeaf()] }
                                    : x,
                                ),
                              );
                              invalidatePreview();
                            }}
                          >
                            + Leaf
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove subgroup ${idx + 1}`}
                            onClick={() => {
                              setCondItems((prev) => prev.filter((_, i) => i !== idx));
                              invalidatePreview();
                            }}
                          >
                            Remove group
                          </Button>
                        </div>
                      </div>
                      {it.items.map((leaf, sIdx) => (
                        <div key={`g-${idx}-${sIdx}`} className="org-rules__cond-row">
                          <Select
                            ariaLabel={`Subgroup ${idx + 1} condition ${sIdx + 1} field`}
                            value={leaf.field}
                            onChange={(v) => {
                              setCondItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx && x.kind === 'group'
                                    ? {
                                        ...x,
                                        items: x.items.map((l, j) =>
                                          j === sIdx ? { ...l, field: v } : l,
                                        ),
                                      }
                                    : x,
                                ),
                              );
                              invalidatePreview();
                            }}
                            options={CONDITION_FIELDS}
                          />
                          <Select
                            ariaLabel={`Subgroup ${idx + 1} condition ${sIdx + 1} operator`}
                            value={leaf.operator}
                            onChange={(v) => {
                              setCondItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx && x.kind === 'group'
                                    ? {
                                        ...x,
                                        items: x.items.map((l, j) =>
                                          j === sIdx ? { ...l, operator: v } : l,
                                        ),
                                      }
                                    : x,
                                ),
                              );
                              invalidatePreview();
                            }}
                            options={CONDITION_OPS}
                          />
                          <TextField
                            aria-label={`Subgroup ${idx + 1} condition ${sIdx + 1} value`}
                            list="org-rule-value-suggestions"
                            value={leaf.value}
                            error={Boolean(validationErrors[`cond-${idx}-${sIdx}`])}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCondItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx && x.kind === 'group'
                                    ? {
                                        ...x,
                                        items: x.items.map((l, j) =>
                                          j === sIdx ? { ...l, value: val } : l,
                                        ),
                                      }
                                    : x,
                                ),
                              );
                              invalidatePreview();
                            }}
                          />
                          {validationErrors[`cond-${idx}-${sIdx}`] && (
                            <Text size="sm" variant="danger">
                              {validationErrors[`cond-${idx}-${sIdx}`]}
                            </Text>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove subgroup ${idx + 1} condition ${sIdx + 1}`}
                            onClick={() => {
                              // Removing the last leaf removes the now-empty subgroup.
                              setCondItems((prev) =>
                                prev.flatMap((x, i) => {
                                  if (i !== idx || x.kind !== 'group') return [x];
                                  const items = x.items.filter((_, j) => j !== sIdx);
                                  return items.length > 0 ? [{ ...x, items }] : [];
                                }),
                              );
                              invalidatePreview();
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )
                }
              />
            </div>

            <div className="org-rules__block">
              <div className="org-rules__block-hdr">
                <Text size="sm">THEN Actions</Text>
                <Button
                  size="sm"
                  onClick={() => {
                    setActions((prev) => [...prev, defaultAction()]);
                    invalidatePreview();
                  }}
                >
                  + Action
                </Button>
              </div>

              {validationErrors.actions && (
                <Text size="sm" variant="danger" role="alert">
                  {validationErrors.actions}
                </Text>
              )}
              <SortableList
                ariaLabel="Actions"
                items={actions.map((act, idx) => ({ act, idx }))}
                getId={(x) => String(x.idx)}
                getLabel={(x) => `action ${x.idx + 1}`}
                onReorder={(ids) => {
                  setActions((prev) => ids.map((i) => prev[Number(i)]!));
                  invalidatePreview();
                }}
                renderItem={({ act, idx }) => {
                  const updateAct = (patch: Partial<RuleActionDraft>) => {
                    setActions((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                    invalidatePreview();
                  };
                  return (
                    <div key={`a-${idx}`} className="org-rules__action-card">
                      <div className="org-rules__action-row">
                        <Select
                          ariaLabel={`Action ${idx + 1} type`}
                          value={act.type}
                          onChange={(v) => updateAct({ type: v as RuleActionDraft['type'] })}
                          options={ACTION_TYPES}
                        />
                        <Select
                          ariaLabel={`Action ${idx + 1} target department`}
                          value={act.department}
                          onChange={(v) => updateAct({ department: v })}
                          options={[
                            { value: '', label: 'Any department' },
                            ...departments.map((d) => ({ value: d.name, label: d.name })),
                          ]}
                        />
                        <TextField
                          aria-label={`Action ${idx + 1} task name filter`}
                          placeholder="task_name or *"
                          value={act.task_name}
                          onChange={(e) => updateAct({ task_name: e.target.value })}
                        />
                      </div>

                      <div className="org-rules__action-row">
                        {act.type === 'assign' && (
                          <>
                            <Select
                              ariaLabel={`Action ${idx + 1} role`}
                              value={act.role}
                              onChange={(v) =>
                                updateAct({ role: v as 'artist' | 'lead' | 'supervisor' })
                              }
                              options={[
                                { value: 'artist', label: 'DO (artist)' },
                                { value: 'lead', label: 'LEAD' },
                                { value: 'supervisor', label: 'SUP' },
                              ]}
                            />
                            <Select
                              ariaLabel={`Action ${idx + 1} user`}
                              value={act.user_id}
                              onChange={(v) => updateAct({ user_id: v })}
                              options={[
                                { value: '', label: 'Select user…' },
                                ...users.map((u) => ({
                                  value: u.id,
                                  label: `${u.full_name} (@${u.username})`,
                                })),
                              ]}
                            />
                          </>
                        )}

                        {act.type === 'set_priority' && (
                          <Select
                            ariaLabel={`Action ${idx + 1} priority`}
                            value={act.priority}
                            onChange={(v) =>
                              updateAct({ priority: v as 'normal' | 'high' | 'stopper' })
                            }
                            options={[
                              { value: 'normal', label: 'normal' },
                              { value: 'high', label: 'high' },
                              { value: 'stopper', label: 'stopper' },
                            ]}
                          />
                        )}

                        {act.type === 'set_bid_hours' && (
                          <TextField
                            aria-label={`Action ${idx + 1} bid hours`}
                            type="number"
                            value={act.bid_hours}
                            onChange={(e) => updateAct({ bid_hours: e.target.value })}
                          />
                        )}

                        {act.type === 'set_review_flags' && (
                          <div className="org-rules__inline">
                            <Checkbox
                              label="Lead"
                              checked={act.needs_lead_review}
                              onChange={(v) => updateAct({ needs_lead_review: v })}
                            />
                            <Checkbox
                              label="Sup"
                              checked={act.needs_sup_review}
                              onChange={(v) => updateAct({ needs_sup_review: v })}
                            />
                            <Checkbox
                              label="Client"
                              checked={act.needs_client_review}
                              onChange={(v) => updateAct({ needs_client_review: v })}
                            />
                          </div>
                        )}

                        {act.type === 'set_ideal_dates' && (
                          <div className="org-rules__inline">
                            <TextField
                              aria-label="Start offset days"
                              type="number"
                              placeholder="offset d"
                              value={act.start_offset_days}
                              onChange={(e) => updateAct({ start_offset_days: e.target.value })}
                            />
                            <TextField
                              aria-label="Duration days"
                              type="number"
                              placeholder="duration d"
                              value={act.duration_days}
                              onChange={(e) => updateAct({ duration_days: e.target.value })}
                            />
                          </div>
                        )}

                        {act.type === 'add_tag' && (
                          <TextField
                            aria-label={`Action ${idx + 1} tag`}
                            placeholder="Tag name"
                            value={act.tag}
                            onChange={(e) => updateAct({ tag: e.target.value })}
                          />
                        )}

                        {act.type === 'add_dependency' && (
                          <>
                            <Select
                              ariaLabel="Dependency scope"
                              value={act.scope}
                              onChange={(v) =>
                                updateAct({ scope: v as 'same' | 'uses' | 'used_in' })
                              }
                              options={[
                                { value: 'same', label: 'same entity' },
                                { value: 'uses', label: 'uses entities' },
                                { value: 'used_in', label: 'used_in entities' },
                              ]}
                            />
                            <Select
                              ariaLabel="Upstream department"
                              value={act.upstream_department}
                              onChange={(v) => updateAct({ upstream_department: v })}
                              options={[
                                { value: '', label: 'Upstream dept…' },
                                ...departments.map((d) => ({ value: d.name, label: d.name })),
                              ]}
                            />
                            <Select
                              ariaLabel="Dependency threshold"
                              value={act.threshold}
                              onChange={(v) =>
                                updateAct({ threshold: v as 'APP' | 'PUBLISHED' | 'ANY_STATUS' })
                              }
                              options={[
                                { value: 'APP', label: 'APP' },
                                { value: 'PUBLISHED', label: 'PUBLISHED' },
                                { value: 'ANY_STATUS', label: 'ANY_STATUS' },
                              ]}
                            />
                          </>
                        )}

                        <Checkbox
                          label="Override manual"
                          checked={act.override_manual}
                          onChange={(v) => updateAct({ override_manual: v })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove action ${idx + 1}`}
                          onClick={() => {
                            setActions((prev) => prev.filter((_, i) => i !== idx));
                            invalidatePreview();
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      {validationErrors[`act-${idx}`] && (
                        <Text size="sm" variant="danger">
                          {validationErrors[`act-${idx}`]}
                        </Text>
                      )}
                    </div>
                  );
                }}
              />
            </div>

            <div className="org-rules__sentence" data-ui="rule-sentence">
              <Text size="sm" variant="mono">
                {liveSentence}
              </Text>
            </div>

            <div className="org-rules__toolbar">
              <Button size="sm" disabled={busy} onClick={() => void handlePreview()}>
                Preview matches
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleSave()}>
                Save Rule
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !previewMatchesCurrent}
                title={
                  previewMatchesCurrent
                    ? 'Apply rule to existing tasks'
                    : 'Run Preview matches before applying'
                }
                onClick={() => void handleApply()}
              >
                Apply to existing tasks
              </Button>
              {selectedRuleId && selectedRuleId !== '__new__' && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  Delete Rule
                </Button>
              )}
            </div>
          </Stack>
        </Panel>

        {preview && (
          <Panel
            title={`Preview Matches (${preview.matched_tasks} tasks, ${preview.changes?.length ?? 0} changes)`}
          >
            {(preview.changes ?? []).length === 0 ? (
              <Text size="sm" variant="muted">
                No changes predicted for existing tasks.
              </Text>
            ) : (
              <div className="org-admin-table-wrap">
                <table className="org-admin-matrix" aria-label="Rule preview matches">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Field</th>
                      <th>Old</th>
                      <th>New</th>
                      <th>Protection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.changes ?? []).map((c, idx) => (
                      <tr key={`${c.task_id}-${c.field}-${idx}`}>
                        <td className="org-admin-matrix__perm">{c.task_code}</td>
                        <td>{c.field}</td>
                        <td>{c.old_value ?? '—'}</td>
                        <td>{c.new_value ?? '—'}</td>
                        <td>
                          {c.skipped_manual ? (
                            <Badge tone="warning">manual protected</Badge>
                          ) : (
                            <Badge tone="success">will apply</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
