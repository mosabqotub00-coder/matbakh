export type StaffRole =
  | "developer"
  | "system_admin"
  | "branch_manager"
  | "kitchen_manager"
  | "shift_manager"
  | "station"
  | "kitchen";

export type StaffLike = {
  role?: StaffRole | null;
  branchId?: number | null;
  canStation?: boolean;
  canKitchen?: boolean;
  canManager?: boolean;
  canManageUsers?: boolean;
  canBroadcast?: boolean;
  canExtend?: boolean;
  isActive?: boolean;
};

export type StaffSection = "station" | "kitchen" | "manager";

export const ROLE_LABELS: Record<StaffRole, string> = {
  developer: "المطوّر",
  system_admin: "مدير النظام الأعلى",
  branch_manager: "مدير الفرع",
  kitchen_manager: "مدير المطبخ",
  shift_manager: "مدير الشفت",
  station: "موظف السخان",
  kitchen: "موظف المطبخ",
};

const LEGACY_ROLE_BY_FLAGS = (user: StaffLike): StaffRole | null => {
  if (user.role) return user.role;
  if (user.canManager) return "shift_manager";
  if (user.canStation && user.canKitchen) return "kitchen_manager";
  if (user.canStation) return "station";
  if (user.canKitchen) return "kitchen";
  return null;
};

export function roleOf(user: StaffLike): StaffRole | null {
  return LEGACY_ROLE_BY_FLAGS(user);
}

export function roleCapabilities(role: StaffRole | null | undefined) {
  switch (role) {
    case "developer":
      return { station: true, kitchen: true, manager: true, manageStaff: true, manageUsers: true, broadcast: true, extend: true, developer: true } as const;
    case "system_admin":
      return { station: true, kitchen: true, manager: true, manageStaff: true, manageUsers: true, broadcast: true, extend: true, developer: false } as const;
    case "branch_manager":
      return { station: false, kitchen: false, manager: true, manageStaff: true, manageUsers: true, broadcast: true, extend: false, developer: false } as const;
    case "kitchen_manager":
      return { station: true, kitchen: true, manager: true, manageStaff: false, manageUsers: false, broadcast: true, extend: true, developer: false } as const;
    case "shift_manager":
      return { station: false, kitchen: false, manager: true, manageStaff: false, manageUsers: false, broadcast: true, extend: false, developer: false } as const;
    case "station":
      return { station: true, kitchen: false, manager: false, manageStaff: false, manageUsers: false, broadcast: false, extend: false, developer: false } as const;
    case "kitchen":
      return { station: false, kitchen: true, manager: false, manageStaff: false, manageUsers: false, broadcast: false, extend: false, developer: false } as const;
    default:
      return { station: false, kitchen: false, manager: false, manageStaff: false, manageUsers: false, broadcast: false, extend: false, developer: false } as const;
  }
}

export function canAccessSection(user: StaffLike | null | undefined, section: StaffSection) {
  if (!user || user.isActive === false) return false;
  const capabilities = roleCapabilities(roleOf(user));
  if (capabilities[section]) return true;
  if (user.role) return false;
  // Keep old mocked/session users working while their role column is backfilled.
  return section === "station" ? Boolean(user.canStation) : section === "kitchen" ? Boolean(user.canKitchen) : Boolean(user.canManager);
}

export function canManageStaff(user: StaffLike | null | undefined) {
  if (!user || user.isActive === false) return false;
  if (user.role) return roleCapabilities(user.role).manageStaff;
  return Boolean(user.canManageUsers) || Boolean(user.canManager);
}

export function canBroadcast(user: StaffLike | null | undefined) {
  if (!user || user.isActive === false) return false;
  if (user.role) return roleCapabilities(user.role).broadcast;
  return Boolean(user.canBroadcast);
}

export function canExtend(user: StaffLike | null | undefined) {
  if (!user || user.isActive === false) return false;
  if (user.role) return roleCapabilities(user.role).extend;
  return Boolean(user.canExtend);
}

export function isSystemAdmin(user: StaffLike | null | undefined) {
  return Boolean(user && ["system_admin", "developer"].includes(roleOf(user) ?? ""));
}

export function isDeveloper(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "developer");
}

export function isBranchManager(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "branch_manager");
}

export function isKitchenManager(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "kitchen_manager");
}

export function isShiftManager(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "shift_manager");
}

export function isStationUser(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "station");
}

export function isKitchenUser(user: StaffLike | null | undefined) {
  return Boolean(user && roleOf(user) === "kitchen");
}
