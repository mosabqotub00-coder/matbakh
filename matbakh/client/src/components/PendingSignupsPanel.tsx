import { useState } from "react";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import { ROLE_LABELS } from "@/components/AuthViews";

const APPROVABLE_ROLES = ["station", "kitchen", "shift_manager", "kitchen_manager", "branch_manager", "system_admin"] as const;
type ApprovableRole = (typeof APPROVABLE_ROLES)[number];
type Signup = { id: number; username: string; displayName: string; email: string | null; createdAt: Date };

function SignupRow({ signup }: { signup: Signup }) {
  const utils = trpc.useUtils();
  const { branches } = useBranch();
  const [role, setRole] = useState<ApprovableRole>("station");
  const [branchId, setBranchId] = useState<number | "">("");
  const refresh = () => { void utils.staff.pendingSignups.invalidate(); void utils.staff.list.invalidate(); };
  const approve = trpc.staff.approveSignup.useMutation({ onSuccess: () => { toast.success("تمت الموافقة على الحساب."); refresh(); }, onError: error => toast.error(error.message) });
  const reject = trpc.staff.rejectSignup.useMutation({ onSuccess: () => { toast.success("تم رفض الطلب."); refresh(); }, onError: error => toast.error(error.message) });
  const global = role === "system_admin";
  return (
    <article className="staff-account-card" data-testid={`pending-signup-${signup.id}`}>
      <div className="staff-account-identity">
        <span className="staff-avatar">{signup.displayName.slice(0, 1)}</span>
        <div><strong>{signup.displayName}</strong><small dir="ltr">{signup.email}</small></div>
        <span className="product-state off">بانتظار الموافقة</span>
      </div>
      <div className="staff-role-list">
        <select data-testid={`pending-signup-role-${signup.id}`} value={role} onChange={event => setRole(event.target.value as ApprovableRole)}>
          {APPROVABLE_ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
        </select>
        {!global && (
          <select data-testid={`pending-signup-branch-${signup.id}`} value={branchId} onChange={event => setBranchId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">اختر الفرع</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
      </div>
      <div className="staff-account-actions">
        <button type="button" className="primary-action" data-testid={`pending-signup-approve-${signup.id}`} disabled={approve.isPending || (!global && !branchId)}
          onClick={() => approve.mutate({ id: signup.id, role, branchId: global ? null : Number(branchId) })}>
          <Check size={16} /> موافقة
        </button>
        <button type="button" className="secondary-action" data-testid={`pending-signup-reject-${signup.id}`} disabled={reject.isPending}
          onClick={() => { if (window.confirm("رفض الطلب وحذفه؟")) reject.mutate({ id: signup.id }); }}>
          <X size={16} /> رفض
        </button>
      </div>
    </article>
  );
}

export default function PendingSignupsPanel() {
  const signups = trpc.staff.pendingSignups.useQuery();
  return (
    <section className="global-administration__panel" data-testid="pending-signups-panel">
      <div className="global-administration__section-heading">
        <div><h2>طلبات التسجيل الجديدة</h2><p>من سجّل بالبريد لا يدخل قبل موافقتك. اختر الدور والفرع ثم وافق.</p></div>
        <UserPlus size={23} aria-hidden="true" />
      </div>
      <div className="staff-account-list">
        {signups.isLoading ? <div className="empty-state"><Loader2 size={16} /> جارٍ التحميل…</div>
          : signups.isError ? <div className="empty-state" role="alert">{signups.error.message}</div>
          : signups.data?.length ? signups.data.map(signup => <SignupRow key={signup.id} signup={signup} />)
          : <div className="empty-state" data-testid="pending-signups-empty">لا توجد طلبات بانتظار الموافقة.</div>}
      </div>
    </section>
  );
}
