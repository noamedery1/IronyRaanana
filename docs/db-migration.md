# אפיון: מעבר מהקובץ החי (Google Sheets) ל-Database

> **סטטוס:** טיוטה לאפיון · **יעד:** PostgreSQL על Railway · **אסטרטגיה:** מעבר מלא (ה-DB מקור האמת היחיד; פרישה הדרגתית של Apps Script + CSV)
>
> מסמך זה מאפיין את המצב הקיים ואת היעד. אין כאן עדיין קוד — רק תכנון לקבלת החלטות.

---

## 1. למה לעבור (המניע)

המערכת היום נשענת על **Google Spreadsheet לכל מועדון** כ"בסיס נתונים", עם שכבת Apps Script ככתיבה/לוגיקה. זה עבד מצוין כ-MVP אבל יש כאב גדל:

| כאב נוכחי | מקור |
|-----------|------|
| אין עקביות/טרנזקציות — שתי עריכות במקביל דורסות זו את זו | `handleSaveSchedule` עושה `sheet.clear()` + כתיבה מלאה |
| פענוח CSV שביר בצד הלקוח (זיהוי שורת כותרת לפי "קבוצות", שעה ב-regex, סטטוס לפי `XXX`/צבע תא) | `PublicSchedule.jsx`, `scheduleUtils.js` |
| אישור שינויים מצביע לתא לפי Row/Col — נשבר אם מזיזים שורות/עמודות | `handleApprove` ב-`APPS_SCRIPT.gs` |
| אי-אפשר לתשאל ("כל האימונים במגרש X השבוע", "התנגשויות") בלי לטעון הכל ולפענח | כל מסלולי הקריאה |
| מיילים ב-`MailApp` ומגבלות מכסה של Apps Script | `notifySubscribers`, `handleSubmitRequest` |
| ריבוי מועדונים = ריבוי גיליונות + סקריפטים ידניים | `clubConfig` / `clubsStore` |

**היתרון:** כבר קיים Backend (Express על Railway) + Volume (`clubsStore.js`) + מנגנון Push ב-Node (`/api/push/send`). כלומר אנחנו לא בונים תשתית מאפס — רק מוסיפים DB ו-API לצד מה שכבר רץ.

---

## 2. מיפוי המצב הקיים (מה ה"קובץ החי" באמת מכיל)

ה"קובץ" הוא Spreadsheet עם הטאבים הבאים (מתוך `APPS_SCRIPT.gs`):

| טאב | תוכן | עמודות | נקרא ע"י | נכתב ע"י |
|-----|------|--------|----------|----------|
| `גיליון1` | לוח האימונים | קבוצה, מאמן, [סוג], ראשון..שבת (תאים = "שעה מיקום" בשורות) | כל הלקוחות (CSV), `calendar.ics` | `saveSchedule`, `handleApprove` |
| `Trainers` | מאמנים | Name, Code, Teams, Color, Token | `trainerAuth`, `listTrainers` | `saveTrainer`, `addTrainer`, `deleteTrainer` |
| `Users` | חברים/מפעילים | Token, Role, Team, Name, Email, Phone, Code, Created | `userAuth` | `registerUser` |
| `Subscribers` | רשימת תפוצה למייל | Timestamp, Name, Email, Team | `notifySubscribers` | `registerSubscriber`, `unregisterSubscriber` |
| `PushSubs` | מנויי Web Push | Timestamp, Team, Endpoint, Subscription(JSON) | `sendPushForTeam` | `registerPushSubscription`, prune אוטומטי |
| `Requests` | בקשות שינוי (workflow) | Timestamp, Trainer, Day, Original, Team, Type, NewTime, NewLoc, NewDay, Reason, Status, Row, Col | `handleApprove/Reject` | `submitRequest` |
| `SavedRules` | אילוצי WeekBuilder | Team, Coach, Config(JSON) | `AdminDashboard` (cloud rules) | `saveRulesToCloud` |
| `backup_week_*` | גיבויים שבועיים | עותק של הלוח | — | תהליך גיבוי |

**מסלולי קריאה:** הדפדפן מושך `export?format=csv` ישירות מ-Google ומפענח ב-`Papa.parse`. השרת מושך CSV ל-`calendar.ics`.
**מסלולי כתיבה/אימות/מייל/Push:** דרך Apps Script (`doPost`/`doGet`), כולל קישורי אישור-במייל שמשנים תאים.

---

## 3. מודל היעד (סכמת PostgreSQL)

הקפיצה המהותית: **תא בלוח → שורת `session` מנורמלת.** במקום "טקסט בתא שצריך לפענח", כל אימון הוא רשומה עם שדות אמיתיים. זה פותר התנגשויות, תשאול, ואישורים בלי מצביעי Row/Col.

```sql
-- ארגון רב-מועדוני
clubs (
  id            uuid pk,
  slug          text unique,          -- raanana / kiryatyam
  name          text, short_name text,
  sport         text,                 -- basketball / football
  theme_color   text, background_color text,
  logo_url      text,
  created_at    timestamptz default now()
);

halls (                               -- מגרשים/אולמות (מחליף שמות מיקום חופשיים)
  id uuid pk, club_id uuid fk,
  name text, address text, lat double precision, lng double precision,
  unique (club_id, name)
);

coaches (
  id uuid pk, club_id uuid fk,
  name text, code text,               -- code = סיסמת מאמן (hash, ראה §6)
  color text, token text unique,      -- token = לינק אישי
  unique (club_id, name)
);

teams (
  id uuid pk, club_id uuid fk,
  name text, gender char(1) default 'M',  -- M/W
  coach_id uuid fk null,
  unique (club_id, name, coach_id)
);

-- ★ הליבה: אימון בודד (מחליף את תא הלוח)
sessions (
  id uuid pk, club_id uuid fk,
  team_id uuid fk,
  hall_id uuid fk null,
  day_of_week smallint,               -- 0=ראשון .. 6=שבת (לתבנית חוזרת)
  date date null,                     -- לתאריך קונקרטי (שבוע ספציפי)
  start_time time, end_time time,
  type text default 'training',       -- training / match / rental / event / school
  status text default 'active',       -- active / cancelled / changed / moved
  note text,
  updated_at timestamptz default now()
);
create index on sessions (club_id, date);
create index on sessions (club_id, hall_id, date, start_time);  -- לזיהוי התנגשויות

team_rules (                          -- מחליף SavedRules (JSON אילוצים)
  id uuid pk, club_id uuid fk, team_id uuid fk,
  sessions_per_week smallint, duration_min smallint,
  max_end_time time, constraints jsonb
);

users (                               -- חברים/מפעילים (מחליף Users)
  id uuid pk, club_id uuid fk,
  token text unique, role text,       -- member / operator
  team_id uuid fk null, name text, email text, phone text,
  created_at timestamptz default now()
);

push_subscriptions (                  -- מחליף PushSubs
  id uuid pk, club_id uuid fk,
  segment text,                       -- team:<id> / __TRAINER__:<name> / __OPERATOR__ / ''
  endpoint text unique, subscription jsonb,
  created_at timestamptz default now()
);

email_subscribers (                   -- מחליף Subscribers
  id uuid pk, club_id uuid fk,
  team_id uuid fk null, name text, email text,
  unique (club_id, team_id, email)
);

change_requests (                     -- מחליף Requests (בלי Row/Col!)
  id uuid pk, club_id uuid fk,
  session_id uuid fk,                 -- מצביע לאימון אמיתי, לא לתא
  coach_id uuid fk, type text,        -- cancel / change / move
  proposed jsonb,                     -- {date,start,end,hall_id,...}
  reason text, status text default 'pending',
  created_at timestamptz default now(), resolved_at timestamptz
);

audit_log (                           -- מי שינה מה ומתי (לא קיים היום)
  id bigserial pk, club_id uuid, actor text, action text,
  entity text, entity_id uuid, diff jsonb, at timestamptz default now()
);
```

מה שהיה "סטטוס לפי `XXX`/צבע תא" הופך ל-`sessions.status`. מה שהיה "שעה ב-regex" הופך ל-`start_time/end_time`. גיבוי שבועי הופך לטבלת `sessions` עם `date` + אפשרות snapshot (או `pg_dump`).

---

## 4. שכבת API (מחליפה את Apps Script + ה-CSV)

נרחיב את שרת ה-Express הקיים (`server.js`). כל פעולת Apps Script הופכת ל-endpoint:

| Apps Script (היום) | REST endpoint (יעד) |
|---|---|
| `GET export?format=csv` | `GET /api/:club/schedule?week=YYYY-MM-DD` → JSON sessions |
| `saveSchedule` | `PUT /api/:club/sessions` (טרנזקציה) / `PATCH /api/:club/sessions/:id` |
| `trainerAuth` / `listTrainers` | `POST /api/:club/trainers/auth` · `GET /api/:club/trainers` |
| `saveTrainer`/`add`/`delete` | `POST|PATCH|DELETE /api/:club/trainers/:id` |
| `registerUser` / `userAuth` | `POST /api/:club/users` · `POST /api/:club/users/auth` |
| `registerSubscriber` / `unregister` | `POST|DELETE /api/:club/email-subscribers` |
| `registerPushSubscription` / `unregister` | `POST|DELETE /api/:club/push` (קיים כבר חצי — `/api/push/send`) |
| `submitRequest` | `POST /api/:club/requests` |
| `handleApprove/Reject` (קישור מייל) | `POST /api/:club/requests/:id/approve|reject` (+ דף אישור מאובטח) |
| `sendBroadcast` / `sendTrainerPush` | `POST /api/:club/broadcast` (משתמש ב-`/api/push/send` הקיים) |
| `sendFeedback` | `POST /api/feedback` (מייל דרך Node, ראה §7) |

**תאימות לאחור בזמן המעבר:** נשמור endpoint שמייצר CSV ו-ICS מה-DB (`GET /api/:club/schedule.csv`, `/calendar.ics`) כדי שלקוחות/יומנים קיימים ימשיכו לעבוד עד שכל הקריאות יעברו ל-JSON.

---

## 5. שינויים בצד הלקוח (React)

- להחליף את `Papa.parse(DATA_URL)` ב-`fetch('/api/:club/schedule')` שמחזיר sessions מובנים — מוחק את כל לוגיקת זיהוי-הכותרת/regex ב-`PublicSchedule.jsx`, `HallView.jsx`, `DailyView.jsx`, `scheduleUtils.js`.
- `HallView`/`DailyView` כבר מקבצים לפי מיקום — יקבלו את זה "חינם" מ-`hall_id`.
- `TrainerEditModal`/`AdminDashboard` יכתבו דרך ה-API החדש במקום ל-`sheetApi`.
- זיהוי התנגשויות (שכבר קיים ב-`WeekBuilder`) יוכל לרוץ בצד שרת על שאילתת אינדקס.

---

## 6. אימות והרשאות

המנגנון כבר קיים (טוקנים ל-מאמן/חבר/מפעיל; סופר-יוזר בשרת). במעבר:
- `coaches.code` / סיסמאות — לאחסן כ-**hash** (bcrypt/argon2), לא טקסט גלוי כמו היום.
- טוקנים אישיים (`token`) נשמרים כפי שהם (כבר UUID).
- מנהל מועדון: סשן מבוסס שרת (כבר יש `requireSuperuser`); להרחיב ל-role של מנהל-מועדון.
- כל endpoint כתיבה נגזר תחת `:club` + בדיקת הרשאה — מחליף את הסיסמה המשותפת `MANAGER_PUSH_PW`.

---

## 7. מייל ו-Push (יציאה מ-Apps Script)

- **Push:** כבר ב-Node (`/api/push/send`). רק להעביר את קריאת `sendPushForTeam` מהסקריפט אל שאילתת `push_subscriptions` ב-DB. ה-prune של endpoints שפגו כבר נתמך.
- **מייל:** `MailApp` → ספק Node (Resend/SendGrid/SES). מעביר את `notifySubscribers` + קישורי אישור/הסרה ל-Express. מסיר את מגבלת המכסה של Apps Script.

---

## 8. הגירת נתונים (Backfill)

סקריפט חד-פעמי לכל מועדון (דומה במהותו לממיר ה-Word→שורות שכבר כתבנו ב-POC):
1. למשוך כל טאב כ-CSV (`gid` לכל טאב).
2. `גיליון1` → לפרק כל תא ל-`sessions` (שעה/מיקום/סטטוס) — שימוש חוזר ב-`parseCellContent`.
3. `Trainers/Users/Subscribers/PushSubs/SavedRules` → שורות בטבלאות המתאימות.
4. ליצור `halls`/`teams`/`coaches` מתוך הערכים הייחודיים שנמצאו.
5. ריצת אימות: ספירת אימונים/קבוצות לפני ואחרי חייבת להתאים.

---

## 9. שלבי ביצוע (Strangler — בלי "Big Bang")

1. **תשתית:** Postgres ב-Railway, migrations (Prisma/Knex/`node-pg-migrate`), חיבור מ-`server.js`.
2. **קריאה:** `GET /api/:club/schedule` מ-DD + endpoint תאימות CSV/ICS. Backfill ראשוני.
3. **דואלי:** הלקוח קורא מה-API; כתיבות ממשיכות זמנית לסקריפט **וגם** ל-DB (או להפך) עד אימות.
4. **כתיבה:** להעביר עריכות/אישורים/מאמנים/מנויים ל-API. לכבות את כתיבות הסקריפט.
5. **פרישה:** להסיר את ה-CSV/Apps Script כתלות; להשאיר ייצוא ICS מה-DB. גיבוי = `pg_dump` מתוזמן.

כל שלב נפרס לבד ולא שובר את הקודם.

---

## 10. סיכונים ופתוחים

- **עריכה במקביל:** היום אין נעילה; ב-DD נוסיף `updated_at`/optimistic locking. צריך להחליט UX להתנגשות.
- **קאשינג PWA:** ה-service worker מקווה ל-`docs.google.com` (NetworkFirst) — לעדכן ל-origin שלנו.
- **תאריכים/RTL:** היום ה-headers הם "ראשון 14/6"; ב-DB נשמור `date` אמיתי — להחליט אם הלוח הוא תבנית-עונתית חוזרת + גזירת שבוע, או שבוע מתוארך בלבד.
- **תבנית מול שבוע:** (קשור ל-POC קריית ים) — `sessions` תומך בשניהם (`day_of_week` או `date`); להחליט מדיניות.
- **קישורי אישור במייל:** לעבור מקישור-GET-שמשנה-תא לקישור חתום שקורא ל-API.
- **עלות:** Postgres ב-Railway = תוספת חודשית קטנה; לאמוד מול תקציב.

---

## נספח: קבצים מושפעים

- שרת: `server.js` (+ מודול `server/db.js`, `server/schema.sql` / migrations)
- לקוח: `src/pages/PublicSchedule.jsx`, `PublicScheduleWomen.jsx`, `AdminDashboard.jsx`, `components/HallView.jsx`, `DailyView.jsx`, `TrainerManager.jsx`, `TrainerEditModal.jsx`, `RegisterUpdatesModal.jsx`, `MessageCenter.jsx`, `utils/scheduleUtils.js`, `server/scheduleCore.js`
- פרישה בסוף: `APPS_SCRIPT.gs`, `APPS_SCRIPT_MANAGER.gs`, התלות ב-`dataUrl`/`sheetApi` ב-`clubConfig.js`/`clubsStore.js`
