import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect, type ReactNode } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import KitchenOrderAnnouncer from "./components/KitchenOrderAnnouncer";
import LiveBroadcastReceiver from "./components/LiveBroadcastReceiver";
import NativeAppBridge from "./components/NativeAppBridge";
import KitchenLayout from "./components/KitchenLayout";
import {
  ChangePasswordScreen,
  defaultStaffPath,
  canOpenPath,
  LoginScreen,
  type SectionPermission,
  type StaffClientUser,
} from "./components/AuthViews";
import { KitchenAudioProvider } from "./contexts/KitchenAudioContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { BranchProvider, useBranch } from "./contexts/BranchContext";
import { trpc } from "@/lib/trpc";
import Home from "./pages/Home";
import Kitchen from "./pages/Kitchen";
import Manager from "./pages/Manager";
import Communications from "./pages/Communications";
import Notifications from "./pages/Notifications";
import Reports from "./pages/Reports";
import Developer from "./pages/Developer";
import DeveloperReports from "./pages/DeveloperReports";
import DeveloperIssues from "./pages/DeveloperIssues";
import DeveloperReleases from "./pages/DeveloperReleases";
import DeveloperFeatures from "./pages/DeveloperFeatures";
import DeveloperProfile from "./pages/DeveloperProfile";
import "./v2.css";
import "./developer.css";

function RequireSection({
  permission,
  children,
}: {
  permission?: SectionPermission;
  children: ReactNode;
}) {
  const [location, setLocation] = useLocation();
  const session = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchInterval: 15000,
  });
  const user = session.data as StaffClientUser | null | undefined;
  const allowed = user && (!permission || canOpenPath(user, location));
  useEffect(() => {
    if (user && !user.mustChangePassword && !allowed)
      setLocation(defaultStaffPath(user));
  }, [user, allowed, setLocation]);
  if (session.isLoading)
    return (
      <div className="auth-loading" dir="rtl">
        جارٍ التحقق من الحساب…
      </div>
    );
  if (session.isError)
    return (
      <div className="auth-loading" dir="rtl">
        تعذر الاتصال بالخادم. أعد تحميل الصفحة وحاول مجددًا.
      </div>
    );
  if (!user) return <LoginScreen redirectTo={location} />;
  if (user.mustChangePassword)
    return <ChangePasswordScreen redirectTo={location} />;
  if (!allowed)
    return (
      <div className="auth-loading" dir="rtl">
        جارٍ تحويلك إلى القسم المصرّح به…
      </div>
    );
  return children;
}
function RoutedShell({ children }: { children: ReactNode }) {
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data as
    | StaffClientUser
    | null
    | undefined;
  return (
    <BranchProvider user={user}>
      <KitchenOrderAnnouncer />
      <LiveBroadcastReceiver />
      <NativeAppBridge />
      <KitchenLayout>
        <BranchScopedContent>{children}</BranchScopedContent>
      </KitchenLayout>
    </BranchProvider>
  );
}
function BranchScopedContent({ children }: { children: ReactNode }) {
  const { isSystemAdmin, activeBranchId } = useBranch();
  const [location, setLocation] = useLocation();
  if (
    isSystemAdmin &&
    !activeBranchId &&
    ["/", "/kitchen", "/communications"].includes(location)
  ) {
    return (
      <section className="manager-section">
        <div className="manager-section-head">
          <div>
            <h2>اختر الفرع الذي تريد متابعته</h2>
            <p>
              حسابك في الإدارة العامة مستقل عن الفروع. اختر فرعًا من الشريط
              العلوي أو من صفحة الإدارة العامة قبل تشغيل هذا القسم.
            </p>
          </div>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => setLocation("/manager")}
        >
          فتح الإدارة العامة
        </button>
      </section>
    );
  }
  return children;
}
function Router() {
  const [location] = useLocation();
  if (
    ![
      "/",
      "/kitchen",
      "/manager",
      "/communications",
      "/notifications",
      "/reports",
      "/developer",
      "/developer/reports",
      "/developer/issues",
      "/developer/releases",
      "/developer/features",
      "/developer/profile",
    ].includes(location)
  )
    return <NotFound />;
  const permission: SectionPermission | undefined =
      location === "/"
      ? "canStation"
      : location === "/kitchen"
        ? "canKitchen"
              : location === "/manager" || location === "/reports"
        ? "canManager"
        : location.startsWith("/developer")
          ? "developer"
          : undefined;
  return (
    <RequireSection permission={permission}>
      <RoutedShell>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/kitchen" component={Kitchen} />
          <Route path="/manager" component={Manager} />
          <Route path="/communications" component={Communications} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/reports" component={Reports} />
          <Route path="/developer/reports" component={DeveloperReports} />
          <Route path="/developer/issues" component={DeveloperIssues} />
          <Route path="/developer/releases" component={DeveloperReleases} />
          <Route path="/developer/features" component={DeveloperFeatures} />
          <Route path="/developer/profile" component={DeveloperProfile} />
          <Route path="/developer" component={Developer} />
          <Route component={NotFound} />
        </Switch>
      </RoutedShell>
    </RequireSection>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <KitchenAudioProvider>
          <TooltipProvider>
            <Toaster richColors position="top-center" />
            <Router />
          </TooltipProvider>
        </KitchenAudioProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
