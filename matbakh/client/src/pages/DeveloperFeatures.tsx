import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import DeveloperSectionLayout from "./DeveloperSectionLayout";

const supported = [{ key: "reports_v1", name: "التقارير والتحليلات", note: "تشغيل صفحة التقارير للفروع المحددة" }, { key: "advanced_feedback", name: "الملاحظات المتقدمة", note: "استقبال صورة أو صوت مع ملاحظة الموظف" }, { key: "fast_products", name: "الأصناف السريعة", note: "أصناف بلا مؤقت أو تنبيه تأخير" }, { key: "push_notifications", name: "إشعارات الهاتف", note: "تفعيل تسجيل جهاز الحساب للإشعارات" }];
export default function DeveloperFeatures() {
  const dashboard = trpc.developer.dashboard.useQuery();
  const branches = trpc.branches.list.useQuery();
  const [feature, setFeature] = useState(supported[0]);
  const [target, setTarget] = useState<"developer" | "branch" | "all">("developer");
  const [branchId, setBranchId] = useState<number | null>(null);
  const mutation = trpc.developer.featureUpsert.useMutation({ onSuccess: () => { toast.success("تم حفظ نطاق الميزة."); void dashboard.refetch(); }, onError: error => toast.error(error.message) });
  return <DeveloperSectionLayout title="مفاتيح الميزات" description="تفعيل ميزة موجودة في الكود للمطوّر أو فرع محدد أو كل الفروع. المفتاح وحده لا ينشئ كودًا جديدًا.">
    <section className="manager-section developer-feature-warning"><h2>قبل التفعيل</h2><p>هذه الصفحة تتحكم في ميزات مدعومة مسبقًا داخل النظام. لا تكتب اسمًا عشوائيًا وتتوقع أن تُبنى صفحة جديدة تلقائيًا؛ إضافة ميزة جديدة تحتاج تطوير الكود أولًا ثم تسجيل مفتاحها هنا.</p></section>
    <section className="manager-section"><div className="developer-feature-catalog">{supported.map(item => <button type="button" className={feature.key === item.key ? "active" : ""} key={item.key} onClick={() => setFeature(item)}><strong>{item.name}</strong><code>{item.key}</code><small>{item.note}</small></button>)}</div><form className="developer-inline-form" onSubmit={event => { event.preventDefault(); if (target === "branch" && !branchId) return toast.error("اختر الفرع."); mutation.mutate({ featureKey: feature.key, displayName: feature.name, description: feature.note, target, branchId: target === "branch" ? branchId : null, enabled: true }); }}><label><span>نطاق التفعيل</span><select value={target} onChange={event => setTarget(event.target.value as typeof target)}><option value="developer">المطوّر فقط</option><option value="branch">فرع محدد</option><option value="all">كل الفروع</option></select></label>{target === "branch" && <label><span>الفرع</span><select value={branchId ?? ""} onChange={event => setBranchId(event.target.value ? Number(event.target.value) : null)}><option value="">اختر فرعًا</option>{branches.data?.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}<button className="primary-action" type="submit" disabled={mutation.isPending}><Flag size={16} /> {mutation.isPending ? "جارٍ الحفظ…" : "تفعيل الميزة"}</button></form></section>
    <section className="manager-section"><h2>التفعيلات المحفوظة</h2><div className="developer-list">{dashboard.data?.flags.length ? dashboard.data.flags.map(flag => <article className="developer-row" key={flag.id}><div><strong>{flag.displayName}</strong><span><code>{flag.featureKey}</code> · {flag.target === "developer" ? "المطوّر" : flag.target === "all" ? "كل الفروع" : `فرع ${flag.branchId}`} · {flag.enabled ? "مفعلة" : "متوقفة"}</span></div><button type="button" onClick={() => mutation.mutate({ id: flag.id, featureKey: flag.featureKey, displayName: flag.displayName, description: flag.description, target: flag.target, branchId: flag.branchId, enabled: !flag.enabled })}>{flag.enabled ? "إيقاف" : "تفعيل"}</button></article>) : <p className="empty-state">لا توجد تفعيلات محفوظة.</p>}</div></section>
  </DeveloperSectionLayout>;
}
