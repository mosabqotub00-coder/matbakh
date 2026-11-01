import { useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  CheckCircle2,
  CircleDashed,
  Loader2,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { useBranch } from "@/contexts/BranchContext";
import StaffAccountsPanel from "@/components/StaffAccountsPanel";
import PendingSignupsPanel from "@/components/PendingSignupsPanel";
import "@/global-administration.css";

type GlobalAdministrationProps = {
  branchManagement: ReactNode;
};

type AdministrationTab = "branches" | "system" | "branchManagers" | "signups";

export default function GlobalAdministration({
  branchManagement,
}: GlobalAdministrationProps) {
  const [activeTab, setActiveTab] = useState<AdministrationTab>("branches");
  const { branches, isLoading, activeBranchId, setActiveBranchId } = useBranch();

  return (
    <main className="global-administration" dir="rtl">
      <header className="global-administration__header">
        <div className="global-administration__heading">
          <span className="global-administration__eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            نطاق النظام
          </span>
          <h1>الإدارة العامة</h1>
          <p>
            هذا الحساب مستقل عن الفروع. اختر فرعًا لإدارة سياقه مؤقتًا دون تغيير
            الحساب أو الانتقال إلى صفحة أخرى.
          </p>
        </div>
        <Link className="global-administration__notifications" href="/notifications">
          <Bell size={17} aria-hidden="true" />
          إعداد الإشعارات
        </Link>
      </header>

      <nav className="global-administration__tabs" aria-label="أقسام الإدارة العامة">
        <button
          type="button"
          className={activeTab === "branches" ? "is-active" : ""}
          aria-selected={activeTab === "branches"}
          onClick={() => setActiveTab("branches")}
        >
          <Building2 size={18} aria-hidden="true" />
          <span>الفروع</span>
        </button>
        <button
          type="button"
          className={activeTab === "system" ? "is-active" : ""}
          aria-selected={activeTab === "system"}
          onClick={() => setActiveTab("system")}
        >
          <Users size={18} aria-hidden="true" />
          <span>حسابات الإدارة العليا</span>
        </button>
        <button
          type="button"
          className={activeTab === "branchManagers" ? "is-active" : ""}
          aria-selected={activeTab === "branchManagers"}
          onClick={() => setActiveTab("branchManagers")}
        >
          <UserCog size={18} aria-hidden="true" />
          <span>مديرو الفروع</span>
        </button>
        <button
          type="button"
          data-testid="admin-tab-signups"
          className={activeTab === "signups" ? "is-active" : ""}
          aria-selected={activeTab === "signups"}
          onClick={() => setActiveTab("signups")}
        >
          <UserPlus size={18} aria-hidden="true" />
          <span>طلبات التسجيل</span>
        </button>
      </nav>

      <section className="global-administration__content" aria-live="polite">
        {activeTab === "branches" ? (
          <div className="global-administration__branches-view">
            <div className="global-administration__section-heading">
              <div>
                <h2>اختيار سياق الفرع</h2>
                <p>التحديد مؤقت لجلسة الإدارة العامة ولا يغيّر الحساب أو مساره.</p>
              </div>
              <span className="global-administration__scope-badge">
                <CircleDashed size={15} aria-hidden="true" />
                بلا فرع افتراضي
              </span>
            </div>

            {isLoading ? (
              <div className="global-administration__state" role="status">
                <Loader2 className="global-administration__spin" size={22} aria-hidden="true" />
                جارٍ تحميل الفروع…
              </div>
            ) : branches.length === 0 ? (
              <div className="global-administration__state global-administration__state--empty">
                <Building2 size={25} aria-hidden="true" />
                <strong>لا توجد فروع بعد</strong>
                <span>يمكنك إضافة الفروع وإدارتها من القسم أدناه.</span>
              </div>
            ) : (
              <div className="global-administration__branch-grid">
                {branches.map(branch => {
                  const isSelected = activeBranchId === branch.id;
                  const receivesOrders = branch.ordersEnabled !== false;

                  return (
                    <article
                      className={`global-administration__branch-card ${isSelected ? "is-selected" : ""}`}
                      key={branch.id}
                    >
                      <div className="global-administration__branch-card-top">
                        <span className="global-administration__branch-icon">
                          <Building2 size={21} aria-hidden="true" />
                        </span>
                        <span
                          className={`global-administration__receiving-status ${receivesOrders ? "is-receiving" : "is-stopped"}`}
                        >
                          <span aria-hidden="true" />
                          {receivesOrders ? "يستقبل الطلبات" : "لا يستقبل الطلبات"}
                        </span>
                      </div>
                      <h3>{branch.name}</h3>
                      {branch.city ? <p>{branch.city}</p> : null}
                      <button
                        type="button"
                        className="global-administration__select-branch"
                        aria-pressed={isSelected}
                        onClick={() => setActiveBranchId(branch.id)}
                      >
                        {isSelected ? (
                          <>
                            <CheckCircle2 size={18} aria-hidden="true" />
                            الفرع المحدد للإدارة
                          </>
                        ) : (
                          <>
                            <Building2 size={18} aria-hidden="true" />
                            إدارة هذا الفرع
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="global-administration__branch-management">
              <div className="global-administration__subheading">
                <div>
                  <h2>إدارة الفروع</h2>
                  <p>إضافة الفروع وتحديث حالة استقبال الطلبات من المكوّن المخصص.</p>
                </div>
              </div>
              {branchManagement}
            </div>
          </div>
        ) : activeTab === "system" ? (
          <section className="global-administration__panel">
            <div className="global-administration__section-heading">
              <div>
                <h2>حسابات الإدارة العليا</h2>
                <p>حسابات مستقلة عن أي فرع ضمن نطاق النظام.</p>
              </div>
              <Users size={23} aria-hidden="true" />
            </div>
            <StaffAccountsPanel scope="system" />
          </section>
        ) : activeTab === "signups" ? (
          <PendingSignupsPanel />
        ) : (
          <section className="global-administration__panel">
            <div className="global-administration__section-heading">
              <div>
                <h2>مديرو الفروع</h2>
                <p>إدارة حسابات مديري الفروع من نطاق النظام العام.</p>
              </div>
              <UserCog size={23} aria-hidden="true" />
            </div>
            <StaffAccountsPanel scope="branch_managers" />
          </section>
        )}
      </section>
    </main>
  );
}
