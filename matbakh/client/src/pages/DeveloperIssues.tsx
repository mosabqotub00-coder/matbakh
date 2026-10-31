import { AlertTriangle, Bug, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DeveloperSectionLayout from "./DeveloperSectionLayout";

export default function DeveloperIssues() {
  const dashboard = trpc.developer.dashboard.useQuery(undefined, { refetchInterval: 10000 });
  const utils = trpc.useUtils();
  const update = trpc.developer.issueUpdate.useMutation({ onSuccess: () => void utils.developer.dashboard.invalidate(), onError: error => toast.error(error.message) });
  if (dashboard.isLoading) return <DeveloperSectionLayout title="الأخطاء والملاحظات" description="متابعة كل ما يصل من النظام والفروع."><section className="manager-section"><p>جارٍ تحميل السجل…</p></section></DeveloperSectionLayout>;
  const data = dashboard.data;
  return <DeveloperSectionLayout title="الأخطاء والملاحظات" description="كل مشكلة مرتبطة بفرع وحساب ووقت ورقم طلب إن وُجد.">
    <section className="developer-report-cards"><article><strong>{data?.errors.filter(item => item.status === "new").length ?? 0}</strong><span>أخطاء جديدة</span></article><article><strong>{data?.feedback.filter(item => item.status === "new").length ?? 0}</strong><span>ملاحظات جديدة</span></article></section>
    <div className="developer-columns"><section className="manager-section"><h2><AlertTriangle size={19} /> الأخطاء التقنية</h2>{data?.errors.length ? data.errors.map(item => <article className="developer-issue" key={item.id}><strong>{item.source} · {item.severity}</strong><p>{item.message}</p><small>فرع {item.branchId ?? "عام"} · {new Date(item.createdAt).toLocaleString("ar-SA")}</small>{item.status === "new" && <button type="button" onClick={() => update.mutate({ kind: "error", id: item.id, status: "resolved" })}>تحديد كمحلول</button>}</article>) : <p className="empty-state">لا توجد أخطاء محفوظة.</p>}</section><section className="manager-section"><h2><ShieldCheck size={19} /> ملاحظات الموظفين</h2>{data?.feedback.length ? data.feedback.map(item => <article className="developer-issue" key={item.id}><strong>{item.title} · {item.priority}</strong><p>{item.description}</p><small>فرع {item.branchId ?? "عام"} · {new Date(item.createdAt).toLocaleString("ar-SA")}{item.attachmentName ? ` · مرفق: ${item.attachmentName}` : ""}</small>{item.status === "new" && <button type="button" onClick={() => update.mutate({ kind: "feedback", id: item.id, status: "investigating" })}>بدء المتابعة</button>}</article>) : <p className="empty-state">لا توجد ملاحظات محفوظة.</p>}</section></div>
  </DeveloperSectionLayout>;
}
