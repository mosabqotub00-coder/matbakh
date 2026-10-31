import { useEffect, useState, type FormEvent } from "react";
import {
  KeyRound,
  Pencil,
  Power,
  Save,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { StaffRole } from "../../../shared/roles";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import { ROLE_LABELS, type StaffClientUser } from "./AuthViews";

type Scope = "system" | "branch_managers" | "branch";
type Account = inferRouterOutputs<AppRouter>["staff"]["list"]["users"][number];
type UsualShift = "morning" | "evening" | "flexible";
type FormState = {
  username: string;
  displayName: string;
  password: string;
  role: StaffRole;
  usualShift: UsualShift | null;
  branchId: number | null;
  isActive: boolean;
};
function emptyForm(scope: Scope, branchId?: number): FormState {
  return {
    username: "",
    displayName: "",
    password: "",
    usualShift: null,
    role:
      scope === "system"
        ? "system_admin"
        : scope === "branch_managers"
          ? "branch_manager"
          : "station",
    branchId: scope === "system" ? null : (branchId ?? null),
    isActive: true,
  };
}

export default function StaffAccountsPanel({
  scope = "branch",
}: {
  scope?: Scope;
}) {
  const { branches, activeBranchId, isSystemAdmin: systemAdmin } = useBranch();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const currentUser = trpc.auth.me.useQuery(undefined, { retry: false })
    .data as StaffClientUser | null | undefined;
  const canManage = Boolean(
    currentUser &&
      (systemAdmin ||
        (scope === "branch" && currentUser.role === "branch_manager"))
  );
  const accounts = trpc.staff.list.useQuery(
    {
      scope,
      ...(scope === "branch" && activeBranchId
        ? { branchId: activeBranchId }
        : {}),
    },
    {
      enabled: canManage && (scope !== "branch" || Boolean(activeBranchId)),
      refetchInterval: 15000,
    }
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(scope, activeBranchId)
  );
  useEffect(() => {
    setEditingId(null);
    setForm(emptyForm(scope, activeBranchId));
  }, [scope, activeBranchId, currentUser?.id]);
  function reset() {
    setEditingId(null);
    setForm(emptyForm(scope, activeBranchId));
  }
  const create = trpc.staff.create.useMutation({
    onSuccess: async () => {
      await utils.staff.list.invalidate();
      toast.success("تم إنشاء الحساب المستقل.");
      reset();
    },
    onError: error => toast.error(error.message),
  });
  const update = trpc.staff.update.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.staff.list.invalidate();
      toast.success("تم حفظ تعديلات الحساب.");
      if (variables.id === currentUser?.id) {
        await utils.auth.me.invalidate();
        if (variables.password || variables.isActive === false)
          setLocation("/manager");
      }
      reset();
    },
    onError: error => toast.error(error.message),
  });
  const roleOptions: StaffRole[] =
    scope === "system"
      ? ["system_admin"]
      : scope === "branch_managers"
        ? ["branch_manager"]
        : systemAdmin
          ? [
              "branch_manager",
              "kitchen_manager",
              "shift_manager",
              "station",
              "kitchen",
            ]
          : ["kitchen_manager", "shift_manager", "station", "kitchen"];
  function startEdit(account: Account) {
    setEditingId(account.id);
    setForm({
      username: account.username,
      displayName: account.displayName,
      password: "",
      role: account.role,
      usualShift: account.usualShift ?? null,
      branchId: account.role === "system_admin" ? null : account.branchId,
      isActive: account.isActive,
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!roleOptions.includes(form.role))
      return toast.error("اختر دورًا ضمن نطاق هذه الصفحة.");
    const branchId =
      form.role === "system_admin"
        ? null
        : systemAdmin
          ? form.branchId
          : (activeBranchId ?? null);
    if (form.role !== "system_admin" && !branchId)
      return toast.error("اختر فرع الحساب أولًا.");
    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      role: form.role,
      usualShift: form.usualShift,
      branchId,
    };
    if (editingId)
      update.mutate({
        id: editingId,
        ...payload,
        isActive: form.isActive,
        ...(form.password ? { password: form.password } : {}),
      });
    else create.mutate({ ...payload, password: form.password });
  }
  if (!canManage)
    return (
      <section className="manager-section">
        <p className="v2-readonly-note">
          إدارة الحسابات العامة ومديري الفروع للمدير الأعلى فقط، وموظفي الفرع
          لمديره المخوّل.
        </p>
      </section>
    );
  if (scope === "branch" && !activeBranchId)
    return <p className="v2-readonly-note">اختر فرعًا لعرض حساباته.</p>;
  const title =
    scope === "system"
      ? "حسابات الإدارة العليا"
      : scope === "branch_managers"
        ? "حسابات مديري الفروع"
        : "حسابات الفرع وأدواره";
  const description =
    scope === "system"
      ? "حسابات عامة لا تتبع فيصل أو أي فرع، ولا تظهر ضمن موظفي الفرع."
      : scope === "branch_managers"
        ? "لكل مدير فرع حساب مستقل مرتبط بفرعه؛ لا تُستخدم حسابات الإدارة العليا لإدارة فرع بصفة مديره."
        : "موظفو الفرع ومديره منفصلون عن حسابات الإدارة العليا.";
  const busy = create.isPending || update.isPending;
  return (
    <section className="manager-section staff-section">
      <div className="manager-section-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="count-badge">
          <Users size={14} /> {accounts.data?.activeCount ?? 0} فعال /{" "}
          {accounts.data?.total ?? 0}
        </span>
      </div>
      <div className="staff-layout">
        <form className="staff-form-card" onSubmit={submit}>
          <div className="staff-form-heading">
            <span className="section-icon green">
              {editingId ? <Pencil size={17} /> : <UserRoundPlus size={17} />}
            </span>
            <div>
              <strong>{editingId ? "تعديل حساب" : "إضافة حساب مستقل"}</strong>
              <small>
                {scope === "system"
                  ? "الإدارة العامة — دون فرع"
                  : "اختر الدور والفرع الصحيحين"}
              </small>
            </div>
          </div>
          <label>
            <span>اسم صاحب الحساب</span>
            <input
              required
              maxLength={120}
              value={form.displayName}
              onChange={event =>
                setForm(value => ({
                  ...value,
                  displayName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>اسم المستخدم</span>
            <input
              required
              minLength={3}
              maxLength={64}
              value={form.username}
              onChange={event =>
                setForm(value => ({ ...value, username: event.target.value }))
              }
              autoComplete="off"
            />
          </label>
          <label>
            <span>
              {editingId ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور المؤقتة"}
            </span>
            <div className="staff-password-input">
              <KeyRound size={15} />
              <input
                type="password"
                minLength={10}
                maxLength={128}
                required={!editingId}
                value={form.password}
                onChange={event =>
                  setForm(value => ({ ...value, password: event.target.value }))
                }
                autoComplete="new-password"
              />
            </div>
          </label>
          <label>
            <span>الدور</span>
            <select
              value={form.role}
              onChange={event =>
                setForm(value => ({
                  ...value,
                  role: event.target.value as StaffRole,
                }))
              }
            >
              {roleOptions.map(role => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الوردية المعتادة (اختياري)</span>
            <select
              value={form.usualShift ?? ""}
              onChange={event =>
                setForm(value => ({
                  ...value,
                  usualShift: (event.target.value || null) as UsualShift | null,
                }))
              }
            >
              <option value="">بدون تحديد</option>
              <option value="morning">صباحي</option>
              <option value="evening">مسائي</option>
              <option value="flexible">مرن — صباحي أو مسائي</option>
            </select>
            <small className="staff-field-note">معلومة تنظيمية فقط ولا تمنع تغيير وقت عمل الموظف.</small>
          </label>
          {scope === "system" ? (
            <p className="staff-hint">
              هذا الحساب مستقل عن جميع الفروع؛ اختيار فرع للمتابعة لا يربطه به.
            </p>
          ) : systemAdmin ? (
            <label>
              <span>فرع الحساب</span>
              <select
                required
                value={form.branchId ?? ""}
                onChange={event =>
                  setForm(value => ({
                    ...value,
                    branchId: event.target.value
                      ? Number(event.target.value)
                      : null,
                  }))
                }
              >
                <option value="">اختر الفرع</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="staff-hint">
              فرع الحساب:{" "}
              {branches.find(branch => branch.id === activeBranchId)?.name}
            </p>
          )}
          {editingId && (
            <label className="staff-active-option">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={event =>
                  setForm(value => ({
                    ...value,
                    isActive: event.target.checked,
                  }))
                }
              />
              <span>الحساب فعّال</span>
            </label>
          )}
          <div className="staff-form-actions">
            <button type="submit" className="primary-action" disabled={busy}>
              <Save size={15} />
              {editingId ? "حفظ التعديل" : "إنشاء الحساب"}
            </button>
            {editingId && (
              <button
                type="button"
                className="secondary-action"
                onClick={reset}
              >
                <X size={15} /> إلغاء
              </button>
            )}
          </div>
        </form>
        <div className="staff-account-list">
          {accounts.isLoading ? (
            <div className="empty-state">جارٍ تحميل الحسابات…</div>
          ) : accounts.isError ? (
            <div className="empty-state" role="alert">
              تعذر تحميل الحسابات: {accounts.error.message}
            </div>
          ) : accounts.data?.users.length ? (
            accounts.data.users.map(account => (
              <article
                className={`staff-account-card ${!account.isActive ? "inactive" : ""}`}
                key={account.id}
              >
                <div className="staff-account-identity">
                  <span className="staff-avatar">
                    {account.displayName.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{account.displayName}</strong>
                    <small>@{account.username}</small>
                  </div>
                  <span
                    className={`product-state ${account.isActive ? "on" : "off"}`}
                  >
                    {account.isActive ? "فعّال" : "موقوف"}
                  </span>
                </div>
                <div className="staff-role-list">
                  <span>{ROLE_LABELS[account.role]}</span>
                  {account.usualShift && (
                    <span>
                      الوردية المعتادة: {
                        account.usualShift === "morning"
                          ? "صباحي"
                          : account.usualShift === "evening"
                            ? "مسائي"
                            : "مرن"
                      }
                    </span>
                  )}
                  <span>
                    {account.role === "system_admin"
                      ? "الإدارة العامة — غير مرتبط بفرع"
                      : (branches.find(branch => branch.id === account.branchId)
                          ?.name ?? "فرع الحساب")}
                  </span>
                </div>
                {account.mustChangePassword && (
                  <p className="staff-hint">التغيير مطلوب عند أول دخول</p>
                )}
                <div className="staff-account-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(account)}
                  >
                    <Pencil size={14} /> تعديل
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={account.isActive ? "danger" : "success"}
                    onClick={() =>
                      update.mutate({
                        id: account.id,
                        isActive: !account.isActive,
                      })
                    }
                  >
                    <Power size={14} />
                    {account.isActive ? "إيقاف الحساب" : "إعادة التفعيل"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-banner">
              <span className="empty-banner-icon">
                <Users size={18} />
              </span>
              <div>
                <strong>لا توجد حسابات في هذا النطاق</strong>
                <p>
                  أضف حسابًا مستقلًا من النموذج دون مشاركة حساب الإدارة العليا.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="manager-tip">
        <KeyRound size={15} />
        <span>
          مدير الفرع لا ينشئ مدير نظام أو مدير فرع. لا تُعرض كلمات المرور، ولا
          يمكن تعطيل آخر مدير نظام فعال.
        </span>
      </div>
    </section>
  );
}
