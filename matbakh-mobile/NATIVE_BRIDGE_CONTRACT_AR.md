# عقد WebView Native لموقع مطبخي

يستضيف التطبيق صفحة الموقع الحالية `https://matbakh.click` في Android WebView. الحساب والجلسة والفرع والدور والصلاحيات والطلبات تبقى في مطبخي؛ لا ينشئ التطبيق جلسة أو قاعدة مستخدمين منفصلة. ينتظر Native من الصفحة إشعار الحالة التالي أول مرة، وبعد تسجيل الدخول في SPA، وبعد تغيير كلمة المرور الإجباري أو الخروج:

```js
window.ReactNativeWebView.postMessage(JSON.stringify({
  source: "matbakh-web",
  type: "MATBAKH_AUTH_CHANGED",
  authenticated: Boolean(realStaffUser) && !mustChangePassword,
  passwordChangeRequired: Boolean(mustChangePassword),
  apiVersion: 1
}));
```

يقبل Native الرسالة فقط إن كان `event.nativeEvent.url` على `https://matbakh.click` أو `https://www.matbakh.click`، ويتحقق من المصدر والإصدار والحقول. لا يطلب إذن Push ولا يربط جهازًا عند `authenticated:false` أو `passwordChangeRequired:true`.

## الطلبات ضمن سياق الصفحة نفسه

بعد المصادقة، ينشئ التطبيق Android channel `matbakh-orders-v1` أولًا ويطلب إذن الإشعارات، ثم يحصل على Expo Push Token و`installationId` عشوائي محفوظ في SecureStore. يستدعي Native بعد ذلك `injectJavaScript` لإجراء هذه الطلبات من `window.fetch` داخل document الحالي، وليس عبر React Native fetch:

- `GET /api/trpc/nativePush.status?input=...`.
- `POST /api/trpc/nativePush.register?batch=1` مع `installationId`, `expoPushToken`, `platform:"android"`, و`appVersion?`.
- عند تسجيل الخروج/رفض الإذن/سحب الإذن، `POST /api/trpc/nativePush.unregister?batch=1` بـ`installationId` فقط، ومحاولة إلغاء الربط بأفضل جهد.
- تأكيد الاستلام والفتح عبر `nativePush.acknowledge({installationId,deliveryId,state})` بحالتي `received` و`opened` فقط.
- يمر اختبار المستخدم بالجهاز الحالي عبر `nativePush.test({installationId})`.

الطلبات تستخدم صيغة tRPC v11 `httpBatchLink` مع `{credentials:"include"}` وJSON input المُسلسل؛ الخادم يتلقى Cookie الجلسة نفسهـا تلقائيًا. لا يُقرأ Cookie أو يُنسخ أو يُرسل من Native. لا تحتوي أي حمولة Native على `userId` أو `branchId` أو `role` أو `sessionToken`. `branchId` في URL الإشعار مَعلمة توجيه غير موثوقة؛ خادم الموقع يعيد تحديد الفرع المسموح وتفويض المستخدم.

بعد قبول طلب `register`، يضبط سكربت WebView `window.__MATBAKH_NATIVE_PUSH_REGISTERED__=true` ويطلق `new CustomEvent('matbakh-native-push-state',{detail:{registered:true}})`. عند تعطيل التسجيل يضبطه false ويطلق الحدث نفسه. يرسل السكربت إلى Native حالة غير حساسة بصيغة `MATBAKH_NATIVE_PUSH_STATE` كي يتأكد التطبيق من نجاح التسجيل. نجاح tRPC أو Expo Receipt لا يثبت أن الهاتف عرض أو أصدر صوتًا.

## مسار الإشعار والصوت

يرسل الموقع `channelId:"matbakh-orders-v1"`, أولوية `high`, وبيانات توجيه داخلية مثل `{deliveryId,notificationId,branchId,orderId,type,url}`. المسارات Native المسموحة للإشعار محصورة في `/`, `/kitchen`, `/manager`, و`/notifications`; يفتح نموذج الموقع المسار والتذكرة ويعيد التحقق من صلاحيتها.

عند كون التطبيق ظاهرًا، يتولى إشعار Android الصوت مرة واحدة (`shouldPlaySound:true`) ويوقف الموقع beep التذكرة عندما تكون `__MATBAKH_NATIVE_PUSH_REGISTERED__` صحيحة. إذا لم يسجل الجهاز أو رُفض الإذن، يظل beep الموقع الأصلي فعالًا. التسجيلات الصوتية والميكروفون تبقى بيد الموقع؛ إذن `RECORD_AUDIO` لا يطلب عند تشغيل التطبيق، بل يظهر فقط إذا بدأت صفحة التسجيل طلب التقاط صوت.

عند تسجيل الخروج، قد يفشل `unregister` إذا سبق مسح Cookie؛ لذلك يجب أن يمنع الخادم التوجيه فور إبطال أو انتهاء `ctx.staffSessionHash`، ويحذف الربط عند إلغاء الجلسة أو تعطيل الحساب حتى لو تعذر طلب Native.
