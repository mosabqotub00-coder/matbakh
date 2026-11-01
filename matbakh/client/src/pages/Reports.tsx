import { useMemo, useState } from "react";
import { BarChart3, Download, FileDown, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useBranch } from "@/contexts/BranchContext";
import "@/reports.css";

type Preset = "today" | "yesterday" | "7days" | "30days" | "custom";
type Shift = "" | "morning" | "evening";
const SHIFT_LABEL = { morning: "الصباحي", evening: "المسائي" } as const;
const STATUS_LABEL = { new: "جديد", preparing: "قيد التحضير", ready: "جاهز", received: "مُستلم" } as const;
const COLORS = { green: "#27935b", red: "#d9534f", amber: "#e0a33a", blue: "#3b7dd8" };

function rangeFor(preset: Preset, fromDay: string, toDay: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (preset === "today") return { from: start, to: new Date(start.getTime() + day) };
  if (preset === "yesterday") return { from: new Date(start.getTime() - day), to: start };
  if (preset === "7days") return { from: new Date(start.getTime() - 6 * day), to: new Date(start.getTime() + day) };
  if (preset === "30days") return { from: new Date(start.getTime() - 29 * day), to: new Date(start.getTime() + day) };
  const from = new Date(`${fromDay}T00:00:00`); const to = new Date(`${toDay}T00:00:00`);
  return { from, to: new Date(to.getTime() + day) };
}
const fmt = (value: number | null | undefined, unit = "") => (value == null ? "—" : `${value}${unit}`);
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "late" | "good" }) {
  return <article className={`report-kpi ${tone ?? ""}`} data-testid={`report-kpi-${label}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="report-card"><h2>{title}</h2><div className="report-chart">{children}</div></section>;
}

function downloadCsv(rows: Array<Record<string, unknown>>, name: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = "\ufeff" + [headers.join(","), ...rows.map(row => headers.map(key => escape(row[key])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function Reports() {
  const { branches } = useBranch();
  const today = isoDay(new Date());
  const [preset, setPreset] = useState<Preset>("today");
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [branchId, setBranchId] = useState<number | "">("");
  const [shift, setShift] = useState<Shift>("");
  const range = useMemo(() => rangeFor(preset, fromDay, toDay), [preset, fromDay, toDay]);
  const report = trpc.reports.analytics.useQuery({
    from: range.from.toISOString(), to: range.to.toISOString(),
    branchId: branchId || null, shift: shift || null, tzOffsetMinutes: new Date().getTimezoneOffset(),
  }, { refetchInterval: 60000 });
  const data = report.data;
  const branchLabel = branchId ? branches.find(branch => branch.id === branchId)?.name ?? "" : "كل الفروع";
  const shiftLabel = shift ? `الوردية ${SHIFT_LABEL[shift]}` : "كل الورديات";
  const periodLabel = `${range.from.toLocaleDateString("ar")} — ${new Date(range.to.getTime() - 1).toLocaleDateString("ar")}`;

  return <div className="reports-page" dir="rtl" data-testid="reports-page">
    <header className="report-head">
      <div><h1><BarChart3 size={22} /> التقارير والتحليلات</h1><p>{branchLabel} · {shiftLabel} · {periodLabel}</p></div>
      <div className="report-actions no-print">
        <button type="button" className="secondary-action" data-testid="report-refresh" onClick={() => void report.refetch()} disabled={report.isFetching}><RefreshCw size={15} /> تحديث</button>
        <button type="button" className="secondary-action" data-testid="report-csv" disabled={!data?.orders.length} onClick={() => data && downloadCsv(data.orders.map(order => ({ الرمز: order.code, الفرع: order.branch, الوردية: SHIFT_LABEL[order.shift], الحالة: STATUS_LABEL[order.status], "وقت الإنشاء": new Date(order.createdAt).toLocaleString("ar"), "أنشأه": order.createdByName ?? "", "الانتظار (د)": order.waitMinutes ?? "", "التحضير (د)": order.prepMinutes ?? "", "التمديد (د)": order.extensionMinutes, "متأخر": order.late ? "نعم" : "لا", الأصناف: order.items })), `matbakh-report-${isoDay(range.from)}.csv`)}><Download size={15} /> Excel</button>
        <button type="button" className="primary-action" data-testid="report-pdf" onClick={() => window.print()}><FileDown size={15} /> تحميل PDF</button>
      </div>
    </header>

    <section className="report-filters no-print" data-testid="report-filters">
      <label>الفترة<select data-testid="report-period" value={preset} onChange={event => setPreset(event.target.value as Preset)}>
        <option value="today">اليوم</option><option value="yesterday">أمس</option><option value="7days">آخر 7 أيام (أسبوعي)</option><option value="30days">آخر 30 يومًا (شهري)</option><option value="custom">فترة مخصصة</option>
      </select></label>
      {preset === "custom" && <>
        <label>من<input data-testid="report-from" type="date" value={fromDay} max={toDay} onChange={event => setFromDay(event.target.value)} /></label>
        <label>إلى<input data-testid="report-to" type="date" value={toDay} min={fromDay} onChange={event => setToDay(event.target.value)} /></label>
      </>}
      <label>الفرع<select data-testid="report-branch" value={branchId} onChange={event => setBranchId(event.target.value ? Number(event.target.value) : "")}>
        <option value="">كل الفروع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label>الوردية<select data-testid="report-shift" value={shift} onChange={event => setShift(event.target.value as Shift)}>
        <option value="">كل الورديات</option><option value="morning">الصباحي</option><option value="evening">المسائي</option>
      </select></label>
    </section>

    {report.isLoading ? <p className="report-empty">جارٍ إعداد التقرير…</p>
      : report.isError ? <p className="report-empty" role="alert">تعذر إعداد التقرير: {report.error.message}</p>
      : data && <ReportBody data={data} />}
  </div>;
}

type ReportData = inferRouterOutputs<AppRouter>["reports"]["analytics"];

function ReportBody({ data }: { data: ReportData }) {
  const s = data.summary;
  const shiftPie = data.byShift.map(row => ({ name: SHIFT_LABEL[row.shift], value: row.orders }));
  const latePie = [{ name: "في الوقت", value: s.orders - s.late }, { name: "متأخر", value: s.late }];
  const activeHours = data.byHour.filter(row => row.orders > 0);
  return <>
    <section className="report-kpis" data-testid="report-kpis">
      <Kpi label="الطلبات" value={s.orders} hint={`${s.quantity} قطعة`} />
      <Kpi label="في الوقت" value={`${s.onTimePct}%`} tone="good" hint={`${s.orders - s.late} طلب`} />
      <Kpi label="المتأخرة" value={`${s.latePct}%`} tone="late" hint={`${s.late} طلب`} />
      <Kpi label="متوسط التحضير" value={fmt(s.avgPrepMinutes, " د")} hint="من القبول حتى الجاهزية" />
      <Kpi label="متوسط الانتظار" value={fmt(s.avgWaitMinutes, " د")} hint="من الإنشاء حتى القبول" />
      <Kpi label="طلبات مُدّدت" value={s.extended} hint={`${s.statusCounts.received} مُستلم · ${s.statusCounts.preparing} قيد التحضير`} />
    </section>

    {s.orders === 0 ? <p className="report-empty" data-testid="report-no-data">لا توجد طلبات في هذه الفترة.</p> : <>
      <div className="report-grid">
        <ChartCard title="الطلبات والتأخير حسب اليوم">
          <ResponsiveContainer width="100%" height={240}><BarChart data={data.byDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" fontSize={10} /><YAxis allowDecimals={false} fontSize={10} /><Tooltip /><Legend /><Bar dataKey="orders" name="الطلبات" fill={COLORS.green} /><Bar dataKey="late" name="المتأخرة" fill={COLORS.red} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="نسبة الالتزام بالوقت">
          <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={latePie} dataKey="value" nameKey="name" outerRadius={85} label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}><Cell fill={COLORS.green} /><Cell fill={COLORS.red} /></Pie><Tooltip /></PieChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="توزيع الطلبات على الورديات">
          <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={shiftPie} dataKey="value" nameKey="name" outerRadius={85} label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}><Cell fill={COLORS.amber} /><Cell fill={COLORS.blue} /></Pie><Tooltip /></PieChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="ساعات الذروة">
          <ResponsiveContainer width="100%" height={240}><BarChart data={activeHours}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" fontSize={10} tickFormatter={hour => `${hour}:00`} /><YAxis allowDecimals={false} fontSize={10} /><Tooltip labelFormatter={hour => `الساعة ${hour}:00`} /><Bar dataKey="orders" name="الطلبات" fill={COLORS.blue} /></BarChart></ResponsiveContainer>
        </ChartCard>
      </div>
      <BranchTable data={data} />
      <ProductsTable data={data} />
      <OrdersTable data={data} />
    </>}
    <p className="report-footnote">أُعدّ في {new Date(data.generatedAt).toLocaleString("ar")} · الطلب متأخر إذا تجاوز وقت التحضير المحدد. الوردية تُحدد من وردية الموظف الذي أنشأ الطلب، وإلا من الساعة (قبل 3 عصرًا صباحي).</p>
  </>;
}

function BranchTable({ data }: { data: ReportData }) {
  return <section className="report-card"><h2>الفروع والورديات</h2><div className="report-table-wrap"><table className="report-table" data-testid="report-branch-table">
    <thead><tr><th>الفرع</th><th>الطلبات</th><th>المتأخرة</th><th>نسبة التأخير</th><th>متوسط التحضير</th><th>الصباحي (طلبات / تأخير)</th><th>المسائي (طلبات / تأخير)</th></tr></thead>
    <tbody>{data.byBranch.map(branch => <tr key={branch.id}><th>{branch.name}</th><td>{branch.orders}</td><td>{branch.late}</td><td>{branch.latePct}%</td><td>{fmt(branch.avgPrepMinutes, " د")}</td><td>{branch.morning.orders} / {branch.morning.latePct}%</td><td>{branch.evening.orders} / {branch.evening.latePct}%</td></tr>)}</tbody>
  </table></div></section>;
}

function ProductsTable({ data }: { data: ReportData }) {
  return <section className="report-card"><h2>الأصناف الأكثر طلبًا</h2><div className="report-table-wrap"><table className="report-table" data-testid="report-products-table">
    <thead><tr><th>الصنف</th><th>الكمية</th><th>النسبة</th></tr></thead>
    <tbody>{data.topProducts.map(product => <tr key={product.name}><th>{product.name}</th><td>{product.quantity}</td><td><span className="report-bar" style={{ width: `${Math.max(4, product.pct)}%` }} /> {product.pct}%</td></tr>)}</tbody>
  </table></div></section>;
}

function OrdersTable({ data }: { data: ReportData }) {
  return <section className="report-card report-orders"><h2>تفاصيل الطلبات {data.truncated && <small>(أحدث 500 طلب)</small>}</h2><div className="report-table-wrap"><table className="report-table" data-testid="report-orders-table">
    <thead><tr><th>الرمز</th><th>الفرع</th><th>الوردية</th><th>الوقت</th><th>أنشأه</th><th>الحالة</th><th>الانتظار</th><th>التحضير</th><th>الأصناف</th></tr></thead>
    <tbody>{data.orders.map(order => <tr key={order.id} className={order.late ? "is-late" : ""}><th>{order.code}{order.late && <span className="report-late-tag">متأخر</span>}</th><td>{order.branch}</td><td>{SHIFT_LABEL[order.shift]}</td><td>{new Date(order.createdAt).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}</td><td>{order.createdByName ?? "—"}</td><td>{STATUS_LABEL[order.status]}</td><td>{fmt(order.waitMinutes, " د")}</td><td>{fmt(order.prepMinutes, " د")}</td><td>{order.items}</td></tr>)}</tbody>
  </table></div></section>;
}
