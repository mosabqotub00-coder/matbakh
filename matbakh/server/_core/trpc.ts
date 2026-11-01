import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  canAccessSection,
  canBroadcast,
  canExtend,
  canManageStaff,
  isSystemAdmin,
  isDeveloper,
  roleOf,
  type StaffRole,
} from "../../shared/roles";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;

const requireStaff = t.middleware(async ({ ctx, next }) => {
  const staffUser = ctx.staffUser;
  if (!staffUser || !staffUser.isActive)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "يلزم تسجيل الدخول للمتابعة.",
    });
  return next({ ctx: { ...ctx, staffUser } });
});

export const staffProcedure = t.procedure.use(requireStaff);

function requireAccess(
  check: (user: NonNullable<TrpcContext["staffUser"]>) => boolean,
  message: string
) {
  return staffProcedure.use(
    t.middleware(async ({ ctx, next }) => {
      const staffUser = ctx.staffUser;
      if (!staffUser)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "يلزم تسجيل الدخول للمتابعة.",
        });
      if (staffUser.mustChangePassword)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "غيّر كلمة المرور المؤقتة أولاً.",
        });
      if (!check(staffUser))
        throw new TRPCError({ code: "FORBIDDEN", message });
      return next({ ctx: { ...ctx, staffUser } });
    })
  );
}

function hasRole(
  user: NonNullable<TrpcContext["staffUser"]>,
  roles: StaffRole[]
) {
  return roles.includes(roleOf(user) as StaffRole);
}

export const stationProcedure = requireAccess(
  user => canAccessSection(user, "station"),
  "ليس لديك صلاحية لقسم السخان."
);
export const kitchenProcedure = requireAccess(
  user => canAccessSection(user, "kitchen"),
  "ليس لديك صلاحية لقسم المطبخ."
);
export const managerProcedure = requireAccess(
  user => canAccessSection(user, "manager"),
  "ليس لديك صلاحية للوحة الإدارة."
);
export const monitorProcedure = requireAccess(
  user =>
    canAccessSection(user, "manager") || canAccessSection(user, "kitchen"),
  "ليس لديك صلاحية للمتابعة."
);
export const orderReadProcedure = requireAccess(
  user =>
    canAccessSection(user, "station") ||
    canAccessSection(user, "kitchen") ||
    canAccessSection(user, "manager"),
  "ليس لديك صلاحية لقراءة تفاصيل الطلب."
);
export const orderEntryProcedure = requireAccess(
  user =>
    hasRole(user, ["developer", "system_admin", "kitchen_manager", "station"]) ||
    Boolean(user.canStation && !user.role),
  "ليس لديك صلاحية لإنشاء الطلبات."
);
export const receiveProcedure = requireAccess(
  user => hasRole(user, ["developer", "system_admin", "kitchen_manager", "station"]),
  "ليس لديك صلاحية لتأكيد الاستلام."
);
export const extendProcedure = requireAccess(
  user => canExtend(user),
  "تمديد المهلة متاح لمدير المطبخ أو مدير النظام الأعلى."
);
export const staffManagementProcedure = requireAccess(
  user => canManageStaff(user),
  "لا تملك صلاحية إدارة الحسابات."
);
export const broadcastProcedure = requireAccess(
  user => canBroadcast(user),
  "لا تملك صلاحية البث."
);
export const systemAdminProcedure = requireAccess(
  user => isSystemAdmin(user),
  "هذا الإجراء متاح لمدير النظام الأعلى فقط."
);
export const developerProcedure = requireAccess(
  user => isDeveloper(user),
  "هذا الإجراء متاح لحساب المطوّر فقط."
);
export const branchManagerProcedure = requireAccess(
  user => hasRole(user, ["branch_manager"]),
  "هذا الإجراء متاح لمدير الفرع فقط."
);
