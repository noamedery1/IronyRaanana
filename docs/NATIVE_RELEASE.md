# העלאה לחנויות — Squadio (iOS + Android)

מסמך העבודה שלנו להעלאת האפליקציה לחנויות. מה שכבר מוכן בקוד, ומה שצריך לעשות ביחד (רוב החלקים הידניים דורשים חשבונות/תשלום, ולכן נשמרו למחר).

ענף העבודה: **`feat/native-app`** (לא develop/main). הבנייה רצה ב-GitHub Actions — המחשב הזה חוסם את ה-loopback של Gradle (אבטחה ארגונית), ולכן אי אפשר לבנות אנדרואיד מקומית; ה-CI בונה הכל.

ארכיטקטורה: Capacitor 8. האפליקציה היא **מעטפת WebView דקה** (`native-shell/`) שטוענת את האתר החי `squadio.techbynoam.com`. אותו קוד, בלי גרסה שנייה לתחזק.

---

## ✅ מה כבר מוכן (בקוד, בענף feat/native-app)

| רכיב | קובץ | מצב |
|---|---|---|
| פלטפורמת iOS (פרויקט Xcode, SPM) | `ios/` | ✅ נוצר |
| בניית iOS ב-CI (סימולטור, בלי מק) | `.github/workflows/ios.yml` | ✅ |
| IPA חתום ל-App Store/TestFlight | `.github/workflows/ios-release.yml` | ✅ (מדלג בלי סודות אפל) |
| לקוח פוש נייטיב (מעטפת, מאחורי דגל) | `native-shell/index.html` | ✅ |
| בניית APK לבדיקה (sideload) | `.github/workflows/apk.yml` | ✅ (היה) |
| AAB חתום לגוגל פליי | `.github/workflows/release-aab.yml` | ✅ (מדלג בלי סודות) |
| גרסאות + חתימת release לאנדרואיד | `android/app/build.gradle` | ✅ (מהסביבה) |
| תוספי Capacitor: ios, app, push-notifications | `package.json` | ✅ |
| iOS: העברת קולבק של APNs לתוסף הפוש | `ios/App/App/AppDelegate.swift` | ✅ |
| iOS: מצב רקע remote-notification | `ios/App/App/Info.plist` | ✅ |

---

## 🧑‍🔧 מה צריך לעשות ביחד (ידני — דורש חשבונות)

### 1. אנדרואיד — keystore ל-AAB חתום
ה-APK מ-`apk.yml` חתום במפתח debug (רק sideload). לחנות צריך **AAB חתום**:
```bash
keytool -genkey -v -keystore squadio.keystore -alias squadio -keyalg RSA -keysize 2048 -validity 10000
# להמיר ל-base64:  (Windows) certutil -encode squadio.keystore ks.b64   |   (אחר) base64 -w0 squadio.keystore > ks.b64
```
לגבות את ה-keystore **מחוץ לגיט** (איבוד = אי אפשר לעדכן את האפליקציה לנצח). ואז GitHub → Settings → Secrets and variables → Actions:
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` (=squadio), `KEY_PASSWORD`.
→ מריצים ידנית את workflow **AAB** (release-aab.yml) ומקבלים את ה-AAB כ-artifact.

### 2. אפל — חשבון מפתח + חתימה (ל-iOS אמיתי)
- **Apple Developer Program** — 99$ לשנה (apple.com/programs). בלי זה אפל לא מתקינה כלום על מכשיר, ו-`ios.yml` בונה רק לסימולטור.
- ליצור **App ID** עם ה-bundle `com.squadio.app` + להפעיל את היכולת **Push Notifications**.
- ב-Xcode (על מק, או דרך App Store Connect): להוסיף את capability **Push Notifications** (זה מוסיף את ה-entitlement `aps-environment`). את זה אפשר רק אחרי שיש חשבון מפתח.
- ליצור **Distribution certificate** + **Provisioning profile**, ולהעלות אותם כסודות GitHub כדי ש-CI יחתום IPA. (אעדכן אז את `ios.yml`/אוסיף `ios-release.yml` שמייצר IPA חתום — צריך רק את הסודות.)

### 3. פוש נייטיב — Firebase (FCM) + APNs
**חשוב:** WebView לא תומך ב-Web Push (לא ב-iOS ולא ב-אנדרואיד). ההתראות של ה-PWA **לא יעבדו בתוך האפליקציה**. לאפליקציית חנות צריך פוש נייטיב דרך **FCM** (ש-מטפל גם ב-APNs של אפל):
1. פרויקט **Firebase** (console.firebase.google.com).
2. אפליקציית Android בפיירבייס עם package `com.squadio.app` → להוריד **`google-services.json`** → לשים ב-`android/app/`.
3. אפליקציית iOS בפיירבייס עם bundle `com.squadio.app` → להוריד **`GoogleService-Info.plist`** → לשים ב-`ios/App/App/`.
4. **APNs Auth Key** (`.p8`) מחשבון המפתח של אפל → להעלות ל-Firebase (Project settings → Cloud Messaging).
5. **Service Account** (JSON) מפיירבייס → סוד בשרת (Railway) כדי שהשרת ישלח פוש דרך FCM HTTP v1.

**מה כבר מוכן בקוד:**
- **לקוח הפוש (`native-shell/index.html`) כבר מחובר** — `registerPushForMember(club,role,team)`: מבקש הרשאה, מקבל token, ושולח ל-`POST /api/<club>/native-push/register` עם ה-segment (`team:<name>` להורה / `__OPERATOR__` לכלל המועדון). נקרא ב-`enter()` כשהמשתמש מזין לינק/קוד. **כבוי ע״י הדגל `NATIVE_PUSH_ENABLED=false`** כדי לא לבקש הרשאת התראות לפני ש-Firebase מחובר — **להפוך ל-`true`** ברגע שה-google-services.json/GoogleService-Info.plist במקום.
- (ל-webDir=dist בעתיד יש גם `src/nativePush.js` מקביל ל-React.)

**מה נבנה ביחד (צריך את חשבונות סעיף 3):**
- שרת: endpoint `POST /api/<club>/native-push/register` לשמור טוקנים לפי segment (צריך טבלה `native_push_tokens` + migration), ושליחה דרך **FCM HTTP v1** (service-account) בנוסף ל-Web Push הקיים ב-`server/notify.js` (`broadcast`). המיפוי ל-segments זהה ל-Web Push (`team:<name>` / `__OPERATOR__`).
- להפוך את `NATIVE_PUSH_ENABLED` ל-`true` ולבדוק מקצה לקצה על מכשיר.

### 4. חנויות — ליסטינג
- **Google Play Console** (25$ חד-פעמי) + **App Store Connect**.
- נכסים: אייקון 1024², צילומי מסך, תיאור, מדיניות פרטיות (יש `public/privacy.html`), קטגוריה, דירוג גיל.
- אייקונים + splash: **כבר נוצרו** ל-iOS ול-Android (`npx @capacitor/assets` מתוך `assets/icon.png` — אייקון המותג בריבוע @1024, מוגדל מ-pwa-512). אם רוצים חד יותר: להחליף את `assets/icon.png` בלוגו 1024²+ מקורי ולהריץ שוב `npx capacitor-assets generate --assetPath assets --ios --android`.

---

## 🎯 ההחלטה המומלצת: לארוז את האפליקציה (bundle) — בטוח יותר, ופותר גם את הפוש

במקום מעטפת דקה שטוענת את האתר המרוחק, **אורזים את אפליקציית ה-React לתוך האפליקציה** (`webDir: dist`, כמו SportDle). זה פותר את שתי הבעיות ביחד:

1. **סיכון אפל 4.2 יורד דרמטית** — יש תוכן אמיתי במכשיר, לא "קיצור דרך לאתר". (אנדרואיד ממילא מקל.)
2. **הפוש נעשה נקי** — כשהאפליקציה ארוזה היא רצה ב-origin של עצמה, אז **גשר ה-Capacitor זמין לקוד ה-React ישירות**: ה-React (שיודע מי המשתמש) נרשם לפוש ושולח את ה-token לשרת עם הזהות — בלי "גשר זהות". **אין דרך אחרת לפוש באפליקציית חנות** (WebView לא תומך ב-Web Push), אז פוש נייטיב דרך FCM נדרש בכל מקרה; האריזה רק מנקה את החיווט.

**קוד שכבר מוכן (מודולים חדשים, no-op באינטרנט):**
- `src/nativeBridge.js` — `isNativeApp()` + `installNativeApiBase()`: כשארוז, מפנה בקשות `/api/…` יחסיות לשרת הפרודקשן (האפליקציה רצה על origin מקומי). באינטרנט — לא עושה כלום.
- `src/nativePush.js` — `registerNativePush({slug,userToken,role,team})`: מבקש הרשאה, מקבל token של FCM/APNs, ושולח ל-`POST /api/<club>/native-push/register`.

**צ'ק-ליסט הפעלה (כשעוברים לארוז — נעשה ביחד, אחרי שה-QA יסיים ואחרי Firebase):**
1. `capacitor.config.json`: לשנות `webDir` ל-`dist` (במקום `native-shell`), ולהסיר/לצמצם את `server.allowNavigation`.
2. `src/main.jsx`: בתחילת boot לקרוא `installNativeApiBase()` (לפני כל fetch).
3. **בורר מועדון בתוך האפליקציה:** באפליקציה הארוזה אין מועדון ב-URL. להפוך את מסך הפתיחה של `native-shell` (הדבקת לינק/קוד מועדון) לראוט React, ו-`RootRedirect` יציג אותו כשאין מועדון שמור (ב-native). ה-React מנווט ל-`/<club>` ומשם הכל כרגיל.
4. **שרת — CORS:** לאפשר ל-origin הנייטיב (`capacitor://localhost`, `https://localhost`) לגשת ל-`/api/*` (headers + preflight OPTIONS). הזהות היא token ב-localStorage (לא cookies), אז cross-origin עובד.
5. **שרת — endpoint פוש:** `POST /api/<club>/native-push/register` לשמור טוקנים לפי segment, ושליחה דרך FCM HTTP v1 (service-account) לצד ה-Web Push. (נבנה ביחד עם Firebase.)
6. לקרוא ל-`registerNativePush(...)` אחרי התחברות מוצלחת (ב-`Join.jsx` אחרי הרשמה / ב-`PublicSchedule` כשיש זהות).
7. לבנות iOS+Android ב-CI ולבדוק על מכשיר/סימולטור.

> **הערה:** המעבר הזה בטוח — המודולים no-op באינטרנט, ושינוי ה-`webDir` משפיע רק על האפליקציה הנייטיב. עושים אותו בצעד נפרד עם בדיקת CI, לא באמצע עבודה אחרת.

---

## 🔑 סיכום סודות GitHub (Settings → Secrets → Actions)

| סוד | בשביל | מתי |
|---|---|---|
| `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | AAB חתום לאנדרואיד | סעיף 1 |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64`, `IOS_TEAM_ID`, `IOS_PROFILE_NAME`, `KEYCHAIN_PASSWORD` | IPA חתום ל-iOS (workflow **iOS Release (IPA)** `ios-release.yml` — כבר כתוב, מדלג בלי סודות) | סעיף 2 (אחרי חשבון אפל) |
| (קבצי קונפיג, לא סודות) `google-services.json`, `GoogleService-Info.plist` | פוש FCM | סעיף 3 |
| בשרת/Railway: `FCM_SERVICE_ACCOUNT_JSON` | שליחת פוש מהשרת | סעיף 3 |

---

## ▶️ איך בונים/בודקים עכשיו (CI)

- **אנדרואיד APK (sideload):** דחיפה ל-feat/native-app מריצה את `apk.yml` → artifact `squadio-apk`.
- **iOS (סימולטור):** Actions → **iOS** → Run workflow (ידני, ראנר macOS) → artifact `squadio-ios-sim` עם צילומי מסך.
- **AAB חתום:** Actions → **AAB** → Run workflow (אחרי שהוגדרו סודות ה-keystore).
- להורדת artifact כשכפתור הדפדפן נכשל (קורה), דרך ה-token המקומי:
```bash
TOK=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
# ... /actions/runs/<RUN_ID>/artifacts  → id → /actions/artifacts/<id>/zip
```

## 🗺️ סדר פעולות מוצע למחר
1. פותחים Apple Developer + Firebase + (Google Play / App Store Connect).
2. יוצרים keystore + מגדירים סודות → מריצים AAB. (אנדרואיד מוכן להעלאה.)
3. מגדירים Firebase (google-services.json + GoogleService-Info.plist + APNs key + service account).
4. אני מוסיף את קוד הפוש הנייטיב (לקוח+שרת) ואת workflow ה-IPA החתום.
5. בונים iOS חתום, בודקים על מכשיר, מעלים ל-TestFlight.
6. ליסטינג + צילומי מסך + שליחה לבדיקה.
