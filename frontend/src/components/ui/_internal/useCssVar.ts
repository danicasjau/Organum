import { useLayoutEffect, type RefObject } from 'react';

/**
 * Imperatively binds a CSS custom property on a DOM element ref so dynamic
 * geometric coordinates/percentages/swatches never require inline JSX `style={}`.
 */
export function useCssVarRef(
  ref: RefObject<HTMLElement | null>,
  name: string,
  value: string | number | undefined,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === undefined) {
      el.style.removeProperty(name);
    } else {
      el.style.setProperty(name, String(value));
    }
  }, [ref, name, value]);
}

