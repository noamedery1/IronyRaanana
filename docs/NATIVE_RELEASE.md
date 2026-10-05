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

**מה אני אבנה אחרי שיהיו החשבונות (הקוד מתוכנן, צריך רק את הקונפיג):**
- לקוח (`native-shell`): לבקש הרשאת פוש, לקבל token, ולשלוח לשרת עם זהות המשתמש (המועדון/קבוצה שהוא הזין במעטפת) — זו "גשר הזהות": הטוקן הנייטיב מגיע מהמעטפת, בעוד הזהות של האתר חיה ב-WebView החיצוני.
- שרת: endpoint `POST /api/<club>/native-push/register` לשמור טוקנים לפי segment (team:<name> / __OPERATOR__), ושליחה דרך FCM בנוסף ל-Web Push הקיים.
- החלטה לקבל ביחד: למפות טוקנים נייטיב ל-segments הקיימים (כמו ב-Web Push) או מבנה חדש.

### 4. חנויות — ליסטינג
- **Google Play Console** (25$ חד-פעמי) + **App Store Connect**.
- נכסים: אייקון 1024², צילומי מסך, תיאור, מדיניות פרטיות (יש `public/privacy.html`), קטגוריה, דירוג גיל.
- אייקונים: כרגע `native-shell/icon.png`. כדאי להריץ `npx @capacitor/assets generate` עם לוגו 1024² כדי לייצר את כל גדלי האייקון/splash ל-iOS ול-Android.

---

## ⚠️ שתי החלטות ארכיטקטוניות (לדבר עליהן מחר)

1. **סיכון דחייה של אפל (Guideline 4.2 — "minimal functionality").** אפל לעיתים דוחה אפליקציה שהיא רק מעטפת לאתר. SportDle עוקף זאת כי הוא **אורז את כל האתר** לתוך האפליקציה (`webDir: app-dist`). ל-Squadio יש מעטפת דקה שטוענת את האתר החי — סיכון גבוה יותר. אפשרויות: לארוז יותר תוכן מקומית, להוסיף יכולות נייטיב (פוש/שיתוף/ווידג'ט = נקודות זכות), או לנסות ולראות. **אנדרואיד הרבה פחות מחמיר בזה.**
2. **פוש = הסיבה המרכזית לאפליקציה.** בלי FCM/APNs אין התראות באפליקציית החנות (סעיף 3). זו העבודה המהותית של מחר.

---

## 🔑 סיכום סודות GitHub (Settings → Secrets → Actions)

| סוד | בשביל | מתי |
|---|---|---|
| `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | AAB חתום לאנדרואיד | סעיף 1 |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64` | IPA חתום ל-iOS | סעיף 2 (אחרי חשבון אפל) |
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
