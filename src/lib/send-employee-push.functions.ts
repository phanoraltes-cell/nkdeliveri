import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMPLOYEE_ROLE_LABEL, type EmployeeRole } from "@/lib/employee-roles";

const InputSchema = z.object({ employeeId: z.string().uuid() });

/** Called right after add_restaurant_employee_secure / update_restaurant_employee_role_secure succeeds — notifies the employee. */
export const sendEmployeeEventPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: employee, error } = await supabaseAdmin
      .from("restaurant_employees")
      .select("id, user_id, role, restaurants(name)")
      .eq("id", data.employeeId)
      .single();
    if (error || !employee) throw new Error(error?.message || "Employee not found");

    const restaurantName = employee.restaurants?.name ?? "yon restoran";
    const roleLabel = EMPLOYEE_ROLE_LABEL[employee.role as EmployeeRole] ?? employee.role;

    const { pushToUsers } = await import("@/lib/push-dispatch.server");
    return pushToUsers([employee.user_id], {
      title: "Enfòmasyon travay ou aktyalize",
      body: `Wòl ou kounye a se "${roleLabel}" pou ${restaurantName}.`,
      url: "/dashboard/restaurant",
      tag: `employee-${employee.id}`,
      data: { employeeId: employee.id, role: employee.role },
    });
  });
