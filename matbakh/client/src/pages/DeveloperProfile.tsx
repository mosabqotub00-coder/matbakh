import { useEffect, useState } from "react";
import { LockKeyhole, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import DeveloperSectionLayout from "./DeveloperSectionLayout";
export default function DeveloperProfile() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  useEffect(() => { if (me.data) { setUsername(me.data.username); setDisplayName(me.data.displayName); } }, [me.data]);
  const profile = trpc.developer.profileUpdate.useMutation({ onSuccess: () => toast.success("تم حفظ بيانات الحساب."), onError: error => toast.error(error.message) });
  const password = trpc.auth.changePassword.useMutation({ onSuccess: () => { toast.success("تم تغيير كلمة المرور."); setCurrentPassword(""); setNewPassword(""); }, onError: error => toast.error(error.message) });
  return <DeveloperSectionLayout title="ملف المطوّر" description="إعدادات الحساب الشخصي فقط، منفصلة عن إدارة الفروع والتحديثات."><div className="developer-profile-grid"><form className="developer-profile-card" onSubmit={event => { event.preventDefault(); profile.mutate({ username, displayName }); }}><h2><UserCircle size={19} /> بيانات الحساب</h2><label><span>اسم المستخدم</span><input value={username} onChange={event => setUsername(event.target.value)} /></label><label><span>الاسم الظاهر</span><input value={displayName} onChange={event => setDisplayName(event.target.value)} /></label><button className="primary-action" type="submit" disabled={profile.isPending}>حفظ بيانات الحساب</button></form><form className="developer-profile-card" onSubmit={event => { event.preventDefault(); password.mutate({ currentPassword, newPassword }); }}><h2><LockKeyhole size={19} /> كلمة المرور</h2><label><span>كلمة المرور الحالية</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label><span>كلمة المرور الجديدة</span><input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><button className="primary-action" type="submit" disabled={password.isPending}>تغيير كلمة المرور</button></form></div></DeveloperSectionLayout>;
}
