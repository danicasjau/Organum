import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DensityMode, ThemeMode } from '../app/App';
import {
  ButtonsSpecimen,
  FoundationsSection,
  IconsSection,
  PrioritySection,
  ReviewSection,
  UsersSection,
} from './GalleryV1';
import {
  AngleDial,
  Avatar,
  Badge,
  Banner,
  BarChart,
  BrandWordmark,
  Button,
  ButtonGroup,
  CapacityBadge,
  Checkbox,
  ColorField,
  ContextMenu,
  CurveRamp,
  DataGrid,
  Dialog,
  GaugeBar,
  Grid,
  Heatmap,
  Histogram,
  Icon,
  Inline,
  JobQueue,
  Kbd,
  Knob,
  LineChart,
  LogConsole,
  MenuBar,
  NodeGraph,
  NumberField,
  Panel,
  PasswordField,
  Popover,
  ProgressBar,
  PropertyEditor,
  RadioGroup,
  RadioItem,
  RangeSlider,
  ScatterPlot,
  ScrollArea,
  SearchField,
  SegmentedControl,
  Select,
  Separator,
  Slider,
  Sparkline,
  Spinner,
  Stack,
  StatusBar,
  StatusBarSegment,
  StatusDot,
  Stepper,
  Switch,
  Table,
  Tabs,
  Tag,
  Text,
  TextArea,
  TextField,
  Timebar,
  TokenTile,
  ToolStrip,
  Toolbar,
  ToolbarGroup,
  Tooltip,
  Topbar,
  TransportControls,
  UserPicker,
  VectorField,
  useToast,
  type CurvePoint,
  type DataGridColumn,
  type MenuBarMenu,
  type PropertyGroupDef,
  type SelectOption,
  type TableColumn,
} from '../components/ui';

export interface GalleryPageProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  density: DensityMode;
  onToggleDensity: () => void;
  redline: boolean;
  onToggleRedline: () => void;
}

const COLORSPACE_OPTS: SelectOption[] = [
  { value: 'srgb', label: 'sRGB' },
  { value: 'linear_srgb', label: 'Linear sRGB' },
  { value: 'acescg', label: 'ACEScg' },
  { value: 'rec709', label: 'Rec.709' },
  { value: 'raw', label: 'Raw' },
];

const MATRIX_COLS: TableColumn[] = [
  { key: 'control', header: 'Control' },
  { key: 'normal', header: 'Normal' },
  { key: 'hover', header: 'Hover' },
  { key: 'pressed', header: 'Pressed' },
  { key: 'focus', header: 'Focus' },
  { key: 'disabled', header: 'Disabled' },
  { key: 'error', header: 'Error' },
  { key: 'dirty', header: 'Dirty' },
];

const SPACING_COLS: TableColumn[] = [
  { key: 'element', header: 'Element' },
  { key: 'token', header: 'Token', mono: true },
  { key: 'value', header: 'Value (Compact)', mono: true },
  { key: 'rule', header: 'Rule' },
];

const SPACING_ROWS = [
  {
    element: 'Page wrapper',
    token: '--page-max-w / --page-pad-x',
    value: '1360px / 32px',
    rule: 'Form-like pages; workspaces stay full-bleed',
  },
  {
    element: 'Panel (Plate) padding',
    token: '--panel-pad',
    value: '20px',
    rule: 'Etched header, groove 10px top / 18px bottom',
  },
  {
    element: 'Gap between panels',
    token: '--panel-gap',
    value: '24px',
    rule: 'Also between sections',
  },
  {
    element: 'Control height',
    token: '--ctl-h',
    value: '28px',
    rule: 'Buttons, fields, tabs, selects',
  },
  {
    element: 'Button padding',
    token: '--space-btn-x',
    value: '0 14px',
    rule: '8–12px between controls, 24px between groups',
  },
  {
    element: 'Table header / rows',
    token: '--header-h / --row-h',
    value: '26px / 26px',
    rule: '14px left, 10px right cell padding',
  },
  {
    element: 'Icon tiles',
    token: '--icon-tile(-sm/-lg)',
    value: '32 / 28 / 40px',
    rule: 'Exactly square, radius ≤ 1px, 18px glyph',
  },
  {
    element: 'Radius scale',
    token: '--radius-xs/sm/md',
    value: '1 / 2 / 3px',
    rule: 'Controls 2px, popovers 3px, knobs and LEDs round',
  },
  {
    element: 'Motion',
    token: '--motion-fast/switch/popover',
    value: '120 / 140 / 180ms',
    rule: 'ease-out, no bounce; zeroed for reduced motion',
  },
];

export function GalleryPage({
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  redline,
  onToggleRedline,
}: GalleryPageProps) {
  const navigate = useNavigate();
  const toast = useToast();

  // Interactive numeric & property state
  const [exposure, setExposure] = useState(0.5);
  const [gamma, setGamma] = useState(1.0);
  const [samples, setSamples] = useState(32);
  const [frameRange, setFrameRange] = useState<[number, number]>([1001, 1048]);
  const [translate, setTranslate] = useState([0.0, 1.25, -0.5]);
  const [tint, setTint] = useState<[number, number, number, number]>([0.55, 0.36, 0.96, 1.0]);
  const [angle, setAngle] = useState(45.0);
  const [knobVal, setKnobVal] = useState(65);
  const [stepVal, setStepVal] = useState(4);
  const [curve, setCurve] = useState<CurvePoint[]>([
    { x: 0, y: 0 },
    { x: 0.35, y: 0.25 },
    { x: 0.7, y: 0.85 },
    { x: 1, y: 1 },
  ]);
  const [activeTab, setActiveTab] = useState('controls');
  const [segMode, setSegMode] = useState<'rgb' | 'alpha' | 'luma'>('rgb');
  const [activeTool, setActiveTool] = useState('pan');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notes, setNotes] = useState('Check specular rim highlight on hero_robot v001.');
  const [apiToken, setApiToken] = useState('org_dev_token');
  const [colorspace, setColorspace] = useState('acescg');
  const [checkVal, setCheckVal] = useState(true);
  const [radioVal, setRadioVal] = useState('2d');
  const [switchVal, setSwitchVal] = useState(true);
  const [searchDemo, setSearchDemo] = useState('');
  const [gridRows, setGridRows] = useState<Array<Record<string, unknown>>>([
    { frame: 1001, render_ms: 142.5, vram_mb: 512.0, pass: 'beauty', status: 'ok' },
    { frame: 1002, render_ms: 139.8, vram_mb: 514.2, pass: 'beauty', status: 'ok' },
    { frame: 1003, render_ms: 151.1, vram_mb: 518.9, pass: 'specular', status: 'warn' },
    { frame: 1004, render_ms: 136.4, vram_mb: 510.6, pass: 'diffuse', status: 'ok' },
  ]);
  const [galleryFrame, setGalleryFrame] = useState(12);
  const [galleryPlaying, setGalleryPlaying] = useState(false);
  const [pickedUsers, setPickedUsers] = useState<string[]>(['u1']);

  const menus: MenuBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        {
          id: 'viewer',
          label: 'Open /viewer (Phase 2)',
          shortcut: 'Ctrl+1',
          onSelect: () => navigate('/viewer'),
        },
        { id: 'sep1', label: '', separator: true },
        {
          id: 'toast',
          label: 'Trigger Status Toast',
          shortcut: 'Ctrl+T',
          onSelect: () => toast.push('success', 'Gallery action triggered'),
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          id: 'theme',
          label: `Switch to ${theme === 'dark' ? 'Paper' : 'Dark'} Theme`,
          shortcut: 'T',
          onSelect: onToggleTheme,
        },
        {
          id: 'density',
          label: `Density: ${density === 'compact' ? 'Comfortable' : 'Compact'}`,
          shortcut: 'D',
          onSelect: onToggleDensity,
        },
        {
          id: 'redline',
          label: `${redline ? 'Hide' : 'Show'} Redline Overlay`,
          shortcut: 'R',
          onSelect: onToggleRedline,
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        {
          id: 'about',
          label: 'About ORGANUM UI',
          shortcut: 'F1',
          onSelect: () => setDialogOpen(true),
        },
      ],
    },
  ];

  const propertyGroups: PropertyGroupDef[] = useMemo(
    () => [
      {
        id: 'color',
        title: 'Color & Exposure',
        defaultOpen: true,
        items: [
          {
            id: 'colorspace',
            label: 'Input Space',
            dirty: colorspace !== 'srgb',
            onReset: () => setColorspace('srgb'),
            render: () => (
              <Select
                options={COLORSPACE_OPTS}
                value={colorspace}
                dirty={colorspace !== 'srgb'}
                onChange={setColorspace}
              />
            ),
          },
          {
            id: 'exposure',
            label: 'Exposure',
            dirty: exposure !== 0,
            onReset: () => setExposure(0),
            render: () => (
              <Slider
                value={exposure}
                baselineValue={0}
                onChange={setExposure}
                min={-6}
                max={6}
                step={0.1}
                precision={2}
                unit="EV"
                showTicks
                ariaLabel="Exposure stops"
              />
            ),
          },
          {
            id: 'gamma',
            label: 'Gamma (Log)',
            dirty: gamma !== 1.0,
            onReset: () => setGamma(1.0),
            render: () => (
              <Slider
                value={gamma}
                baselineValue={1.0}
                onChange={setGamma}
                min={0.2}
                max={4.0}
                step={0.05}
                precision={2}
                logarithmic
                ariaLabel="Gamma"
              />
            ),
          },
          {
            id: 'tint',
            label: 'Tint RGBA',
            render: () => <ColorField rgba={tint} onChange={setTint} />,
          },
        ],
      },
      {
        id: 'transform',
        title: '3D Transform & Sampling',
        defaultOpen: true,
        items: [
          {
            id: 'translate',
            label: 'Translate XYZ',
            dirty: translate.some((v, i) => v !== [0, 0, 0][i]),
            onReset: () => setTranslate([0, 0, 0]),
            render: () => (
              <VectorField values={translate} baselineValues={[0, 0, 0]} onChange={setTranslate} />
            ),
          },
          {
            id: 'samples',
            label: 'Samples (Int)',
            dirty: samples !== 16,
            onReset: () => setSamples(16),
            render: () => (
              <NumberField
                mode="int"
                value={samples}
                baselineValue={16}
                min={1}
                max={512}
                step={1}
                showSteppers
                onChange={setSamples}
                ariaLabel="Samples"
              />
            ),
          },
          {
            id: 'frames',
            label: 'Frame Range',
            render: () => (
              <RangeSlider
                value={frameRange}
                min={1001}
                max={1100}
                step={1}
                onChange={setFrameRange}
                ariaLabel="Frame range"
              />
            ),
          },
          {
            id: 'angle',
            label: 'Light Azimuth',
            dirty: angle !== 0,
            onReset: () => setAngle(0),
            render: () => <AngleDial value={angle} baselineValue={0} onChange={setAngle} />,
          },
          {
            id: 'knob',
            label: 'Gain Knob',
            dirty: knobVal !== 50,
            onReset: () => setKnobVal(50),
            render: () => (
              <Inline gap="3">
                <Knob value={knobVal} baselineValue={50} onChange={setKnobVal} label="Gain" />
                <Stepper value={stepVal} min={1} max={16} onChange={setStepVal} />
              </Inline>
            ),
          },
        ],
      },
      {
        id: 'lut',
        title: 'Tone Curve & Notes',
        defaultOpen: true,
        items: [
          {
            id: 'curve',
            label: 'Tone Ramp',
            render: () => <CurveRamp points={curve} onChange={setCurve} />,
          },
          {
            id: 'token',
            label: 'API Token',
            render: () => (
              <PasswordField
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                aria-label="API token"
              />
            ),
          },
          {
            id: 'notes',
            label: 'Review Note',
            render: () => (
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label="Review note"
              />
            ),
          },
        ],
      },
    ],
    [
      angle,
      apiToken,
      colorspace,
      curve,
      exposure,
      frameRange,
      gamma,
      knobVal,
      notes,
      samples,
      stepVal,
      tint,
      translate,
    ],
  );

  const matrixRows = [
    {
      control: 'Button (Default)',
      normal: <Button>Apply</Button>,
      hover: <Button forceState="hover">Apply</Button>,
      pressed: <Button forceState="pressed">Apply</Button>,
      focus: <Button forceState="focus">Apply</Button>,
      disabled: <Button disabled>Apply</Button>,
      error: <Button error>Apply</Button>,
      dirty: <Button pressed>Active</Button>,
    },
    {
      control: 'Button (Primary)',
      normal: <Button variant="primary">Publish</Button>,
      hover: (
        <Button variant="primary" forceState="hover">
          Publish
        </Button>
      ),
      pressed: (
        <Button variant="primary" forceState="pressed">
          Publish
        </Button>
      ),
      focus: (
        <Button variant="primary" forceState="focus">
          Publish
        </Button>
      ),
      disabled: (
        <Button variant="primary" disabled>
          Publish
        </Button>
      ),
      error: (
        <Button variant="primary" error>
          Publish
        </Button>
      ),
      dirty: <Badge tone="accent">5.70:1</Badge>,
    },
    {
      control: 'Button (Success)',
      normal: <Button variant="success">Approve</Button>,
      hover: (
        <Button variant="success" forceState="hover">
          Approve
        </Button>
      ),
      pressed: (
        <Button variant="success" forceState="pressed">
          Approve
        </Button>
      ),
      focus: (
        <Button variant="success" forceState="focus">
          Approve
        </Button>
      ),
      disabled: (
        <Button variant="success" disabled>
          Approve
        </Button>
      ),
      error: (
        <Button variant="success" error>
          Approve
        </Button>
      ),
      dirty: <Badge tone="success">5.48:1</Badge>,
    },
    {
      control: 'Button (Danger)',
      normal: <Button variant="danger">Reject</Button>,
      hover: (
        <Button variant="danger" forceState="hover">
          Reject
        </Button>
      ),
      pressed: (
        <Button variant="danger" forceState="pressed">
          Reject
        </Button>
      ),
      focus: (
        <Button variant="danger" forceState="focus">
          Reject
        </Button>
      ),
      disabled: (
        <Button variant="danger" disabled>
          Reject
        </Button>
      ),
      error: (
        <Button variant="danger" error>
          Reject
        </Button>
      ),
      dirty: <Badge tone="danger">4.83:1</Badge>,
    },
    {
      control: 'Checkbox',
      normal: <Checkbox checked={checkVal} onChange={setCheckVal} label="Lock" />,
      hover: <Checkbox checked forceState="hover" label="Lock" />,
      pressed: <Checkbox checked forceState="pressed" label="Lock" />,
      focus: <Checkbox checked forceState="focus" label="Lock" />,
      disabled: <Checkbox checked disabled label="Lock" />,
      error: <Checkbox error label="Lock" />,
      dirty: <Checkbox checked dirty label="Lock" />,
    },
    {
      control: 'Radio',
      normal: (
        <RadioGroup value={radioVal} onChange={setRadioVal} ariaLabel="Radio normal">
          <RadioItem value="2d" label="2D" />
        </RadioGroup>
      ),
      hover: (
        <RadioGroup value="2d" onChange={() => {}} ariaLabel="Radio hover">
          <RadioItem value="2d" label="2D" forceState="hover" />
        </RadioGroup>
      ),
      pressed: (
        <RadioGroup value="2d" onChange={() => {}} ariaLabel="Radio pressed">
          <RadioItem value="2d" label="2D" forceState="pressed" />
        </RadioGroup>
      ),
      focus: (
        <RadioGroup value="2d" onChange={() => {}} ariaLabel="Radio focus">
          <RadioItem value="2d" label="2D" forceState="focus" />
        </RadioGroup>
      ),
      disabled: (
        <RadioGroup value="2d" onChange={() => {}} disabled ariaLabel="Radio disabled">
          <RadioItem value="2d" label="2D" />
        </RadioGroup>
      ),
      error: (
        <RadioGroup value="2d" onChange={() => {}} ariaLabel="Radio error">
          <RadioItem value="2d" label="2D" error />
        </RadioGroup>
      ),
      dirty: (
        <RadioGroup value="2d" onChange={() => {}} ariaLabel="Radio dirty">
          <RadioItem value="2d" label="2D" dirty />
        </RadioGroup>
      ),
    },
    {
      control: 'Switch',
      normal: <Switch checked={switchVal} onChange={setSwitchVal} label="Grid" />,
      hover: <Switch checked forceState="hover" onChange={() => {}} />,
      pressed: <Switch checked forceState="pressed" onChange={() => {}} />,
      focus: <Switch checked forceState="focus" onChange={() => {}} />,
      disabled: <Switch checked disabled onChange={() => {}} />,
      error: <Switch checked={false} error onChange={() => {}} />,
      dirty: <Switch checked dirty label="Grid" onChange={() => {}} />,
    },
    {
      control: 'TextField',
      normal: <TextField defaultValue="hero_robot" aria-label="Text normal" />,
      hover: <TextField defaultValue="hero_robot" forceState="hover" aria-label="Text hover" />,
      pressed: (
        <TextField defaultValue="hero_robot" forceState="pressed" aria-label="Text pressed" />
      ),
      focus: <TextField defaultValue="hero_robot" forceState="focus" aria-label="Text focus" />,
      disabled: <TextField defaultValue="hero_robot" disabled aria-label="Text disabled" />,
      error: <TextField defaultValue="bad!" error="Invalid name" aria-label="Text error" />,
      dirty: <TextField defaultValue="v002" dirty aria-label="Text dirty" />,
    },
    {
      control: 'SearchField',
      normal: <SearchField value={searchDemo} onChange={setSearchDemo} matchCount="3/12" />,
      hover: <SearchField value="aov" onChange={() => {}} forceState="hover" />,
      pressed: <SearchField value="aov" onChange={() => {}} forceState="pressed" />,
      focus: <SearchField value="aov" onChange={() => {}} forceState="focus" />,
      disabled: <SearchField value="aov" onChange={() => {}} disabled />,
      error: <SearchField value="[" onChange={() => {}} error />,
      dirty: <SearchField value="beauty" onChange={() => {}} dirty />,
    },
    {
      control: 'Select',
      normal: <Select options={COLORSPACE_OPTS} value={colorspace} onChange={setColorspace} />,
      hover: (
        <Select options={COLORSPACE_OPTS} value="srgb" onChange={() => {}} forceState="hover" />
      ),
      pressed: (
        <Select options={COLORSPACE_OPTS} value="srgb" onChange={() => {}} forceState="pressed" />
      ),
      focus: (
        <Select options={COLORSPACE_OPTS} value="srgb" onChange={() => {}} forceState="focus" />
      ),
      disabled: <Select options={COLORSPACE_OPTS} value="srgb" onChange={() => {}} disabled />,
      error: <Select options={COLORSPACE_OPTS} value="srgb" onChange={() => {}} error />,
      dirty: <Select options={COLORSPACE_OPTS} value="acescg" onChange={() => {}} dirty />,
    },
    {
      control: 'NumberField',
      normal: <NumberField value={1.0} onChange={() => {}} unit="f" />,
      hover: <NumberField value={1.0} onChange={() => {}} forceState="hover" />,
      pressed: <NumberField value={1.0} onChange={() => {}} forceState="pressed" />,
      focus: <NumberField value={1.0} onChange={() => {}} forceState="focus" />,
      disabled: <NumberField value={1.0} onChange={() => {}} disabled />,
      error: <NumberField value={1.0} onChange={() => {}} error />,
      dirty: <NumberField value={2.5} baselineValue={1.0} onChange={() => {}} />,
    },
    {
      control: 'Slider',
      normal: <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" />,
      hover: (
        <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" forceState="hover" />
      ),
      pressed: (
        <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" forceState="pressed" />
      ),
      focus: (
        <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" forceState="focus" />
      ),
      disabled: <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" disabled />,
      error: <Slider value={40} onChange={() => {}} min={0} max={100} mode="int" error />,
      dirty: (
        <Slider value={75} baselineValue={40} onChange={() => {}} min={0} max={100} mode="int" />
      ),
    },
    {
      control: 'ColorPicker',
      normal: <ColorField rgba={tint} showAlpha={false} showChannels={false} onChange={setTint} />,
      hover: (
        <ColorField
          rgba={[0.55, 0.36, 0.96, 1]}
          showAlpha={false}
          showChannels={false}
          forceState="hover"
          onChange={() => {}}
        />
      ),
      pressed: (
        <ColorField
          rgba={[0.55, 0.36, 0.96, 1]}
          showAlpha={false}
          showChannels={false}
          forceState="pressed"
          onChange={() => {}}
        />
      ),
      focus: (
        <ColorField
          rgba={[0.55, 0.36, 0.96, 1]}
          showAlpha={false}
          showChannels={false}
          forceState="focus"
          onChange={() => {}}
        />
      ),
      disabled: (
        <ColorField
          rgba={[0.55, 0.36, 0.96, 1]}
          showAlpha={false}
          showChannels={false}
          disabled
          onChange={() => {}}
        />
      ),
      error: (
        <ColorField
          rgba={[0.55, 0.36, 0.96, 1]}
          showAlpha={false}
          showChannels={false}
          error
          onChange={() => {}}
        />
      ),
      dirty: (
        <ColorField
          rgba={[0.06, 0.72, 0.5, 1]}
          showAlpha={false}
          showChannels={false}
          dirty
          onChange={() => {}}
        />
      ),
    },
  ];

  return (
    <div className="org-app-shell">
      <Topbar
        left={
          <>
            <BrandWordmark />
            <MenuBar menus={menus} />
          </>
        }
        right={
          <>
            <Tag tone="accent">Widget Gallery v1</Tag>
            <Button
              size="sm"
              variant="toggle"
              pressed={redline}
              iconLeft={<Icon name="ruler" size="sm" />}
              onClick={onToggleRedline}
            >
              Redline
            </Button>
            <Button
              size="sm"
              variant="toggle"
              pressed={density === 'comfortable'}
              iconLeft={<Icon name="sliders" size="sm" />}
              onClick={onToggleDensity}
            >
              {density === 'compact' ? 'Compact (28px)' : 'Comfortable (32px)'}
            </Button>
            <Button
              size="sm"
              iconLeft={<Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />}
              onClick={onToggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? 'Paper' : 'Dark'}
            </Button>
            <StatusDot tone="success" label="UI Token Check OK" />
          </>
        }
      />

      <ScrollArea>
        <div className="org-page org-gx__page">
          <Stack gap="6">
            <Banner severity="info" title="ORGANUM v1 — matte control panel">
              Paper-like surfaces pressed in or popped out with very soft light from the top-left;
              almost square corners; every colour from tokens (Dark and Paper).
            </Banner>

            {/* Section 1: 60-30-10 Tokens */}
            <Panel title="Foundations — Tokens" collapsible>
              <Grid columns={4} gap="2">
                <TokenTile name="Panel" tokenVar="--bg-panel" role="Plates, panels, toolbars" />
                <TokenTile name="App" tokenVar="--bg-app" role="Window background (grain)" />
                <TokenTile
                  name="Input well"
                  tokenVar="--bg-input"
                  role="Fields, troughs, table body"
                />
                <TokenTile
                  name="Raised face"
                  tokenVar="--bg-raised-top"
                  role="Keys, cards, thumbs"
                />
                <TokenTile
                  name="Production zone"
                  tokenVar="--zone-production"
                  role="Accent lines, fills, LEDs"
                />
                <TokenTile
                  name="Management zone"
                  tokenVar="--zone-management"
                  role="Admin / people accent"
                />
                <TokenTile
                  name="Focus / active"
                  tokenVar="--zone-focus"
                  role="Focus ring, indicators"
                />
                <TokenTile name="Selected" tokenVar="--selected" role="Selected rows" />
              </Grid>
            </Panel>

            <FoundationsSection />

            {/* Section 2: Complete State Matrix */}
            <Panel title="Controls — State Matrix (7 States)" collapsible>
              <Table columns={MATRIX_COLS} rows={matrixRows} />
            </Panel>

            <Panel title="Controls — Buttons, Groups & Switches" collapsible>
              <ButtonsSpecimen />
            </Panel>

            {/* Section 3 & 4: Interactive Numeric Property Editor + Chrome/Feedback */}
            <Grid columns={2} gap="3">
              <Panel title="Controls — Numeric & Property Editor" collapsible>
                <PropertyEditor groups={propertyGroups} />
              </Panel>

              <Panel title="Navigation — Chrome, Overlays & Feedback" collapsible>
                <Stack gap="3">
                  <Toolbar ariaLabel="Sample viewer toolbar">
                    <ToolbarGroup>
                      <Tooltip content="Play / Pause" shortcut="Space">
                        <Button variant="toolbar" aria-label="Play">
                          <Icon name="play" size="sm" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Step Backward" shortcut="←">
                        <Button variant="toolbar" aria-label="Step back">
                          <Icon name="step-back" size="sm" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Step Forward" shortcut="→">
                        <Button variant="toolbar" aria-label="Step forward">
                          <Icon name="step-forward" size="sm" />
                        </Button>
                      </Tooltip>
                    </ToolbarGroup>
                    <Separator orientation="vertical" />
                    <SegmentedControl
                      size="sm"
                      ariaLabel="Channel mode"
                      value={segMode}
                      onChange={setSegMode}
                      options={[
                        { value: 'rgb', label: 'RGB' },
                        { value: 'alpha', label: 'Alpha' },
                        { value: 'luma', label: 'Y' },
                      ]}
                    />
                    <Separator orientation="vertical" />
                    <ButtonGroup>
                      <Button size="sm">Fit</Button>
                      <Button size="sm" pressed>
                        100%
                      </Button>
                      <Button size="sm">800%</Button>
                    </ButtonGroup>
                  </Toolbar>

                  <Inline gap="3" align="start">
                    <ToolStrip ariaLabel="Sample tool strip">
                      {(
                        [
                          ['pan', 'crosshair', 'Pan / Navigate (V)'],
                          ['rect', 'rect', 'Select Rect (R)'],
                          ['draw', 'pencil', 'Free Draw (B)'],
                          ['lasso', 'lasso', 'Closed Draw (P)'],
                          ['eraser', 'eraser', 'Eraser (E)'],
                          ['laser', 'laser', 'Laser Pointer (L)'],
                        ] as const
                      ).map(([id, icon, tip]) => (
                        <Tooltip key={id} content={tip}>
                          <Button
                            variant="toolbar"
                            pressed={activeTool === id}
                            aria-label={tip}
                            onClick={() => setActiveTool(id)}
                          >
                            <Icon name={icon} size="sm" />
                          </Button>
                        </Tooltip>
                      ))}
                    </ToolStrip>

                    <Stack gap="2" fill>
                      <Tabs
                        activeId={activeTab}
                        onChange={setActiveTab}
                        items={[
                          {
                            id: 'controls',
                            label: 'Progress & Status',
                            content: (
                              <Stack gap="2">
                                <ProgressBar value={68} label="Proxy transcode progress" />
                                <Inline gap="2" wrap>
                                  <Spinner label="Working" />
                                  <Badge tone="neutral">EXR 32f</Badge>
                                  <Badge tone="accent">ACEScg</Badge>
                                  <Badge tone="success">Cached</Badge>
                                  <Badge tone="warning">Proxy</Badge>
                                  <Badge tone="danger">Out of Range</Badge>
                                </Inline>
                              </Stack>
                            ),
                          },
                          {
                            id: 'overlays',
                            label: 'Dialogs & Menus',
                            content: (
                              <Inline gap="2" wrap>
                                <Button variant="primary" onClick={() => setDialogOpen(true)}>
                                  Open Modal Dialog
                                </Button>
                                <Popover trigger={<Button>Open Popover</Button>}>
                                  <Stack gap="2">
                                    <Text variant="mono">Pixel: (512, 256)</Text>
                                    <Text variant="muted">Linear RGB: 0.421, 0.318, 0.892</Text>
                                  </Stack>
                                </Popover>
                                <ContextMenu
                                  items={[
                                    { id: 'copy', label: 'Copy Node Path', shortcut: 'Ctrl+C' },
                                    { id: 'reset', label: 'Reset Overrides', shortcut: 'Ctrl+R' },
                                  ]}
                                >
                                  <Button variant="ghost">Right-Click Here</Button>
                                </ContextMenu>
                                <Button
                                  variant="success"
                                  onClick={() =>
                                    toast.push('success', 'Saved annotation to SQLite')
                                  }
                                >
                                  Show Toast
                                </Button>
                              </Inline>
                            ),
                          },
                          {
                            id: 'banners',
                            label: 'Banners',
                            content: (
                              <Stack gap="2">
                                <Banner severity="success" title="Scan complete">
                                  11 files indexed cleanly.
                                </Banner>
                                <Banner severity="warning" title="Large mesh">
                                  Exceeds 5M triangles — decimated proxy recommended.
                                </Banner>
                                <Banner severity="danger" title="Codec error">
                                  Unsupported bitstream detected.
                                </Banner>
                              </Stack>
                            ),
                          },
                        ]}
                      />

                      <Inline gap="2" wrap>
                        <Text variant="muted">Shortcuts:</Text>
                        <Kbd>Space</Kbd>
                        <Kbd>J</Kbd>
                        <Kbd>K</Kbd>
                        <Kbd>L</Kbd>
                        <Kbd>Tab</Kbd>
                        <Kbd>Shift+Drag</Kbd>
                      </Inline>
                    </Stack>
                  </Inline>
                </Stack>
              </Panel>
            </Grid>

            {/* Section 8: Timebar & Telemetry */}
            <Panel title="Navigation — Timebar, Transport & Telemetry" collapsible>
              <Stack gap="2">
                <TransportControls
                  playState={galleryPlaying ? 'forward' : 'paused'}
                  currentFrame={galleryFrame}
                  startFrame={1}
                  endFrame={48}
                  fps={24}
                  speed={1}
                  loopMode="loop"
                  onGoStart={() => setGalleryFrame(1)}
                  onStepBack={() => setGalleryFrame((f) => Math.max(1, f - 1))}
                  onPlayReverse={() => setGalleryPlaying(true)}
                  onPause={() => setGalleryPlaying(false)}
                  onPlayForward={() => setGalleryPlaying(true)}
                  onStepForward={() => setGalleryFrame((f) => Math.min(48, f + 1))}
                  onGoEnd={() => setGalleryFrame(48)}
                  onSeek={setGalleryFrame}
                  onChangeSpeed={() => {}}
                  onCycleLoop={() => {}}
                />
                <Timebar
                  startFrame={1}
                  endFrame={48}
                  currentFrame={galleryFrame}
                  fps={24}
                  markers={[{ id: 'm1', frameIn: 12, frameOut: 20, label: 'Note F12-F20' }]}
                  onSeek={setGalleryFrame}
                />
                <Grid columns={2} gap="3">
                  <JobQueue
                    jobs={[
                      {
                        id: 'j1',
                        label: 'transcode_vp9_turntable.webm',
                        status: 'done',
                        progress: 100,
                      },
                      { id: 'j2', label: 'bake_ocio_lut_33.cube', status: 'running', progress: 64 },
                    ]}
                  />
                  <LogConsole
                    entries={[
                      {
                        id: 'l1',
                        timestamp: '22:01:02',
                        level: 'INFO',
                        message: 'Scanned 27 files in storage root',
                      },
                      {
                        id: 'l2',
                        timestamp: '22:01:05',
                        level: 'WARN',
                        message: 'proprietary.tex returned partial support',
                      },
                      {
                        id: 'l3',
                        timestamp: '22:01:08',
                        level: 'INFO',
                        message: 'Baked OCIO LUT acescg->srgb (17^3)',
                      },
                    ]}
                  />
                </Grid>
              </Stack>
            </Panel>

            <IconsSection />

            <UsersSection />

            {/* Section 9: Production Identity & Capacity Primitives */}
            <Panel title="Users — Capacities" collapsible>
              <Stack gap="2">
                <Inline gap="2" wrap>
                  <Avatar username="admin" fullName="Administrator" size="sm" />
                  <Avatar username="dir_alex" fullName="Alex Vance" size="md" />
                  <Avatar username="cli_jordan" fullName="Jordan Blake" size="md" />
                  <CapacityBadge capacity="artist" />
                  <CapacityBadge capacity="lead" />
                  <CapacityBadge capacity="supervisor" />
                  <UserPicker
                    users={[
                      {
                        id: 'u1',
                        username: 'art_sam',
                        fullName: 'Sam Rivera',
                        roleLabel: 'Artist',
                        companyName: 'Studio',
                      },
                      {
                        id: 'u2',
                        username: 'dir_alex',
                        fullName: 'Alex Vance',
                        roleLabel: 'Director',
                        companyName: 'Studio',
                      },
                    ]}
                    selectedIds={pickedUsers}
                    onChange={setPickedUsers}
                  />
                </Inline>
              </Stack>
            </Panel>
            <PrioritySection />

            <ReviewSection />

            {/* Section 6: Excel-like DataGrid */}
            <Panel title="Data — DataGrid (Sort / Filter / Range Stats)" collapsible>
              <DataGrid
                ariaLabel="Gallery DataGrid"
                editable
                columns={
                  [
                    { key: 'frame', header: 'Frame', numeric: true, width: 84 },
                    { key: 'render_ms', header: 'Render ms', numeric: true, width: 104 },
                    { key: 'vram_mb', header: 'VRAM MB', numeric: true, width: 104 },
                    { key: 'pass', header: 'Pass', width: 110 },
                    { key: 'status', header: 'Status', width: 90 },
                  ] satisfies DataGridColumn[]
                }
                rows={gridRows}
                onCellEdit={(rIdx, colKey, val) =>
                  setGridRows((prev) =>
                    prev.map((row, idx) =>
                      idx === rIdx
                        ? {
                            ...row,
                            [colKey]:
                              Number.isFinite(Number(val)) &&
                              colKey !== 'pass' &&
                              colKey !== 'status'
                                ? Number(val)
                                : val,
                          }
                        : row,
                    ),
                  )
                }
              />
            </Panel>

            {/* Section 7: Charts & Image Scopes */}
            <Panel title="Data — Charts & Scopes" collapsible>
              <Grid columns={2} gap="3">
                <LineChart
                  title="Frame Render Time (ms)"
                  series={[
                    {
                      id: 'cpu',
                      label: 'CPU',
                      data: [
                        { x: 1, y: 142.5 },
                        { x: 2, y: 139.8 },
                        { x: 3, y: 151.1 },
                        { x: 4, y: 136.4 },
                      ],
                    },
                    {
                      id: 'gpu',
                      label: 'GPU',
                      data: [
                        { x: 1, y: 42.0 },
                        { x: 2, y: 41.2 },
                        { x: 3, y: 46.8 },
                        { x: 4, y: 39.5 },
                      ],
                    },
                  ]}
                />
                <BarChart
                  title="Pass Memory Footprint (MB)"
                  bars={[
                    { label: 'Beauty', value: 512 },
                    { label: 'Diffuse', value: 380 },
                    { label: 'Spec', value: 295 },
                    { label: 'Depth', value: 180 },
                  ]}
                />
                <Histogram
                  title="RGBL Color Scope"
                  channels={[
                    {
                      id: 'r',
                      label: 'R',
                      bins: [2, 6, 12, 18, 22, 14, 7, 3],
                      color: 'var(--axis-x)',
                    },
                    {
                      id: 'g',
                      label: 'G',
                      bins: [1, 8, 16, 20, 17, 11, 5, 2],
                      color: 'var(--axis-y)',
                    },
                    {
                      id: 'b',
                      label: 'B',
                      bins: [3, 9, 14, 15, 19, 13, 6, 4],
                      color: 'var(--axis-z)',
                    },
                  ]}
                />
                <ScatterPlot
                  title="Sample Variance vs Time"
                  points={[
                    { x: 16, y: 0.14, label: '16spp', seriesIndex: 0 },
                    { x: 32, y: 0.08, label: '32spp', seriesIndex: 1 },
                    { x: 64, y: 0.04, label: '64spp', seriesIndex: 2 },
                    { x: 128, y: 0.02, label: '128spp', seriesIndex: 3 },
                  ]}
                />
                <Heatmap
                  title="Bucket Render Latency"
                  rowLabels={['TileA', 'TileB', 'TileC']}
                  colLabels={['C1', 'C2', 'C3', 'C4']}
                  matrix={[
                    [12, 24, 48, 18],
                    [22, 64, 82, 31],
                    [14, 28, 36, 19],
                  ]}
                />
                <NodeGraph
                  title="Compositing DAG"
                  nodes={[
                    { id: 'exr', label: 'Read EXR', x: 16, y: 26, kind: 'source' },
                    { id: 'grade', label: 'OCIO LUT', x: 168, y: 26, kind: 'color' },
                    { id: 'out', label: 'Viewer', x: 320, y: 26, kind: 'sink' },
                  ]}
                  edges={[
                    { from: 'exr', to: 'grade' },
                    { from: 'grade', to: 'out' },
                  ]}
                />
              </Grid>
              <Inline gap="4" wrap>
                <Inline gap="2">
                  <Text variant="muted">Trend:</Text>
                  <Sparkline values={[12, 18, 14, 22, 19, 25, 21]} />
                </Inline>
                <GaugeBar label="Cache Quota" value={68} max={100} tone="accent" />
              </Inline>
            </Panel>

            {/* Section 5: Spacing Specification Table */}
            <Panel title="Data — Spacing & Sizing Specification" collapsible>
              <Table columns={SPACING_COLS} rows={SPACING_ROWS} />
            </Panel>
          </Stack>
        </div>
      </ScrollArea>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="ORGANUM UI System"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialogOpen(false);
                toast.push('info', 'Preferences confirmed');
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Stack gap="2">
          <Text>
            Built with plain layered CSS (`@layer tokens, base, components, utilities`), zero inline
            styles, WCAG 2.2 AA contrast verification, and Radix UI accessible primitives.
          </Text>
          <Text variant="muted">Use the Redline toggle in the topbar to inspect box spacing.</Text>
        </Stack>
      </Dialog>

      <StatusBar>
        <StatusBarSegment grow>Gallery ready — hover or scrub any numeric field</StatusBarSegment>
        <StatusBarSegment mono>Theme: {theme}</StatusBarSegment>
        <StatusBarSegment mono>Density: {density}</StatusBarSegment>
        <StatusBarSegment mono>Redline: {redline ? 'ON' : 'OFF'}</StatusBarSegment>
        <StatusBarSegment mono>Exposure: {exposure.toFixed(2)} EV</StatusBarSegment>
      </StatusBar>
    </div>
  );
}
