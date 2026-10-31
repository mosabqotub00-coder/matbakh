# إعداد Expo وFCM وبناء APK الداخلي

## حالة المشروع

مشروع WebDev Mobile مُهيّأ رسميًا باسم **مطبخي** ومعرّفه `wdp_24699f846f4ad6511fec1add`. هذا معرّف Manus/WebDev وليس `EAS projectId`. مشروع Mobile يعمل بقالب Expo/React Native/TypeScript المثبت في المنصة، ولا يجري استبداله بمشروع Expo يدوي.

ملف `eas.json` يعرّف `preview` كتوزيع داخلي APK؛ ولا يوجد نشر Google Play. لا تُشغّل `eas build` أو Android release build في Sandbox. على المالك إكمال الربط والاعتمادات في Dashboard/EAS، ثم تشغيل ملف `preview` وتنزيل APK الناتج.

## إجراء المالك لإطلاق أول APK

1. افتح Dashboard لمشروع WebDev «مطبخي» ثم اربط حساب Expo/EAS أو اختر مشروع EAS المخصص لهذا التطبيق. سجّل `EAS projectId` الناتج كمتغير بيئة عام (غير سري) `EXPO_PUBLIC_EAS_PROJECT_ID` في بيئة `preview` إذا لم تحقنه لوحة البناء تلقائيًا.
2. أنشئ تطبيق Firebase Android بالمعرّف `space.manus.matbakh.t248890740025080`. أدخل محتوى `google-services.json` في بيئة EAS المحمية `preview` كقيمة `MATBAKH_GOOGLE_SERVICES_JSON`. لا ترسل الملف في المحادثة، ولا تضعه في Git؛ `app.config.ts` يولد نسخة مؤقتة محلية أثناء بناء EAS داخل `.expo-generated/` فقط.
3. أنشئ اعتماد Firebase Cloud Messaging V1 service account، وأضفه من إعدادات EAS/Dashboard ضمن Android credentials > FCM V1. هذا الاعتماد يبقى في خزنة Expo/EAS، ولا يوضع في ملفات المشروع أو متغيرات خادم الموقع.
4. أطلق بناء `preview` (Internal distribution, APK) من Dashboard/EAS. انتظر النتيجة النهائية `finished` ورابط APK الفعلي. لا يكفي بدء البناء أو قبول Expo للاعتماد.
5. عندما يضيف مالك الموقع `nativePush` على خادمه، ثبّت APK واختبر كل بند في `ANDROID_DEVICE_TEST_AR.md` على هاتف Android حقيقي، مع حساب الموقع وفرعه الحاليين.

## الرسائل والربط من صفحة الموقع

يعتمد Native على رسالة الموقع الدقيقة:

```js
window.ReactNativeWebView.postMessage(JSON.stringify({
  source: "matbakh-web",
  type: "MATBAKH_AUTH_CHANGED",
  authenticated: Boolean(realStaffUser) && !mustChangePassword,
  passwordChangeRequired: Boolean(mustChangePassword),
  apiVersion: 1
}));
```

يقبل التطبيق الرسالة فقط من HTTPS `matbakh.click` أو `www.matbakh.click`. يسجل بعد المصادقة ومنع تغيير كلمة المرور الإجباري، وينشئ قناة `matbakh-orders-v1` قبل الحصول على Expo Push Token. بعد ذلك يجري صفحة الموقع استدعاء `nativePush.status` ثم `nativePush.register` من داخل نفس WebView بـ `fetch(..., {credentials:"include"})`، ويرسل `installationId`, `expoPushToken`, `platform:"android"`, `appVersion?` فقط. لا يرسل Native مستخدمًا أو فرعًا أو دورًا أو Cookie/session token. عند نجاح الربط يضبط التطبيق `window.__MATBAKH_NATIVE_PUSH_REGISTERED__=true` ويطلق `matbakh-native-push-state`; عند الخروج أو تعطيل الإذن يضبطها false.

إشعارات الموقع تحمل `channelId:"matbakh-orders-v1"` وتوجه إلى `url` داخلي مصرح؛ مثل `/notifications?notificationId=...&branchId=...`. يحتفظ التطبيق بمعاملات المسار كما وصلته، ويترك تحقق صلاحية الفرع والتذكرة لخادم الموقع. يؤكد `nativePush.acknowledge` استلام/فتح الإشعار فقط؛ لا يثبت ظهوره على الهاتف أو صدور الصوت.

## مصادر رسمية

- [Expo: إعداد إشعارات Push](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo: اعتماد FCM V1](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Expo: استقبال الإشعارات](https://docs.expo.dev/push-notifications/receiving-notifications/)
- [Expo Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo EAS Build](https://docs.expo.dev/build/introduction/)
