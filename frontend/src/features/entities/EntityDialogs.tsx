import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Inline,
  Select,
  Stack,
  Text,
  TextArea,
  TextField,
} from '../../components/ui';
import type { DepartmentOut, EntityOut, LauncherOut } from '../../lib/api/client';
import './EntityDialogs.css';

export function sanitizePreview(raw: string): string {
  return raw
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function CreateEntityDialog({
  open,
  onOpenChange,
  parentFolder,
  departments,
  availableTypes,
  availableTags,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolder: string;
  departments: ReadonlyArray<DepartmentOut>;
  availableTypes: ReadonlyArray<string>;
  availableTags: ReadonlyArray<string>;
  onCreate: (payload: {
    name: string;
    parent_rel_path: string;
    entity_type: string | null;
    description: string | null;
    tags: string[];
    department_ids: string[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentFolder);
  const [entityType, setEntityType] = useState('');
  const [description, setDescription] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedDepts, setSelectedDepts] = useState<string[]>(() =>
    departments.filter((d) => d.is_active).map((d) => d.id),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setParent(parentFolder);
      setEntityType('');
      setDescription('');
      setTagDraft('');
      setTags([]);
      setSelectedDepts(departments.filter((d) => d.is_active).map((d) => d.id));
      setBusy(false);
    }
  }, [open, parentFolder, departments]);

  const addTag = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTags([...tags, clean]);
    }
    setTagDraft('');
  };

  const toggleDept = (id: string, checked: boolean) => {
    setSelectedDepts((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id),
    );
  };

  const safeFolder = sanitizePreview(name);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Entity"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!safeFolder || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate({
                  name: name.trim(),
                  parent_rel_path: parent.trim(),
                  entity_type: entityType.trim() ? entityType.trim() : null,
                  description: description.trim() ? description.trim() : null,
                  tags,
                  department_ids: selectedDepts,
                });
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-edialog">
        <div className="org-edialog__row">
          <Text size="sm">Name</Text>
          <TextField
            aria-label="Entity name"
            placeholder="Hero Robot"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {name.trim() !== '' && (
          <div className="org-edialog__row">
            <Text size="sm" variant="muted">
              Folder Preview
            </Text>
            <Text size="sm" variant="mono">
              {parent ? `${parent}/` : ''}
              {safeFolder || '(invalid)'}
            </Text>
          </div>
        )}
        <div className="org-edialog__row">
          <Text size="sm">Parent Folder</Text>
          <TextField
            aria-label="Parent folder"
            placeholder="(root of 01_Production)"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          />
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Type</Text>
          <div>
            <TextField
              aria-label="Entity type"
              list="org-entity-type-suggestions"
              placeholder="Optional (e.g. Character, Prop, Shot)"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            />
            <datalist id="org-entity-type-suggestions">
              {availableTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Tags</Text>
          <Stack gap="1">
            <Inline gap="1">
              <TextField
                aria-label="Add entity tag"
                list="org-entity-tag-suggestions"
                placeholder="Type tag & press Enter"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagDraft);
                  }
                }}
              />
              <datalist id="org-entity-tag-suggestions">
                {availableTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Button size="sm" onClick={() => addTag(tagDraft)}>
                Add
              </Button>
            </Inline>
            {tags.length > 0 && (
              <Inline gap="1" wrap>
                {tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}{' '}
                    <button
                      type="button"
                      className="org-edialog__tag-x"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </Inline>
            )}
          </Stack>
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Description</Text>
          <TextArea
            aria-label="Entity description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <Stack gap="1">
          <Text size="sm" variant="accent">
            Departments
          </Text>
          <div className="org-edialog__depts">
            {departments
              .filter((d) => d.is_active)
              .map((dept) => (
                <Checkbox
                  key={dept.id}
                  label={dept.name}
                  checked={selectedDepts.includes(dept.id)}
                  onChange={(checked) => toggleDept(dept.id, checked)}
                />
              ))}
          </div>
        </Stack>
      </Stack>
    </Dialog>
  );
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentFolder,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setBusy(false);
    }
  }, [open]);

  const safe = sanitizePreview(name);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Folder"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!safe || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate(name.trim());
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <Stack gap="2">
        <Text size="sm" variant="muted">
          Parent: 01_Production{parentFolder ? `/${parentFolder}` : ''}
        </Text>
        <TextField
          aria-label="Folder name"
          placeholder="characters"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {name.trim() !== '' && (
          <Text size="sm" variant="mono">
            Folder preview: {safe || '(invalid)'}
          </Text>
        )}
      </Stack>
    </Dialog>
  );
}

export function EditEntityDialog({
  open,
  onOpenChange,
  entity,
  availableTypes,
  availableTags,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: EntityOut | null;
  availableTypes: ReadonlyArray<string>;
  availableTags: ReadonlyArray<string>;
  onSave: (patch: {
    name: string;
    entity_type: string | null;
    description: string | null;
    tags: string[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (open && entity) {
      setName(entity.name);
      setEntityType(entity.entity_type ?? '');
      setDescription(entity.description ?? '');
      setTags(entity.tags ?? []);
      setTagDraft('');
    }
  }, [open, entity]);

  const addTag = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTags([...tags, clean]);
    }
    setTagDraft('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={entity ? `Edit Entity — ${entity.name}` : 'Edit Entity'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!sanitizePreview(name)}
            onClick={async () => {
              await onSave({
                name: name.trim(),
                entity_type: entityType.trim() ? entityType.trim() : null,
                description: description.trim() ? description.trim() : null,
                tags,
              });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-edialog">
        <div className="org-edialog__row">
          <Text size="sm">Name</Text>
          <TextField aria-label="Edit entity name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Type</Text>
          <div>
            <TextField
              aria-label="Edit entity type"
              list="org-edit-type-suggestions"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            />
            <datalist id="org-edit-type-suggestions">
              {availableTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Tags</Text>
          <Stack gap="1">
            <Inline gap="1">
              <TextField
                aria-label="Edit entity tag"
                list="org-edit-tag-suggestions"
                placeholder="Add tag..."
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagDraft);
                  }
                }}
              />
              <datalist id="org-edit-tag-suggestions">
                {availableTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Button size="sm" onClick={() => addTag(tagDraft)}>
                Add
              </Button>
            </Inline>
            <Inline gap="1" wrap>
              {tags.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}{' '}
                  <button
                    type="button"
                    className="org-edialog__tag-x"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </Inline>
          </Stack>
        </div>
        <div className="org-edialog__row">
          <Text size="sm">Description</Text>
          <TextArea
            aria-label="Edit entity description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
      </Stack>
    </Dialog>
  );
}

export function PublishDialog({
  open,
  onOpenChange,
  fileLabels,
  isFirstVersion,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileLabels: ReadonlyArray<string>;
  isFirstVersion: boolean;
  onPublish: (comment: string, setMaster: boolean) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const [setMaster, setSetMaster] = useState(isFirstVersion);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setComment('');
      setSetMaster(isFirstVersion);
      setBusy(false);
    }
  }, [open, isFirstVersion]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Publish to Product Version"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={fileLabels.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPublish(comment, setMaster);
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish
          </Button>
        </>
      }
    >
      <Stack gap="2">
        <Text size="sm">
          Copies selected files into the next immutable <Text variant="mono">products/vNNNN/</Text> folder (originals remain untouched):
        </Text>
        <div className="org-edialog__filelist">
          {fileLabels.map((lbl) => (
            <Text key={lbl} size="sm" variant="mono">
              • {lbl}
            </Text>
          ))}
        </div>
        <TextField
          aria-label="Publish comment"
          placeholder="Publish comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Checkbox
          label="Star as MASTER version"
          checked={setMaster}
          onChange={setSetMaster}
        />
      </Stack>
    </Dialog>
  );
}

export function ConfirmTrashDialog({
  open,
  onOpenChange,
  title,
  message,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Move to Trash
          </Button>
        </>
      }
    >
      <Text size="sm">{message}</Text>
    </Dialog>
  );
}

export function PromptNameDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = '',
  confirmLabel = 'Confirm',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!value.trim()}
            onClick={async () => {
              await onConfirm(value.trim());
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Stack gap="1">
        <Text size="sm">{label}</Text>
        <TextField
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && value.trim()) {
              await onConfirm(value.trim());
              onOpenChange(false);
            }
          }}
        />
      </Stack>
    </Dialog>
  );
}

export function OpenWithDialog({
  open,
  onOpenChange,
  targetLabel,
  launchers,
  onLaunch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetLabel: string;
  launchers: ReadonlyArray<LauncherOut>;
  onLaunch: (launcherId: string | null) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelectedId(launchers[0]?.id ?? '__os__');
    }
  }, [open, launchers]);

  const options = [
    ...launchers.map((l) => ({
      value: l.id,
      label: `${l.label} (${l.extension})`,
    })),
    { value: '__os__', label: 'OS Default Application' },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open With..."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await onLaunch(selectedId === '__os__' ? null : selectedId);
              onOpenChange(false);
            }}
          >
            Launch
          </Button>
        </>
      }
    >
      <Stack gap="2">
        <Text size="sm" variant="mono">
          Target: {targetLabel}
        </Text>
        <Select
          ariaLabel="Choose application launcher"
          options={options}
          value={selectedId}
          onChange={setSelectedId}
          filterable={false}
        />
        <Text size="sm" variant="muted">
          Executed by local backend (loopback only; browsers block direct file:// launches).
        </Text>
      </Stack>
    </Dialog>
  );
}

