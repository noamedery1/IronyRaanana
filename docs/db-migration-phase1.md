# שלב 1 — אפיון פיתוח: "פרסם לוז" (Excel → DB כלוז חי)

> חלק מ-[אפיון המעבר ל-DB](./db-migration.md). מסמך זה מאפיין את **שלב 1** בלבד, מוכן לפיתוח.
>
> **לא מפתחים על main.** כל הפיתוח בברנצ'ים, רץ ונבדק מקומית מקצה-לקצה לפני עלייה לפרודקשן.

## החלטות שננעלו

| נושא | החלטה |
|------|--------|
| מקור "האקסל של המנהל" | **Google Sheet לכל מועדון** (ה-`dataUrl` הקיים). "פרסם" מושך CSV → DB. |
| סמנטיקת פרסום | **שבוע מתוארך + היסטוריה** — כל פרסום יוצר/דורס את השבוע הנבחר ושומר קודמים כ-snapshot. |
| עדכוני לייב בשבוע | **ל-DB בלבד**, דרך אישור מנהל. האקסל קפוא עד הפרסום הבא. |
| DB מקומי | **Postgres מקומי (Docker)** עם תאימות מלאה ל-Railway (אותו `DATABASE_URL`). |

## עקרון מנחה

```
                    עורך טיוטה                לחיצת "פרסם לוז"           קוראים לייב
   המנהל  ─────────────────────►  Google Sheet  ───────────────►  Postgres  ◄────────────  אתר ציבורי / יומן / Push
   (+ לוז המאמנים)                  (draft)        snapshot לשבוע      (לוז חי)                 הורים / מאמנים / מפעילים
                                                                          ▲
                                                  עדכוני לייב מאושרים ─────┘  (בקשת שינוי → אישור מנהל → DB + audit)
```

- **לפני פרסום:** ה-Sheet הוא טיוטה. האתר הציבורי ממשיך כרגיל (תאימות לאחור — ראה §6).
- **בפרסום:** המערכת מושכת את ה-CSV, מפענחת ל-`sessions` מנורמלים, ושומרת כ-publication חדש לשבוע הנבחר.
- **אחרי פרסום:** האתר קורא מה-DB. עריכות ב-Sheet לא משפיעות על הלייב עד הפרסום הבא — נציג זאת ב-UI במפורש.
- **במהלך השבוע:** בקשות שינוי → אישור מנהל → כתיבה ל-`sessions` של ה-publication + רישום ב-`audit_log`.

## ארכיטקטורה

מרחיבים את שרת ה-Express הקיים (`server.js`). מוסיפים:
- `server/db.js` — pool של `pg`, נקרא מ-`DATABASE_URL` (זהה מקומי/Railway).
- `server/migrations/` — migrations (`node-pg-migrate`), כולל seed של מועדונים מ-`clubsStore`.
- `server/publish.js` — לוגיקת הפרסום (משיכת CSV, פענוח, upsert טרנזקציוני).
- שימוש חוזר ב-`server/scheduleCore.js` (`parseCellContent`, `parseHeaderDate`) לפענוח התאים.

## סכמת DB (תת-קבוצה לשלב 1)

```sql
clubs (
  id uuid pk default gen_random_uuid(),
  slug text unique, name text, sport text,
  data_url text,                         -- ה-Google Sheet של המנהל
  created_at timestamptz default now()
);

-- כותרת פרסום: snapshot של שבוע אחד
schedule_publications (
  id uuid pk default gen_random_uuid(),
  club_id uuid references clubs(id),
  week_start date not null,              -- ראשון של השבוע
  status text default 'live',            -- live / archived
  source_url text,                       -- ה-CSV שממנו פורסם
  published_by text, published_at timestamptz default now(),
  unique (club_id, week_start, status)   -- שבוע אחד 'live' פעיל לכל מועדון
);

-- אימון בודד (מחליף תא בלוח) — שייך ל-publication
sessions (
  id uuid pk default gen_random_uuid(),
  publication_id uuid references schedule_publications(id) on delete cascade,
  club_id uuid references clubs(id),
  team text, coach text, gender char(1) default 'M',
  hall text,                             -- בשלב 1 טקסט; ינורמל ל-halls בשלב מאוחר
  date date, day_of_week smallint,
  start_time time, end_time time,
  type text default 'training',          -- training/match/rental/event/school
  status text default 'active',          -- active/cancelled/changed/moved
  note text, updated_at timestamptz default now()
);
create index on sessions (publication_id);
create index on sessions (club_id, date, hall);   -- התנגשויות/תשאול

-- בקשות שינוי בשבוע חי (מצביע לאימון אמיתי, לא Row/Col)
change_requests (
  id uuid pk default gen_random_uuid(),
  club_id uuid references clubs(id),
  session_id uuid references sessions(id),
  requested_by text, type text,          -- cancel/change/move
  proposed jsonb, reason text,
  status text default 'pending',         -- pending/approved/rejected
  created_at timestamptz default now(), resolved_at timestamptz
);

audit_log (
  id bigserial pk, club_id uuid, actor text, action text,
  entity text, entity_id uuid, diff jsonb, at timestamptz default now()
);
```

> טבלאות מאמנים/שחקנים/מנויים יתווספו בשלבים הבאים (הסכמה כבר תוכננה ב-[db-migration.md](./db-migration.md)). שלב 1 ממוקד בלוז + פרסום + עדכוני לייב, אבל הכל ממופתח לפי `club_id` כדי שריבוי-מועדונים יעבוד מהיום.

## חוזי ה-API (שלב 1)

| Method · Endpoint | תיאור |
|---|---|
| `POST /api/:club/publish` | גוף: `{ weekStart? }`. מושך את `data_url`, מפענח, יוצר publication חדש + sessions; מסמן publication קודם לאותו שבוע כ-`archived`. מחזיר `{ publicationId, weekStart, counts, conflicts[] }`. |
| `GET /api/:club/schedule?week=YYYY-MM-DD` | מחזיר את ה-sessions החיים מה-DB (ברירת מחדל: ה-publication ה-`live` האחרון). |
| `GET /api/:club/publications` | היסטוריית פרסומים (לשחזור/גיבוי). |
| `POST /api/:club/requests` | יצירת בקשת שינוי (מאמן/מפעיל). |
| `POST /api/:club/requests/:id/approve` \| `/reject` | אישור מנהל → עדכון `sessions` + `audit_log`. שולח Push (משתמש ב-`/api/push/send` הקיים). |
| `GET /api/:club/schedule.csv` · `/calendar.ics` | **תאימות לאחור** — מיוצר מה-DB כדי שלקוחות/יומנים קיימים ימשיכו. |

זיהוי התנגשויות בפרסום: שימוש חוזר בלוגיקה שכבר קיימת ב-`WeekBuilder` (אותו מגרש/מאמן בחפיפת זמן) — **מדווח, לא חוסם** (המנהל כבר אישר את הלוז).

## שינויים בצד הלקוח

**מסך המנהל (`AdminDashboard.jsx`):**
- נשאר חיבור/תצוגה של ה-Sheet כטיוטה (הקיים).
- כפתור **"📢 פרסם לוז"**: בחירת שבוע (ברירת מחדל מזוהה אוטומטית מכותרות ה-Sheet, למשל "ראשון 14/6"), אישור, `POST /publish`, והצגת תוצאה (כמה אימונים, התנגשויות).
- פאנל **"פרסומים אחרונים"** (`GET /publications`) — מתי פורסם, איזה שבוע, אפשרות לשחזר.
- חיווי ברור: "הלוז החי מתעדכן רק בלחיצת פרסם; עריכות ב-Sheet לא משפיעות עד הפרסום הבא."

**אתר ציבורי (`PublicSchedule.jsx` + `HallView`/`DailyView`):**
- לקרוא מ-`GET /api/:club/schedule` (sessions מובנים) — מבטל את פענוח ה-CSV/regex בצד הלקוח.
- **Fallback בזמן המעבר:** אם אין publication חי למועדון — ליפול ל-CSV הקיים, כך ששום דבר לא נשבר מקומית.

## פיתוח מקומי עם תאימות Railway

- `docker-compose.yml` עם Postgres; `DATABASE_URL=postgres://...@localhost:5432/raanana` ב-`.env`.
- Railway מזריק `DATABASE_URL` אוטומטית לתוסף Postgres — **אותו קוד, אותו משתנה סביבה**, בלי הסתעפות.
- migrations רצות ב-`npm run migrate` (מקומי) וב-release על Railway.
- seed: מושך את המועדונים מ-`clubsStore` (raanana וכו') לטבלת `clubs`.
- **בדיקת קצה-לקצה מקומית:** עריכה ב-Google Sheet → "פרסם" → רואים את הלוז ב-`/api/:club/schedule` ובאתר → בקשת שינוי → אישור → רואים עדכון לייב ב-DB. הכל לפני פרודקשן.

## שלבי ביצוע בתוך שלב 1

1. Postgres מקומי (docker) + `server/db.js` + migrations + seed מועדונים.
2. `POST /publish` + `server/publish.js` (משיכת CSV, פענוח, upsert טרנזקציוני) + `GET /schedule`.
3. כפתור "פרסם לוז" + פאנל היסטוריה במסך המנהל.
4. מעבר קריאת האתר הציבורי ל-API (עם fallback ל-CSV).
5. בקשות שינוי + אישור → DB + audit + Push.
6. endpoint תאימות CSV/ICS מה-DB.

## פתוחים קטנים (לא חוסמים פיתוח)

- **זיהוי השבוע:** אוטומטי מכותרת ה-Sheet (יום+תאריך) או בחירה ידנית של המנהל? (מוצע: אוטומטי + אפשרות override.)
- **הרשאת פרסום:** בשלב 1 דרך שער ה-admin הקיים; הרשאות מלאות לפי-מועדון בשלב מאוחר.
- **משחקים/השכרה/טקס:** ממופים ל-`sessions.type`; להחליט אם המנהל מסמן אותם ב-Sheet או שמזהים מהטקסט.
