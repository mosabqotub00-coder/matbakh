import { Link, useLocation } from "wouter";
import {
  ChefHat,
  ClipboardList,
  CookingPot,
  Flame,
  LayoutDashboard,
  Megaphone,
  Bell,
  Volume2,
  VolumeX,
  LogOut,
  Code2,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useKitchenAudio } from "@/contexts/KitchenAudioContext";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { canOpenPath, roleLabel, type StaffClientUser } from "./AuthViews";
import StaffFeedbackButton from "./StaffFeedbackButton";
import "@/account-controls.css";

const nav = [
  { href: "/", label: "محطة السخان", icon: Flame },
  { href: "/kitchen", label: "شاشة المطبخ", icon: CookingPot },
  { href: "/manager", label: "لوحة الإدارة", icon: LayoutDashboard },
  { href: "/communications", label: "التواصل", icon: Megaphone },
  { href: "/notifications", label: "مركز التنبيهات", icon: Bell },
  { href: "/developer", label: "مركز المطوّر", icon: Code2 },
];
export default function KitchenLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { enabled, toggle } = useKitchenAudio();
  const queryClient = useQueryClient();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data as
    | StaffClientUser
    | null
    | undefined;
  const {
    branches,
    activeBranchId,
    activeBranch,
    isSystemAdmin,
    isLoading,
    setActiveBranchId,
  } = useBranch();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      // A fresh document removes the prior account's state even when already at /.
      window.location.replace("/");
    },
    onError: () =>
      toast.error(
        "تعذر تسجيل الخروج. تحقق من الاتصال وحاول مجددًا؛ الحساب ما زال مفتوحًا."
      ),
  });
  const visibleNav = user
    ? user.role === "developer"
      ? nav.filter(item => item.href === "/developer")
      : nav.filter(item => canOpenPath(user, item.href))
    : [];
  const themeClass = location === "/kitchen" ? "v2-dark" : "v2-light";
  function openGeneral() {
    setActiveBranchId(null);
    setLocation("/manager");
  }
  return (
    <div
      className={`app-shell ${themeClass}${location === "/notifications" ? " notification-page-shell" : ""}`}
      dir="rtl"
    >
      <aside className="sidebar">
        <Link href={user ? defaultLink(user) : "/"} className="brand">
          <span className="brand-mark">
            <ChefHat size={21} />
          </span>
          <span>
            <strong>مطبخي</strong>
            <small>تشغيل متعدد الفروع</small>
          </span>
        </Link>
        <div className="nav-caption">مساحة العمل</div>
        <nav className="side-nav">
          {isSystemAdmin && (
            <button
              type="button"
              className={`nav-link ${!activeBranchId && location === "/manager" ? "active" : ""}`}
              onClick={openGeneral}
            >
              <LayoutDashboard size={18} />
              <span>الإدارة العامة</span>
            </button>
          )}
          {visibleNav.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${location === item.href && !(isSystemAdmin && !activeBranchId && item.href === "/manager") ? "active" : ""}`}
              >
                <Icon size={18} />
                <span>
                  {item.href === "/manager" && isSystemAdmin
                    ? "إدارة الفرع المختار"
                    : item.label}
                </span>
                {location === item.href && <span className="nav-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="live-dot" /> النظام الداخلي يعمل
          <small>
            <ClipboardList size={13} /> تحديثات الطلبات مباشرة
          </small>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-mark">
            <span className="live-dot" /> مطبخي{" "}
            <span className="v2-role-badge">{roleLabel(user?.role)}</span>
          </div>
          <div className="topbar-controls">
            {!(user?.role === "developer" && location === "/developer") && (
              <div className="v2-branch-bar">
              <label htmlFor="active-branch">
                {isSystemAdmin ? "فرع المتابعة" : "الفرع"}
              </label>
              <select
                id="active-branch"
                className="v2-branch-select"
                value={activeBranchId ?? ""}
                disabled={!isSystemAdmin || isLoading}
                onChange={event =>
                  setActiveBranchId(
                    event.target.value ? Number(event.target.value) : null
                  )
                }
              >
                <option value="">
                  {isLoading
                    ? "جارٍ تحميل الفروع…"
                    : isSystemAdmin
                      ? "الإدارة العامة — اختر فرعًا للمتابعة"
                      : "فرع الحساب"}
                </option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.city ? ` — ${branch.city}` : ""}
                  </option>
                ))}
              </select>
              </div>
            )}
            <button
              type="button"
              className={`sound-toggle ${enabled ? "enabled" : ""}`}
              onClick={toggle}
              aria-pressed={enabled}
            >
              {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {enabled ? "الصوت مفعّل" : "تفعيل الصوت"}
            </button>
            {user && <StaffFeedbackButton />}
            <div className="topbar-account" aria-label="الحساب الحالي">
              <div className="topbar-identity">
                <span className="topbar-account-label">
                  الحساب الحالي · {roleLabel(user?.role)}
                </span>
                <strong className="topbar-user" title={user?.displayName}>
                  {user?.displayName}
                </strong>
                <span className="topbar-username" dir="auto">
                  @{user?.username}
                </span>
              </div>
              <button
                type="button"
                className="logout-button"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                aria-busy={logout.isPending}
              >
                <LogOut size={17} aria-hidden="true" />
                {logout.isPending ? "جارٍ الخروج…" : "تسجيل الخروج"}
              </button>
            </div>
          </div>
        </header>
        <div className="page-content">
          <div className="v2-context-strip">
            <span>
              {isSystemAdmin
                ? "الإدارة العامة — حساب مستقل عن الفروع"
                : (activeBranch?.name ?? "فرع الحساب")}
            </span>
            {activeBranch && isSystemAdmin && (
              <>
                <span>•</span>
                <span>متابعة {activeBranch.name}</span>
              </>
            )}
            <span>•</span>
            <span>{roleLabel(user?.role)}</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
function defaultLink(user: StaffClientUser) {
  if (user.role === "developer") return "/developer";
  return user.canManager ||
    [
      "system_admin",
      "branch_manager",
      "kitchen_manager",
      "shift_manager",
    ].includes(user.role ?? "")
    ? "/manager"
    : user.canStation || user.role === "station"
      ? "/"
      : "/kitchen";
}
