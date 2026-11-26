import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Banner, Button, Checkbox, Dialog, Select, Text, TextField } from '../../components/ui';
import { apiClient, type ConfoColumnOut } from '../../lib/api/client';
import { CONFO_TYPES, keyFromLabel } from './confoModel';

export interface ConfoColumnDraft {
  key: string;
  label: string;
  col_type: string;
  options: string[];
  default_text: string | null;
  validation: Record<string, unknown>;
  is_visible: boolean;
  edit_roles: string[];
}

/** Create or edit a Confo column definition. */
export function ConfoColumnDialog({
  open,
  onOpenChange,
  column,
  projectUuid,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  column: ConfoColumnOut | null;
  projectUuid: string | null;
  onSubmit: (draft: ConfoColumnDraft) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [colType, setColType] = useState('text');
  const [options, setOptions] = useState('');
  const [defaultText, setDefaultText] = useState('');
  const [required, setRequired] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [regex, setRegex] = useState('');
  const [maxLength, setMaxLength] = useState('');
  const [visible, setVisible] = useState(true);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ['admin-roles', projectUuid],
    queryFn: () => apiClient.listRoles(projectUuid),
    enabled: open && Boolean(projectUuid),
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const v = (column?.validation ?? {}) as Record<string, unknown>;
    setLabel(column?.label ?? '');
    setKey(column?.key ?? '');
    setKeyTouched(Boolean(column));
    setColType(column?.col_type ?? 'text');
    setOptions((column?.options ?? []).join(', '));
    setDefaultText(column?.default_text ?? '');
    setRequired(Boolean(v.required));
    setMin(v.min !== undefined && v.min !== null ? String(v.min) : '');
    setMax(v.max !== undefined && v.max !== null ? String(v.max) : '');
    setRegex(typeof v.regex === 'string' ? v.regex : '');
    setMaxLength(v.max_length ? String(v.max_length) : '');
    setVisible(column?.is_visible ?? true);
    setEditRoles(column?.edit_roles ?? []);
    setError(null);
  }, [open, column]);

  const isSelect = colType === 'select' || colType === 'multiselect';
  const isNumber = colType === 'integer' || colType === 'float';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const validation: Record<string, unknown> = {};
    if (required) validation.required = true;
    if (isNumber && min.trim()) validation.min = Number(min);
    if (isNumber && max.trim()) validation.max = Number(max);
    if (colType === 'text' && regex.trim()) validation.regex = regex.trim();
    if (colType === 'text' && maxLength.trim()) validation.max_length = Number(maxLength);
    if (Object.values(validation).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      setError('Min, max and max length must be numbers.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        key: key.trim(),
        label: label.trim(),
        col_type: colType,
        options: isSelect
          ? options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
        default_text: defaultText.trim() || null,
        validation,
        is_visible: visible,
        edit_roles: editRoles,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the column');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={column ? `Edit column "${column.label}"` : 'New Confo column'}
    >
      <form className="org-confo-form" onSubmit={(e) => void submit(e)} data-ui="confo-column-form">
        {error && <Banner severity="danger">{error}</Banner>}
        <label className="org-confo-field">
          <Text size="sm" variant="muted">
            Label
          </Text>
          <TextField
            aria-label="Column label"
            value={label}
            required
            onChange={(e) => {
              setLabel(e.target.value);
              if (!keyTouched) setKey(keyFromLabel(e.target.value));
            }}
          />
        </label>
        <label className="org-confo-field">
          <Text size="sm" variant="muted">
            Key (unique, used by imports)
          </Text>
          <TextField
            aria-label="Column key"
            value={key}
            required
            pattern="[a-z][a-z0-9_]{0,63}"
            title="Start with a letter; a-z, 0-9 and _ only"
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
          />
        </label>
        <label className="org-confo-field">
          <Text size="sm" variant="muted">
            Type
          </Text>
          <Select
            ariaLabel="Column type"
            value={colType}
            onChange={setColType}
            options={CONFO_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </label>
        {isSelect && (
          <label className="org-confo-field">
            <Text size="sm" variant="muted">
              Options (comma separated)
            </Text>
            <TextField
              aria-label="Column options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="static, pan, dolly"
            />
          </label>
        )}
        <label className="org-confo-field">
          <Text size="sm" variant="muted">
            Default value (optional)
          </Text>
          <TextField
            aria-label="Default value"
            value={defaultText}
            onChange={(e) => setDefaultText(e.target.value)}
          />
        </label>
        <div className="org-confo-inline">
          <Checkbox label="Required" checked={required} onChange={setRequired} />
          <Checkbox label="Visible by default" checked={visible} onChange={setVisible} />
        </div>
        {isNumber && (
          <div className="org-confo-inline">
            <TextField
              aria-label="Minimum"
              placeholder="min"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
            <TextField
              aria-label="Maximum"
              placeholder="max"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
        )}
        {colType === 'text' && (
          <div className="org-confo-inline">
            <TextField
              aria-label="Pattern"
              placeholder="pattern (regex, optional)"
              value={regex}
              onChange={(e) => setRegex(e.target.value)}
            />
            <TextField
              aria-label="Max length"
              placeholder="max length"
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
            />
          </div>
        )}
        {rolesQuery.data && (
          <fieldset className="org-confo-roles">
            <legend>
              <Text size="sm" variant="muted">
                Who may edit values (none ticked = anyone with confo.edit)
              </Text>
            </legend>
            {rolesQuery.data
              .filter((r) => r.name !== 'client')
              .map((r) => (
                <Checkbox
                  key={r.id}
                  label={r.label}
                  checked={editRoles.includes(r.name)}
                  onChange={(on) =>
                    setEditRoles((prev) =>
                      on ? [...prev, r.name] : prev.filter((x) => x !== r.name),
                    )
                  }
                />
              ))}
          </fieldset>
        )}
        <div className="org-confo-actions">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !label.trim() || !key.trim()}>
            {column ? 'Save column' : 'Create column'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
