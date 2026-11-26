import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './MenuBar.css';

export interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

export interface MenuBarMenu {
  id: string;
  label: string;
  items: ReadonlyArray<MenuEntry>;
}

export function MenuBar({
  menus,
  className,
}: {
  menus: ReadonlyArray<MenuBarMenu>;
  className?: string;
}) {
  return (
    <nav data-ui="menu-bar" aria-label="Application menu" className={cn('org-menubar', className)}>
      {menus.map((menu) => (
        <DropdownMenu.Root key={menu.id}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="org-menubar__trigger">
              {menu.label}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={2} className="org-menu__content">
              {menu.items.map((item) =>
                item.separator ? (
                  <DropdownMenu.Separator key={item.id} className="org-menu__sep" />
                ) : (
                  <DropdownMenu.Item
                    key={item.id}
                    disabled={item.disabled}
                    className="org-menu__item"
                    onSelect={item.onSelect}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="org-menu__shortcut">{item.shortcut}</span>}
                  </DropdownMenu.Item>
                ),
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </nav>
  );
}

export function ContextMenu({
  children,
  items,
}: {
  children: ReactNode;
  items: ReadonlyArray<MenuEntry>;
}) {
  if (items.length === 0) return <>{children}</>;
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="org-menu__content">
          {items.map((item) =>
            item.separator ? (
              <ContextMenuPrimitive.Separator key={item.id} className="org-menu__sep" />
            ) : (
              <ContextMenuPrimitive.Item
                key={item.id}
                disabled={item.disabled}
                className="org-menu__item"
                onSelect={item.onSelect}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="org-menu__shortcut">{item.shortcut}</span>}
              </ContextMenuPrimitive.Item>
            ),
          )}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
