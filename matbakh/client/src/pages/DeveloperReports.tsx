import { useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import DeveloperSectionLayout from "./DeveloperSectionLayout";

export default function DeveloperReports() {
  const [period, setPeriod] = useState<"today" | "7days" | "30days">("7days");
  const report = trpc.developer.operationsReport.useQuery({ period }, { refetchInterval: 30000 });
  const branches = report.data?.branches ?? [];
  const maxOrders = Math.max(1, ...branches.map(branch => branch.orderCount));
  const maxQuantity = Math.max(1, ...branches.map(branch => branch.quantity));
  return <DeveloperSectionLayout title="التقارير والتحليلات" description="تحليل فعلي للطلبات والكميات والتأخير والأخطاء وملاحظات الموظفين حسب الفرع والفترة.">
    <section className="manager-section developer-report-toolbar"><div><h2>الفترة والتحليل</h2><p>الأرقام تُقرأ مباشرة من قاعدة البيانات وليست بيانات تجريبية ثابتة.</p></div><div><select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="today">اليوم</option><option value="7days">آخر 7 أيام</option><option value="30days">آخر 30 يومًا</option></select><button className="secondary-action" type="button" onClick={() => void report.refetch()} disabled={report.isFetching}><RefreshCw size={15} /> تحديث التقرير</button></div></section>
    {report.isLoading ? <section className="manager-section"><p className="empty-state">جارٍ إعداد التقرير…</p></section> : report.isError ? <section className="manager-section"><p className="error-state">تعذر إعداد التقرير: {report.error.message}</p></section> : <>
      <section className="developer-report-cards"><article><strong>{branches.reduce((sum, branch) => sum + branch.orderCount, 0)}</strong><span>إجمالي الطلبات</span></article><article><strong>{branches.reduce((sum, branch) => sum + branch.quantity, 0)}</strong><span>إجمالي الكميات</span></article><article><strong>{branches.reduce((sum, branch) => sum + branch.lateCount, 0)}</strong><span>طلبات متأخرة</span></article><article><strong>{branches.reduce((sum, branch) => sum + branch.errorCount + branch.feedbackCount, 0)}</strong><span>مشاكل وملاحظات</span></article></section>
      <section className="manager-section"><h2><BarChart3 size={19} /> مقارنة الفروع</h2><div className="developer-bar-chart">{branches.map(branch => <div className="developer-bar-row" key={branch.id}><strong>{branch.name}</strong><div><span style={{ width: `${Math.round((branch.orderCount / maxOrders) * 100)}%` }} /><small>{branch.orderCount} طلب · {branch.lateCount} متأخر</small></div></div>)}</div></section>
      <section className="manager-section"><h2>الكميات والأصناف الأكثر طلبًا</h2><div className="developer-bar-chart">{branches.map(branch => <div className="developer-bar-row" key={`quantity-${branch.id}`}><strong>{branch.name}</strong><div><span className="quantity" style={{ width: `${Math.round((branch.quantity / maxQuantity) * 100)}%` }} /><small>{branch.quantity} قطعة · {branch.topProducts.length ? branch.topProducts.map(item => `${item.name} (${item.count})`).join("، ") : "لا توجد أصناف"}</small></div></div>)}</div></section>
      <section className="manager-section"><h2>جدول المتابعة</h2><div className="developer-report-table-wrap"><table className="developer-report-table"><thead><tr><th>الفرع</th><th>الطلبات</th><th>الكميات</th><th>التأخير</th><th>الأخطاء</th><th>الملاحظات</th></tr></thead><tbody>{branches.map(branch => <tr key={`row-${branch.id}`}><th>{branch.name}</th><td>{branch.orderCount}</td><td>{branch.quantity}</td><td>{branch.lateCount}</td><td>{branch.errorCount}</td><td>{branch.feedbackCount}</td></tr>)}</tbody></table></div></section>
    </>}
  </DeveloperSectionLayout>;
}
