import { useState, type ReactNode } from 'react';
import {
  Button,
  ColorPicker,
  ContextMenu,
  DatePicker,
  Dialog,
  MenuBar,
  Popover,
  Select,
  Tooltip,
  UserPicker,
  type UserPickerOption,
} from '../components/ui';
import './LayeringFixture.css';

const OPTIONS = [
  { value: 'anim', label: 'Animation' },
  { value: 'fx', label: 'FX' },
  { value: 'light', label: 'Lighting' },
];

const USERS: UserPickerOption[] = [
  { id: 'u1', username: 'ana', fullName: 'Ana Artist', roleLabel: 'Artist' },
  { id: 'u2', username: 'leo', fullName: 'Leo Lead', roleLabel: 'Lead' },
];

/** Every floating-UI type, wired to visible state so tests can assert a selection landed. */
function FloatingSet({ scope }: { scope: string }) {
  const [dept, setDept] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [color, setColor] = useState('#808080');
  const [users, setUsers] = useState<string[]>([]);
  const [menuPick, setMenuPick] = useState('none');
  const [popoverPick, setPopoverPick] = useState('none');

  return (
    <div className="org-layering__set" data-ui={`layering-set-${scope}`}>
      <Select ariaLabel={`${scope} department`} options={OPTIONS} value={dept} onChange={setDept} />
      <DatePicker ariaLabel={`${scope} date`} value={date} onChange={setDate} />
      <ColorPicker ariaLabel={`${scope} color`} value={color} onChange={setColor} />
      <UserPicker
        ariaLabel={`${scope} users`}
        users={USERS}
        selectedIds={users}
        onChange={setUsers}
      />
      <MenuBar
        menus={[
          {
            id: 'm',
            label: `${scope} Menu`,
            items: [{ id: 'a', label: `${scope} menu item`, onSelect: () => setMenuPick('menu') }],
          },
        ]}
      />
      <ContextMenu
        items={[{ id: 'c', label: `${scope} context item`, onSelect: () => setMenuPick('ctx') }]}
      >
        <div className="org-layering__ctx" data-ui={`layering-ctx-${scope}`}>
          Right-click here ({scope})
        </div>
      </ContextMenu>
      <Popover trigger={<Button size="sm">{`${scope} popover`}</Button>}>
        <Button size="sm" onClick={() => setPopoverPick('picked')}>
          {`${scope} popover action`}
        </Button>
      </Popover>
      <Tooltip content={`${scope} tooltip text`}>
        <Button size="sm">{`${scope} hover me`}</Button>
      </Tooltip>
      <output data-ui={`layering-state-${scope}`}>
        {`dept=${dept};date=${date ?? ''};color=${color};users=${users.join(',')};menu=${menuPick};popover=${popoverPick}`}
      </output>
    </div>
  );
}

/**
 * CR04 §2 test harness (route /gallery/layering): popovers, menus and tooltips opened
 * from inside a modal dialog and from inside a clipped right dock must render on top.
 */
export function LayeringFixture() {
  const [open, setOpen] = useState(false);
  return (
    <div className="org-layering" data-ui="layering-fixture">
      <main className="org-layering__main">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open layering dialog
        </Button>
      </main>
      <DockShell>
        <FloatingSet scope="dock" />
      </DockShell>
      <Dialog open={open} onOpenChange={setOpen} title="Layering dialog">
        <FloatingSet scope="dialog" />
      </Dialog>
    </div>
  );
}

function DockShell({ children }: { children: ReactNode }) {
  return (
    <aside className="org-layering__dock" aria-label="Right dock" data-ui="layering-dock">
      {children}
    </aside>
  );
}
