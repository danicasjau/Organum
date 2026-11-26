import { useState } from 'react';
import {
  Avatar,
  Button,
  ButtonGroup,
  Grid,
  Icon,
  ICON_NAMES,
  Inline,
  Panel,
  PriorityFlag,
  PRIORITY_LEVELS,
  PrioritySegmented,
  ReviewPanel,
  SegmentedControl,
  Stack,
  StatusChip,
  StatusDot,
  Switch,
  Table,
  Tag,
  Text,
  UserPicker,
  type PriorityLevel,
  type ReviewThreadItem,
  type TableColumn,
} from '../components/ui';
import './GalleryV1.css';

/* ------------------------------------------------------------------------ */
/* Foundations                                                               */
/* ------------------------------------------------------------------------ */

const ELEVATIONS = [
  { cls: 'org-elev-1', name: 'L1 flat', note: 'panel bg, 1px border, no shadow' },
  { cls: 'org-elev-2', name: 'L2 hover', note: '--hover bg, 1px 2px 3px drop' },
  { cls: 'org-elev-3', name: 'L3 raised', note: 'RAISED recipe' },
  { cls: 'org-elev-4', name: 'L4 modal', note: 'panel bg, 3px radius, 0 8px 24px' },
  { cls: 'org-elev-5', name: 'L5 popover', note: 'raised bg, 3px radius, 0 12px 30px' },
] as const;

const SURFACES = [
  { cls: 'org-surface-base', name: 'BASE', note: 'flat' },
  { cls: 'org-surface-raised', name: 'RAISED', note: 'keys, cards, thumbs' },
  { cls: 'org-surface-inset', name: 'INSET', note: 'fields, wells, troughs' },
  { cls: 'org-surface-pressed', name: 'PRESSED', note: 'active key sinks 1px' },
  { cls: 'org-surface-plate', name: 'PLATE', note: 'panels' },
] as const;

const SWATCH_GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<[string, string]> }> = [
  {
    title: 'Zones',
    items: [
      ['Management', '--zone-management'],
      ['Production', '--zone-production'],
      ['Settings', '--zone-settings'],
      ['Focus / active', '--zone-focus'],
    ],
  },
  {
    title: 'Status',
    items: [
      ['WIP', '--st-wip'],
      ['Pending review', '--st-review'],
      ['Approved', '--st-approved'],
      ['Rejected', '--st-rejected'],
      ['Idle / waiting', '--st-idle'],
    ],
  },
  {
    title: 'Priority',
    items: [
      ['Low', '--prio-low'],
      ['Normal', '--prio-normal'],
      ['High', '--prio-high'],
      ['Urgent', '--prio-urgent'],
      ['Critical', '--prio-critical'],
    ],
  },
  {
    title: 'Departments',
    items: [
      ['Modeling', '--dept-modeling'],
      ['Rigging', '--dept-rigging'],
      ['Animation', '--dept-animation'],
      ['Lookdev', '--dept-lookdev'],
      ['Lighting', '--dept-lighting'],
      ['FX', '--dept-fx'],
      ['Comp', '--dept-comp'],
    ],
  },
  {
    title: 'Surfaces',
    items: [
      ['Canvas', '--bg-canvas'],
      ['App', '--bg-app'],
      ['Panel', '--bg-panel'],
      ['Raised', '--bg-raised-top'],
      ['Input', '--bg-input'],
      ['Border', '--border'],
      ['Hover', '--hover'],
      ['Selected', '--selected'],
    ],
  },
];

export function FoundationsSection() {
  return (
    <Panel title="Foundations" collapsible>
      <Stack gap="6">
        <div className="org-gx__block">
          <span className="org-section-label">Surface system — light from the top-left</span>
          <div className="org-gx__row">
            {SURFACES.map((s) => (
              <div key={s.cls} className="org-gx__specimen">
                <div className={`org-gx__swatch-lg ${s.cls}`} />
                <span className="org-gx__name">{s.name}</span>
                <span className="org-gx__note">{s.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="org-gx__block">
          <span className="org-section-label">Elevation levels</span>
          <div className="org-gx__row">
            {ELEVATIONS.map((e) => (
              <div key={e.cls} className="org-gx__specimen">
                <div className={`org-gx__swatch-lg ${e.cls}`} />
                <span className="org-gx__name">{e.name}</span>
                <span className="org-gx__note">{e.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="org-gx__block">
          <span className="org-section-label">
            Radius 0 / 1 / 2 / 3 · Borders 1 / 2 / 4 · Groove separator
          </span>
          <div className="org-gx__row">
            {(['0', '1', '2', '3'] as const).map((r) => (
              <div key={r} className="org-gx__specimen">
                <div className="org-gx__radius org-surface-raised" data-r={r} />
                <span className="org-gx__name org-tabular">{r}px</span>
              </div>
            ))}
            {(['1', '2', '4'] as const).map((b) => (
              <div key={`b${b}`} className="org-gx__specimen">
                <div className="org-gx__border" data-b={b} />
                <span className="org-gx__name org-tabular">{b}px</span>
              </div>
            ))}
            <div className="org-gx__specimen org-gx__specimen--wide">
              <hr className="org-groove" />
              <span className="org-gx__name">2px groove</span>
            </div>
          </div>
        </div>

        <div className="org-gx__block">
          <span className="org-section-label">Typography — tone, not size</span>
          <Stack gap="2">
            <span className="org-page-title">Shot review — EP104_SQ030</span>
            <Inline gap="5" align="center" wrap>
              <Text>Text — Inter 12/400</Text>
              <Text variant="muted">Text dim</Text>
              <span className="org-gx__off">Text off</span>
              <span className="org-section-label">Etched panel label</span>
              <span className="org-tabular">v012 · 1001–1048 · 00:00:41:12</span>
            </Inline>
          </Stack>
        </div>

        <div className="org-gx__block">
          <span className="org-section-label">Palette (hues identical in Dark and Paper)</span>
          <Stack gap="3">
            {SWATCH_GROUPS.map((g) => (
              <div key={g.title} className="org-gx__swatch-row">
                <span className="org-gx__swatch-title">{g.title}</span>
                {g.items.map(([label, token]) => (
                  <span key={token} className="org-gx__chip">
                    <span className="org-gx__dot" data-token={token} />
                    <span>{label}</span>
                    <span className="org-gx__token">{token}</span>
                  </span>
                ))}
              </div>
            ))}
          </Stack>
        </div>
      </Stack>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Buttons (all variants and states)                                         */
/* ------------------------------------------------------------------------ */

export function ButtonsSpecimen() {
  const [sw, setSw] = useState(true);
  return (
    <Stack gap="4">
      <Inline gap="2" wrap align="center">
        <Button>Default</Button>
        <Button forceState="hover">Hover</Button>
        <Button forceState="pressed">Pressed</Button>
        <Button forceState="focus">Focus</Button>
        <Button disabled>Disabled</Button>
        <Button variant="sunk">Sunk</Button>
        <Button error>Error</Button>
      </Inline>
      <Inline gap="2" wrap align="center">
        <Button variant="production">Production</Button>
        <Button variant="management">Management</Button>
        <Button variant="settings">Settings</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="send" iconLeft={<Icon name="send" size="md" />}>
          Send
        </Button>
        <Button iconLeft={<Icon name="paperclip" size="md" />}>Icon + label</Button>
      </Inline>
      <Inline gap="5" wrap align="center">
        <ButtonGroup>
          <Button>Fit</Button>
          <Button pressed>100%</Button>
          <Button>800%</Button>
        </ButtonGroup>
        <SegmentedControl
          ariaLabel="Segmented demo"
          value="shots"
          onChange={() => {}}
          options={[
            { value: 'assets', label: 'Assets' },
            { value: 'shots', label: 'Shots' },
            { value: 'sequences', label: 'Sequences' },
          ]}
        />
        <Switch label="Live sync" checked={sw} onChange={setSw} />
        <Switch label="Off" checked={false} onChange={() => {}} />
        <Switch label="Disabled" checked disabled onChange={() => {}} />
      </Inline>
    </Stack>
  );
}

/* ------------------------------------------------------------------------ */
/* Icons                                                                     */
/* ------------------------------------------------------------------------ */

export function IconsSection() {
  const [pressed, setPressed] = useState<string>('sliders');
  return (
    <Panel title="Icons" collapsible>
      <Stack gap="5">
        <Inline gap="5" align="center" wrap>
          <span className="org-section-label">Tile sizes</span>
          <button type="button" className="org-icon-tile" data-size="sm" aria-label="Compact tile">
            <Icon name="film" size="lg" />
          </button>
          <button type="button" className="org-icon-tile" aria-label="Default tile">
            <Icon name="film" size="lg" />
          </button>
          <button type="button" className="org-icon-tile" data-size="lg" aria-label="Large tile">
            <Icon name="film" size="lg" />
          </button>
          <Text size="sm" variant="muted">
            28 / 32 / 40 px, exactly square, radius 1px, 18px glyph
          </Text>
          <span className="org-section-label">Inline 16px</span>
          <Inline gap="2" align="center">
            <Icon name="calendar" />
            <Icon name="clock" />
            <Icon name="mail" />
            <Icon name="bell" />
          </Inline>
        </Inline>
        <div className="org-gx__icon-grid" role="list" aria-label="Icon set">
          {ICON_NAMES.map((n) => (
            <div key={n} className="org-gx__icon-cell" role="listitem">
              <button
                type="button"
                className="org-icon-tile"
                aria-label={n}
                aria-pressed={pressed === n}
                onClick={() => setPressed(n)}
              >
                <Icon name={n} size="lg" />
              </button>
              <span className="org-gx__icon-name">{n}</span>
            </div>
          ))}
        </div>
      </Stack>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Users                                                                     */
/* ------------------------------------------------------------------------ */

const TEAM = [
  {
    id: 'u1',
    username: 'art_sam',
    fullName: 'Sam Rivera',
    roleLabel: 'Animator',
    dept: 'animation',
    presence: 'online',
  },
  {
    id: 'u2',
    username: 'dir_alex',
    fullName: 'Alex Vance',
    roleLabel: 'Director',
    dept: 'comp',
    presence: 'away',
  },
  {
    id: 'u3',
    username: 'lead_mei',
    fullName: 'Mei Tanaka',
    roleLabel: 'Lighting lead',
    dept: 'lighting',
    presence: 'online',
  },
  {
    id: 'u4',
    username: 'fx_omar',
    fullName: 'Omar Haddad',
    roleLabel: 'FX artist',
    dept: 'fx',
    presence: 'offline',
  },
  {
    id: 'u5',
    username: 'rig_ines',
    fullName: 'Inés Ortega',
    roleLabel: 'Rigger',
    dept: 'rigging',
    presence: 'online',
  },
] as const;

export function UsersSection() {
  const [picked, setPicked] = useState<string[]>(['u1', 'u3']);
  const [selected, setSelected] = useState('u3');
  const [menuOpen, setMenuOpen] = useState(true);
  const lead = TEAM[2];
  return (
    <Panel title="Users" collapsible>
      <Stack gap="6">
        <div className="org-gx__block">
          <span className="org-section-label">
            Square avatars 20 / 24 / 32 / 40 / 56 / 72 · presence LED
          </span>
          <Inline gap="5" align="end" wrap>
            {([20, 24, 32, 40, 56, 72] as const).map((sz, i) => (
              <Stack key={sz} gap="1" align="center">
                <Avatar
                  username={TEAM[i % TEAM.length]!.username}
                  fullName={TEAM[i % TEAM.length]!.fullName}
                  size={sz}
                  presence={(['online', 'away', 'offline'] as const)[i % 3]}
                />
                <span className="org-gx__note org-tabular">{sz}</span>
              </Stack>
            ))}
          </Inline>
        </div>

        <Grid columns={3} gap="4">
          <div className="org-gx__block">
            <span className="org-section-label">Team list</span>
            <div className="org-gx__team" role="listbox" aria-label="Team">
              {TEAM.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={selected === u.id}
                  className="org-gx__team-row"
                  data-selected={selected === u.id ? 'true' : undefined}
                  onClick={() => setSelected(u.id)}
                >
                  <Avatar
                    username={u.username}
                    fullName={u.fullName}
                    size={32}
                    presence={u.presence}
                  />
                  <span className="org-gx__team-meta">
                    <span className="org-gx__team-name">{u.fullName}</span>
                    <span className="org-gx__team-role">{u.roleLabel}</span>
                  </span>
                  <span className="org-gx__dept-dot" data-dept={u.dept} title={u.dept} />
                </button>
              ))}
            </div>
          </div>

          <div className="org-gx__block">
            <span className="org-section-label">Profile card</span>
            <div className="org-gx__profile org-surface-raised">
              <div className="org-gx__profile-head">
                <Avatar
                  username={lead.username}
                  fullName={lead.fullName}
                  size={72}
                  presence="online"
                />
                <div className="org-gx__profile-id">
                  <span className="org-gx__profile-name">{lead.fullName}</span>
                  <span className="org-gx__team-role">{lead.roleLabel}</span>
                  <span className="org-gx__profile-dept">
                    <span className="org-gx__dept-dot" data-dept="lighting" />
                    Lighting
                  </span>
                  <span className="org-gx__profile-mail">
                    <Icon name="mail" size="sm" />
                    mei.tanaka@studio.local
                  </span>
                </div>
              </div>
              <div className="org-gx__stats">
                {(
                  [
                    ['Open', 12],
                    ['In review', 4],
                    ['Done', 87],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="org-gx__stat">
                    <span className="org-section-label">{k}</span>
                    <span className="org-gx__stat-val">{v}</span>
                  </div>
                ))}
              </div>
              <Inline gap="2">
                <Button variant="production" iconLeft={<Icon name="comment" size="md" />}>
                  Message
                </Button>
                <Button iconLeft={<Icon name="user" size="md" />}>Assign</Button>
              </Inline>
            </div>
          </div>

          <div className="org-gx__block">
            <span className="org-section-label">UserPicker (radius 0)</span>
            <UserPicker
              users={TEAM.map((u) => ({
                id: u.id,
                username: u.username,
                fullName: u.fullName,
                roleLabel: u.roleLabel,
              }))}
              selectedIds={picked}
              onChange={setPicked}
            />
            <span className="org-section-label">Topbar user menu</span>
            <div className="org-gx__usermenu">
              <button
                type="button"
                className="org-usermenu__trigger"
                data-state={menuOpen ? 'open' : 'closed'}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <Avatar username={lead.username} fullName={lead.fullName} size={24} />
                <span className="org-usermenu__name">{lead.fullName}</span>
                <Icon name="chevron-down" size="sm" />
              </button>
              {menuOpen && (
                <div className="org-menu__content org-usermenu__content org-gx__static-menu">
                  <div className="org-usermenu__header">
                    <Avatar username={lead.username} fullName={lead.fullName} size={40} />
                    <div className="org-usermenu__who">
                      <span className="org-usermenu__who-name">{lead.fullName}</span>
                      <span className="org-usermenu__who-role">{lead.roleLabel}</span>
                    </div>
                    <StatusDot tone="success" label="Online" />
                  </div>
                  <div className="org-menu__sep" />
                  {(
                    [
                      ['user', 'My profile'],
                      ['bell', 'Notifications'],
                      ['sliders', 'Preferences'],
                      ['log-out', 'Sign out'],
                    ] as const
                  ).map(([icon, label]) => (
                    <div
                      key={label}
                      className="org-menu__item"
                      data-highlighted={label === 'My profile' ? '' : undefined}
                    >
                      <span className="org-menu__label">
                        <Icon name={icon} size="md" />
                        <span>{label}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Grid>
      </Stack>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Priority                                                                  */
/* ------------------------------------------------------------------------ */

const PRIORITY_TABLE_COLS: TableColumn[] = [
  { key: 'priority', header: 'Priority' },
  { key: 'shot', header: 'Shot', mono: true },
  { key: 'task', header: 'Task' },
  { key: 'status', header: 'Status' },
  { key: 'version', header: 'Version', mono: true },
];

const PRIORITY_ROWS = [
  {
    p: 'critical',
    shot: 'EP104_SQ030_SH0040',
    task: 'FX — debris sim',
    status: 'RTK',
    version: 'v007',
  },
  {
    p: 'urgent',
    shot: 'EP104_SQ030_SH0050',
    task: 'Lighting — key pass',
    status: 'P_SUP',
    version: 'v012',
  },
  {
    p: 'high',
    shot: 'EP104_SQ030_SH0060',
    task: 'Animation — blocking',
    status: 'IP',
    version: 'v003',
  },
  {
    p: 'normal',
    shot: 'EP104_SQ030_SH0070',
    task: 'Comp — slap comp',
    status: 'APP',
    version: 'v021',
  },
  { p: 'low', shot: 'EP104_SQ030_SH0080', task: 'Layout — camera', status: 'WTG', version: 'v001' },
] as const;

export function PrioritySection() {
  const [prio, setPrio] = useState<PriorityLevel>('high');
  return (
    <Panel title="Priority" collapsible>
      <Stack gap="5">
        <Inline gap="5" align="center" wrap>
          {PRIORITY_LEVELS.map((l) => (
            <PriorityFlag key={l} priority={l} />
          ))}
        </Inline>
        <Inline gap="2" align="center" wrap>
          {PRIORITY_LEVELS.map((l) => (
            <Tag key={l} priority={l} />
          ))}
        </Inline>
        <Inline gap="4" align="center" wrap>
          <span className="org-section-label">Priority</span>
          <PrioritySegmented value={prio} onChange={setPrio} />
        </Inline>
        <Table
          columns={PRIORITY_TABLE_COLS}
          rowStatus={(_row, i) => PRIORITY_ROWS[i]?.status}
          selectedIndex={2}
          rows={PRIORITY_ROWS.map((r) => ({
            priority: <PriorityFlag priority={r.p} />,
            shot: r.shot,
            task: r.task,
            status: <StatusChip status={r.status} compact />,
            version: r.version,
          }))}
        />
        <Text size="sm" variant="muted">
          Priority is always flag + label and lives in the first column (86px). The 3px left bar
          stays reserved for status.
        </Text>
      </Stack>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Review (v2 behaviour, local demo state)                                   */
/* ------------------------------------------------------------------------ */

const REVIEW_STATUS: Record<string, string> = {
  approve: 'APP',
  changes: 'IP',
  reject: 'RTK',
  hold: 'HLD',
};

function nowLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ReviewSection() {
  const [title, setTitle] = useState('EP104_SQ030_SH0040');
  const [subtitle, setSubtitle] = useState('FX — debris simulation, take 3');
  const [priority, setPriority] = useState<PriorityLevel>('high');
  const [status, setStatus] = useState('P_LEAD');
  const [statusLabel, setStatusLabel] = useState('Pending review');
  const [notes, setNotes] = useState('');
  const [viewed, setViewed] = useState(false);
  const [thread, setThread] = useState<ReviewThreadItem[]>([
    {
      key: 'c1',
      author: { username: 'dir_alex', fullName: 'Alex Vance' },
      role: 'Director',
      time: '09:12',
      tag: 'changes',
      body: 'Debris reads too uniform on frame 1032 — add a few larger chunks in the foreground.',
    },
    {
      key: 'c2',
      author: { username: 'fx_omar', fullName: 'Omar Haddad' },
      role: 'FX artist',
      time: '11:40',
      tag: 'sent',
      body: 'v007 up with bigger chunks and a slower settle. Ready for another look.',
    },
  ]);

  const append = (tag: 'sent' | 'comment') => {
    const body = notes.trim();
    if (!body) return;
    setThread((t) => [
      ...t,
      {
        key: `n${t.length + 1}`,
        author: { username: 'lead_mei', fullName: 'Mei Tanaka' },
        role: 'Lighting lead',
        time: nowLabel(),
        tag,
        body,
      },
    ]);
    setNotes('');
  };

  const setReview = (kind: 'approve' | 'changes' | 'reject' | 'hold') => () => {
    setStatus(REVIEW_STATUS[kind]!);
    setStatusLabel(
      kind === 'approve'
        ? 'Approved'
        : kind === 'changes'
          ? 'Changes requested'
          : kind === 'reject'
            ? 'Rejected'
            : 'On hold',
    );
  };

  return (
    <Panel
      title="Review"
      collapsible
      headerRight={
        <Inline gap="2" align="center">
          <Tag tone={viewed ? 'success' : 'neutral'}>{viewed ? 'Viewed' : 'Not viewed'}</Tag>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStatus('P_LEAD');
              setStatusLabel('Pending review');
            }}
          >
            Reset status
          </Button>
        </Inline>
      }
    >
      <ReviewPanel
        title={title}
        subtitle={subtitle}
        status={status}
        statusText={statusLabel}
        priority={priority}
        dueDate="2026-12-04"
        version="v007"
        submitter={{ username: 'fx_omar', fullName: 'Omar Haddad' }}
        onTitleChange={setTitle}
        onSubtitleChange={setSubtitle}
        onPriorityChange={setPriority}
        thread={thread}
        notes={notes}
        onNotesChange={setNotes}
        onSend={() => append('sent')}
        onComment={() => append('comment')}
        onAttach={(files) =>
          setNotes((n) => `${n}${n ? '\n' : ''}[attached ${files.map((f) => f.name).join(', ')}]`)
        }
        onMarkViewed={() => setViewed(true)}
        approve={{ onClick: setReview('approve') }}
        requestChanges={{ onClick: setReview('changes') }}
        reject={{ onClick: setReview('reject') }}
        hold={{ onClick: setReview('hold') }}
      />
    </Panel>
  );
}
