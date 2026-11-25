import { DeptTag } from '../../components/ui';
import { useDeptColor } from './deptColors';

/** Department label rendered in the department's configured color. */
export function DepartmentTag({
  id,
  name,
  color,
  label,
  variant,
  className,
}: {
  id?: string | null;
  name: string;
  color?: string | null;
  label?: string;
  variant?: 'tag' | 'text' | 'swatch';
  className?: string;
}) {
  const css = useDeptColor({ id, name, color });
  return <DeptTag color={css} label={label ?? name} variant={variant} className={className} />;
}
