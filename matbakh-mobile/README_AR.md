# حزمة مشروع مطبخي للجوال

هذه نسخة مصدر كاملة لمشروع WebDev Mobile/Expo المستقل «مطبخي»؛ تتضمن مسارات التطبيق، مكونات WebView، الجسر Native، أصول Android، إعداد Expo/EAS، `package.json` و`pnpm-lock.yaml` والاختبارات وخادم التطوير القالب الموجود في المستودع. ملف `.env.example` يسرد أسماء المتغيرات فقط بلا قيم.

## ما أُنجز

- غلاف Expo/React Native يعرض الموقع الحالي `https://www.matbakh.click` داخل WebView؛ حسابات الموظفين والفرع والدور والجلسة وبيانات الموقع تبقى على خادم الموقع الحالي. لا تحتوي هذه الحزمة نسخة من قاعدة الموقع أو بيانات الفروع.
- عقد `MATBAKH_AUTH_CHANGED` والجسر لاستدعاءات `nativePush` من سياق WebView، قناة Android `matbakh-orders-v1`، توجيه داخلي للإشعارات، إغلاق سباقات التسجيل، واختبارات الوحدة.
- معرف Android العام: `space.manus.matbakh.t248890740025080`. Expo slug: `matbakh`. Scheme: `manus248890740025080`. لم يُسند `EAS projectId` بعد.
- آخر تحقق للمصدر: TypeScript وESLint ناجحان؛ 47 اختبارًا ناجحًا؛ فحص Expo packages ناجح؛ health للموقع والـ API وMetro/API المحلي ناجح. معاينة الويب ليست اختبارًا Native.

## ما لم يُنجز بعد

- **لا يوجد APK أو AAB في الحزمة، ولم يُشغّل بناء EAS بعد.**
- لم يُختبر تثبيت Android حقيقي، أو تسجيل الدخول على الهاتف، أو وصول Push في المقدمة/الخلفية/قفل الشاشة، أو صوت القناة/فتح التذكرة/تسجيل الخروج/تبديل صلاحية الفرع.
- يلزم ربط حساب Expo/EAS، وإدخال `EXPO_PUBLIC_EAS_PROJECT_ID` وFirebase `google-services.json` عبر الحقول المحمية فقط، وإضافة FCM V1 service-account إلى Android Credentials في لوحة EAS، ثم إطلاق بناء `preview` من Dashboard.
- يلزم تحقق مالك الموقع من أن `nativePush` متاح على الخادم الحي قبل تجربة الإشعارات. استجابة مزود Push لا تثبت وصول الهاتف أو إصدار الصوت.

## محتويات حساسة مستبعدة عمدًا

لا يحتوي ZIP على `.env` أو قيم أسرار، ملفات Firebase أو service account، شهادات/مفاتيح توقيع، `node_modules` أو `.git` أو ملفات APK/AAB أو بيانات مستخدمين. خزّن القيم في بيئة Dashboard/EAS المحمية عند استعادة المشروع. لا ترفع الأسرار إلى المستودع أو المحادثة.

## التثبيت والتشغيل المحلي للتطوير

استخدم Node/pnpm المتوافقين مع Expo SDK المثبتين في `package.json` و`pnpm-lock.yaml` ثم `pnpm install --frozen-lockfile`. أوامر `pnpm dev` تشغّل Metro وAPI للتطوير فقط؛ **العاملون لن يحتاجوا Metro أو Sandbox أو Expo Go في APK الداخلي الناتج من Dashboard/EAS**. لا تشغّل `eas build` داخل Sandbox. البناء النهائي المطلوب من لوحة EAS هو `preview` بتوزيع داخلي `apk`.
