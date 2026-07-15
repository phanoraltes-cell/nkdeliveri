export const EMPLOYEE_ROLES = [
  "staff",
  "manager",
  "cook",
  "prep",
  "cashier",
  "supervisor",
] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_ROLE_LABEL: Record<EmployeeRole, string> = {
  staff: "Anplwaye jeneral",
  manager: "Manadjè",
  cook: "Kizinye",
  prep: "Preparatè",
  cashier: "Kesye",
  supervisor: "Responsab",
};

const OPERATIONAL_ROLES = new Set<string>(["cook", "prep", "cashier"]);

/**
 * True when a role is limited to order/Kanban/kitchen-ticket work — no
 * menu or promotion editing. Mirrors private.is_restaurant_staff_or_manager
 * server-side (staff/manager/supervisor get menu access; cook/prep/cashier
 * don't) so the nav never offers a link the RPC would just reject.
 */
export function isOperationalRole(role: string | null | undefined): boolean {
  return OPERATIONAL_ROLES.has(role ?? "");
}
