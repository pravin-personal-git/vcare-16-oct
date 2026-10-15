import { redirect } from 'next/navigation';

/**
 * Departments are a master, and there is already a screen for masters.
 *
 * A second departments screen would be a second place to add one, a second
 * place to deactivate one, and eventually two lists that disagree. The Masters
 * screen already reads and writes exactly this table, with the usage count that
 * decides whether a department can be deleted or only switched off.
 *
 * So this menu entry goes there rather than duplicating it. The redirect is
 * permanent in meaning but written as a normal one, because the route is a menu
 * destination a tenant can switch on and off and a 308 would be cached by the
 * browser past the point where that mattered.
 */
export default function DepartmentsPage() {
  redirect('/settings/masters?list=department');
}
