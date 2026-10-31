import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Code2, Flag, RefreshCw, ShieldCheck, UploadCloud, UserCircle, Bug } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const cards = [
  { href: "/developer/reports", icon: BarChart3, title: "التقارير والتحليلات", description: "طلبات وكميات وتأخير وأداء كل فرع مع رسوم ومقارنات.", tone: "green" },
  { href: "/developer/issues", icon: Bug, title: "الأخطاء والملاحظات", description: "كل أخطاء النظام وملاحظات الموظفين والصور والتسجيلات.", tone: "red" },
  { href: "/developer/releases", icon: UploadCloud, title: "مختبر الإصدارات", description: "رفع ZIP وفحصه ومراجعة نتيجة الفحص بوضوح.", tone: "blue" },
  { href: "/developer/features", icon: Flag, title: "مفاتيح الميزات", description: "تفعيل الميزات المدعومة للمطوّر أو فرع أو جميع الفروع.", tone: "purple" },
  { href: "/developer/profile", icon: UserCircle, title: "ملف المطوّر", description: "بيانات الحساب وكلمة المرور في صفحة مستقلة.", tone: "amber" },
] as const;

export default function Developer() {
  const dashboard = trpc.developer.dashboard.useQuery(undefined, { refetchInterval: 15000 });
  const report = trpc.developer.operationsReport.useQuery({ period: "today" }, { refetchInterval: 30000 });
  const [showBranchManagement, setShowBranchManagement] = useState(false);
  const [systemCheck, setSystemCheck] = useState<{ ranAt: string; safe: boolean; checks: Array<{ name: string; status: "passed" | "warning" | "failed"; detail: string }> } | null>(null);
  const check = trpc.developer.systemCheck.useMutation({ onSuccess: result => { setSystemCheck(result); toast.success("اكتمل اختبار النظام الحالي."); }, onError: error => toast.error(error.message) });
  const counts = useMemo(() => ({ errors: dashboard.data?.errors.filter(item => item.status === "new").length ?? 0, feedback: dashboard.data?.feedback.filter(item => item.status === "new").length ?? 0, releases: dashboard.data?.releases.length ?? 0 }), [dashboard.data]);
  const totalOrders = report.data?.branches.reduce((sum, branch) => sum + branch.orderCount, 0) ?? 0;
  return <main className="manager-page developer-page developer-home" dir="rtl">
    <section className="developer-hero"><div><span className="eyebrow-line" /><h1><Code2 size={25} /> مركز المطوّر</h1><p>ملخص عام منظم. افتح كل قسم في صفحته المستقلة دون خلط التفاصيل.</p></div><div className="developer-hero-actions"><button className="secondary-action" type="button" onClick={() => void dashboard.refetch()}><RefreshCw size={16} /> تحديث الملخص</button><button className="primary-action" type="button" onClick={() => check.mutate()} disabled={check.isPending}><ShieldCheck size={16} /> {check.isPending ? "جارٍ الفحص…" : "اختبار النظام"}</button></div></section>
    {systemCheck && <section className="developer-system-report"><div className="developer-system-report-head"><div><h2><ShieldCheck size={19} /> نتيجة آخر اختبار</h2><p>{new Date(systemCheck.ranAt).toLocaleString("ar-SA")}</p></div><strong className={systemCheck.safe ? "inspection-safe" : "inspection-failed"}>{systemCheck.safe ? "لا توجد أخطاء حرجة" : "توجد أخطاء حرجة"}</strong></div><div className="developer-system-checks">{systemCheck.checks.map(item => <div className={`system-check ${item.status}`} key={item.name}><b>{item.status === "passed" ? "✓" : item.status === "failed" ? "!" : "i"}</b><span><strong>{item.name}</strong><small>{item.detail}</small></span></div>)}</div></section>}
    <section className="developer-stat-grid"><article><AlertTriangle size={20} /><strong>{counts.errors}</strong><span>أخطاء جديدة</span></article><article><ShieldCheck size={20} /><strong>{counts.feedback}</strong><span>ملاحظات جديدة</span></article><article><UploadCloud size={20} /><strong>{counts.releases}</strong><span>إصدارات محفوظة</span></article><article><BarChart3 size={20} /><strong>{totalOrders}</strong><span>طلبات اليوم</span></article></section>
    <section className="developer-module-grid">{cards.map(card => { const Icon = card.icon; return <Link href={card.href} className={`developer-module-card ${card.tone}`} key={card.href}><span className="developer-module-icon"><Icon size={23} /></span><span><strong>{card.title}</strong><small>{card.description}</small></span><b>فتح الصفحة ←</b></Link>; })}</section>
    <section className="manager-section developer-control-card"><div className="developer-control-copy"><div className="developer-control-icon"><Building2 size={22} /></div><div><h2>الإدارة العامة والفروع</h2><p>هذه مساحة تشغيلية منفصلة لمتابعة الفروع والطلبات والأصناف والموظفين، وليست جزءًا من صفحات أدوات المطوّر.</p></div></div><button type="button" className="primary-action developer-control-button" onClick={() => setShowBranchManagement(value => !value)}>{showBranchManagement ? "إخفاء الرابط" : "فتح الإدارة العامة"}</button>{showBranchManagement && <div className="developer-management-links"><Link href="/manager" className="developer-management-link"><strong>لوحة الإدارة العامة</strong><span>إدارة الفروع والطلبات والأصناف والحسابات</span></Link><Link href="/notifications" className="developer-management-link"><strong>مركز التنبيهات</strong><span>سجل التنبيهات التشغيلية للفروع</span></Link></div>}</section>
  </main>;
}
