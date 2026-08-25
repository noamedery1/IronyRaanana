# Ironi Ra'anana — מנהל לוח אימונים

מערכת רב-מועדונית לניהול לוח האימונים של מועדון ספורט: המאמנים והמנהלים
בונים טיוטת לוח, מאשרים ומפרסמים אותה, והחברים רואים את הלוח, מקבלים
התראות push ויכולים לחבר אותו ליומן שלהם.

כל מועדון הוא tenant נפרד תחת `/:club` — למשל `/ironi-raanana/admin`.

## תפקידים

| תפקיד | מה הוא יכול |
|---|---|
| **Superuser** | ניהול המועדונים במערכת (`/superuser`) |
| **מנהל מועדון** | עריכת טיוטה, אישורים, פרסום, ניהול קבוצות ומאמנים |
| **מאמן** | הזנת בקשות ועריכה של האימונים שלו (`/:club/trainer`) |
| **חבר** | צפייה בלוח המפורסם, התראות, מנוי ליומן |

## זרימת עבודה

```
בקשות מאמנים ──> טיוטה (draft) ──> אישורים ──> פרסום ──> לוח + התראות + ICS
```

הטיוטה נשמרת בנפרד מהלוח המפורסם, כך שאפשר לערוך בלי להשפיע על מה
שהחברים רואים. כל פרסום נשמר בהיסטוריית `publications`.

## סטאק

- **Frontend:** React 18 + Vite, React Router
- **Backend:** Express (`server.js` + `server/`), PostgreSQL עם `node-pg-migrate`
- **התראות:** Web Push (VAPID) דרך `web-push`
- **יומן:** פיד ICS ב-`/api/:club/calendar.ics`
- **ייבוא/ייצוא:** Excel ו-CSV (`exceljs`, `xlsx`, `papaparse`)
- **PWA:** ניתן להתקנה מהדפדפן

## התקנה

```bash
npm install
cp .env.example .env
```

למלא ב-`.env`:

| משתנה | מה זה |
|---|---|
| `DATABASE_URL` | connection string ל-PostgreSQL |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | מפתחות Web Push — `npx web-push generate-vapid-keys` |
| `VITE_VAPID_PUBLIC_KEY` | אותו public key, לצד הלקוח |
| `VAPID_SUBJECT` | `mailto:` שלך |
| `PUSH_SECRET` | סוד לשליחת התראות |
| `APP_BASE_URL` | כתובת הבסיס של האפליקציה |
| `MANAGER_EMAIL` | יעד למיילים למנהל |
| `SUPERUSER_PASSWORD` | סיסמת ה-superuser |

הרצת מיגרציות ואז פיתוח:

```bash
npm run migrate
npm run dev
```

## תיעוד נוסף

[`GOOGLE_SHEETS_SETUP.md`](GOOGLE_SHEETS_SETUP.md) — הגדרת כתיבה חזרה
ל-Google Sheet דרך Apps Script.

## סודות

`.env` נמצא ב-`.gitignore` ומכיל סיסמאות, מפתחות VAPID וכתובות מייל
אמיתיות — הוא לא נכנס ל-repo. התבנית היא `.env.example`.

**הריפו הזה צריך להישאר private:** יש בו נתונים של מועדון אמיתי, כולל
כתובות מייל של אנשים.
