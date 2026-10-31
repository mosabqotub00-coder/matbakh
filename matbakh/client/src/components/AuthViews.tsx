import { useState } from "react";
import { KeyRound, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export type StaffRole = "developer" | "system_admin" | "branch_manager" | "kitchen_manager" | "shift_manager" | "station" | "kitchen";
export type StaffClientUser = {
  id: number; username: string; displayName: string; name?: string; role?: StaffRole | string | null; branchId?: number | null;
  canStation?: boolean; canKitchen?: boolean; canManager?: boolean; canManageUsers?: boolean; canBroadcast?: boolean; canExtend?: boolean;
  isActive: boolean; mustChangePassword: boolean; email?: null; createdAt: Date;
  [key: string]: unknown;
};
export type SectionPermission = "canStation" | "canKitchen" | "canManager" | "developer";
export const ROLE_LABELS: Record<string, string> = {
  developer: "المطوّر", system_admin: "مدير النظام", branch_manager: "مدير الفرع", kitchen_manager: "مدير المطبخ", shift_manager: "مدير الشفت", station: "موظف السخان", kitchen: "موظف المطبخ",
};
export const roleLabel = (role?: string | null) => role ? ROLE_LABELS[role] ?? role : "موظف";
export const isSystemAdmin = (user?: StaffClientUser | null) => user?.role === "system_admin" || user?.role === "developer";
export const isAdminRole = (role?: string | null) => ["developer", "system_admin", "branch_manager", "kitchen_manager", "shift_manager"].includes(role ?? "");
export function hasSectionAccess(user: StaffClientUser, permission: SectionPermission) {
  if (permission === "developer") return user.role === "developer";
  if (permission === "canStation") return Boolean(user.role === "developer" || user.role === "system_admin" || user.role === "branch_manager" || user.role === "kitchen_manager" || user.role === "station" || user.canStation);
  if (permission === "canKitchen") return Boolean(user.role === "developer" || user.role === "system_admin" || user.role === "branch_manager" || user.role === "kitchen_manager" || user.role === "kitchen" || user.canKitchen);
  return Boolean(isAdminRole(user.role) || user.canManager);
}
export function defaultStaffPath(user: StaffClientUser) {
  if (user.role === "developer") return "/developer";
  if (hasSectionAccess(user, "canManager")) return "/manager";
  if (hasSectionAccess(user, "canStation")) return "/";
  if (hasSectionAccess(user, "canKitchen")) return "/kitchen";
  return "/notifications";
}
export function canOpenPath(user: StaffClientUser, path: string) {
  if (path === "/developer" || path.startsWith("/developer/")) return user.role === "developer";
  if (path === "/") return hasSectionAccess(user, "canStation");
  if (path === "/kitchen") return hasSectionAccess(user, "canKitchen");
  if (path === "/manager" || path === "/communications") return hasSectionAccess(user, "canManager") || Boolean(user.canBroadcast);
  if (path === "/notifications") return Boolean(user.isActive);
  return false;
}
function destinationStaffPath(user: StaffClientUser, requestedPath: string) { return canOpenPath(user, requestedPath) ? requestedPath : defaultStaffPath(user); }

export function LoginScreen({ redirectTo = "/" }: { redirectTo?: string }) {
  const [, setLocation] = useLocation(); const utils = trpc.useUtils(); const queryClient = useQueryClient();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({ onError: error => toast.error(error.message) });
  return <main className="auth-screen" dir="rtl"><section className="auth-card">
    <div className="auth-brand"><span className="auth-brand-mark"><LockKeyhole size={22} /></span><div><strong>مطبخي</strong><small>دخول الموظفين</small></div></div>
    <div className="auth-intro"><span className="eyebrow-line" /><span>نظام تشغيل داخلي متعدد الفروع</span></div><h1>تسجيل الدخول</h1><p className="auth-description">استخدم اسم المستخدم وكلمة المرور للوصول إلى مساحة العمل المصرّح بها.</p>
    <form className="auth-form" onSubmit={event => { event.preventDefault(); login.mutate({ username: username.trim(), password }, { onSuccess: ({ user }) => { queryClient.removeQueries({ predicate: query => JSON.stringify(query.queryKey[0]) !== '["auth","me"]' }); utils.auth.me.setData(undefined, user); setLocation(user.mustChangePassword ? "/manager" : destinationStaffPath(user, redirectTo)); } }); }}>
      <label><span>اسم المستخدم</span><div className="auth-input-wrap"><UserRound size={17} /><input autoComplete="username" autoFocus required maxLength={64} value={username} onChange={event => setUsername(event.target.value)} placeholder="اسم المستخدم" /></div></label>
      <label><span>كلمة المرور</span><div className="auth-input-wrap"><KeyRound size={17} /><input autoComplete="current-password" type="password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="كلمة المرور" /></div></label>
      <button type="submit" className="auth-submit" disabled={login.isPending}><LogIn size={17} />{login.isPending ? "جارٍ التحقق…" : "دخول"}</button>
    </form><div className="auth-footnote"><span className="live-dot" /> الحسابات وكلمات المرور تُدار من لوحة الإدارة</div>
  </section></main>;
}

export function ChangePasswordScreen({ redirectTo = "/" }: { redirectTo?: string }) {
  const [, setLocation] = useLocation(); const utils = trpc.useUtils(); const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const changePassword = trpc.auth.changePassword.useMutation({ onError: error => toast.error(error.message) });
  return <main className="auth-screen" dir="rtl"><section className="auth-card"><div className="auth-brand"><span className="auth-brand-mark"><KeyRound size={22} /></span><div><strong>مطبخي</strong><small>حماية الحساب</small></div></div><div className="auth-intro"><span className="eyebrow-line" /><span>خطوة مطلوبة قبل المتابعة</span></div><h1>غيّر كلمة المرور المؤقتة</h1><p className="auth-description">اختر كلمة مرور جديدة لا تقل عن 10 أحرف.</p>
    <form className="auth-form" onSubmit={event => { event.preventDefault(); if (newPassword.length < 10) return toast.error("كلمة المرور يجب أن تحتوي على 10 أحرف على الأقل."); if (newPassword !== confirmation) return toast.error("تأكيد كلمة المرور غير مطابق."); changePassword.mutate({ currentPassword, newPassword }, { onSuccess: user => { utils.auth.me.setData(undefined, user); toast.success("تم تغيير كلمة المرور."); setLocation(destinationStaffPath(user, redirectTo)); } }); }}>
      <label><span>كلمة المرور الحالية</span><div className="auth-input-wrap"><KeyRound size={17} /><input type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></div></label><label><span>كلمة المرور الجديدة</span><div className="auth-input-wrap"><KeyRound size={17} /><input type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></div></label><label><span>تأكيد كلمة المرور الجديدة</span><div className="auth-input-wrap"><KeyRound size={17} /><input type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div></label><button type="submit" className="auth-submit" disabled={changePassword.isPending}><KeyRound size={17} />{changePassword.isPending ? "جارٍ الحفظ…" : "حفظ ومتابعة"}</button>
    </form><div className="auth-footnote"><span className="live-dot" /> لا يمكن فتح الأقسام قبل تغيير كلمة المرور</div></section></main>;
}
