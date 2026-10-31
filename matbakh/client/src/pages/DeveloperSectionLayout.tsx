import { ArrowRight, BarChart3, Bug, Code2, Flag, UserCircle, UploadCloud } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";

const sections = [
  ["/developer", "الرئيسية", Code2],
  ["/developer/reports", "التقارير والتحليلات", BarChart3],
  ["/developer/issues", "الأخطاء والملاحظات", Bug],
  ["/developer/releases", "مختبر الإصدارات", UploadCloud],
  ["/developer/features", "مفاتيح الميزات", Flag],
  ["/developer/profile", "ملف المطوّر", UserCircle],
] as const;

export default function DeveloperSectionLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const [pathname] = useLocation();
  return <main className="manager-page developer-page developer-subpage" dir="rtl">
    <header className="developer-subpage-header">
      <div><Link href="/developer" className="developer-back-link"><ArrowRight size={16} /> العودة إلى مركز المطوّر</Link><h1><Code2 size={25} /> {title}</h1><p>{description}</p></div>
    </header>
    <nav className="developer-section-nav" aria-label="أقسام مركز المطوّر">
      {sections.map(([href, label, Icon]) => <Link key={href} href={href} className={href === pathname ? "active" : ""}><Icon size={16} /> {label}</Link>)}
    </nav>
    {children}
  </main>;
}
