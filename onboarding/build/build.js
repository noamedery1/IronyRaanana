const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  ImageRun, Header, Footer, PageNumber, PageBreak, BorderStyle, LevelFormat,
} = require('docx');

const SHOTS = path.resolve(__dirname, '..', 'shots');
const OUT = path.resolve(__dirname, '..');
const LOGO = path.resolve(__dirname, '..', '..', 'public', 'men_logo.png');

// ---- palette ----
const AZURE = '1E78C8';
const CYAN = '0E8BA8';
const INK = '0B1220';
const DIM = '475569';

// ---- helpers ----
const png = (f) => fs.readFileSync(path.join(SHOTS, f));
const dims = (f) => { const b = png(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// scale an image to a max display width (px), preserving aspect ratio
function img(file, maxW) {
  const { w, h } = dims(file);
  const width = Math.min(maxW, w);
  const height = Math.round(width * h / w);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 200 },
    children: [new ImageRun({
      type: 'png', data: png(file),
      transformation: { width, height },
      altText: { title: file, description: file, name: file },
    })],
  });
}

// RTL paragraph helpers
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, bidirectional: true, alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, rightToLeft: true })],
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 120 },
    children: [new TextRun({ text, rightToLeft: true, size: opts.size || 22, color: opts.color, bold: opts.bold })],
  });
}
// a labelled line: bold lead ("מגדירים:") + body
function field(lead, body) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 60 },
    children: [
      new TextRun({ text: lead + '  ', rightToLeft: true, bold: true, color: CYAN, size: 22 }),
      new TextRun({ text: body, rightToLeft: true, size: 22 }),
    ],
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bul', level: 0 }, bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { after: 40 },
    children: [new TextRun({ text, rightToLeft: true, size: 22 })],
  });
}
function rule() {
  return new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AZURE, space: 1 } }, children: [new TextRun('')] });
}
function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// cover page block
function cover(roleTitle, roleSub) {
  const lg = dims('squadio-logo.png');
  const lw = 340, lh = Math.round(lw * lg.h / lg.w);
  return [
    new Paragraph({ spacing: { before: 1500, after: 260 }, alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: 'png', data: png('squadio-logo.png'),
        transformation: { width: lw, height: lh },
        altText: { title: 'Squadio', description: 'Squadio product logo', name: 'squadio-logo' },
      })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 },
      children: [new TextRun({ text: 'מערכת ניהול לוז אימונים לקבוצות ספורט', rightToLeft: true, size: 26, color: DIM })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
      children: [new TextRun({ text: roleTitle, rightToLeft: true, bold: true, size: 52, color: INK })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 },
      children: [new TextRun({ text: roleSub, rightToLeft: true, size: 28, color: CYAN })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: 'מדריך הכרה — צעד אחר צעד', rightToLeft: true, size: 24, color: DIM })] }),
    pageBreak(),
  ];
}

// shared doc options
function makeDoc(titleForHeader, children) {
  return new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 34, bold: true, font: 'Arial', color: AZURE },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 27, bold: true, font: 'Arial', color: INK },
          paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [
      { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { right: 360, hanging: 240 } } } }] },
    ] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCD6E0', space: 2 } },
        children: [new TextRun({ text: 'Squadio · ' + titleForHeader, rightToLeft: true, size: 16, color: DIM })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'עמוד ', rightToLeft: true, size: 16, color: DIM }),
                   new TextRun({ children: [PageNumber.CURRENT], size: 16, color: DIM })] })] }) },
      children,
    }],
  });
}

const DESK = 600; // desktop screenshot display width (px)
const MOB = 250;  // mobile screenshot display width (px)

// step block: title, optional intro, field lines, bullets, image
function step(num, title, opts) {
  const out = [h2(`שלב ${num} · ${title}`)];
  if (opts.intro) out.push(p(opts.intro));
  (opts.fields || []).forEach(([l, b]) => out.push(field(l, b)));
  (opts.bullets || []).forEach((b) => out.push(bullet(b)));
  if (opts.shot) out.push(img(opts.shot, opts.mobile ? MOB : DESK));
  if (opts.after) out.push(p(opts.after, { color: DIM, size: 20 }));
  return out;
}

// =================== MANAGER ===================
function managerDoc() {
  const c = [];
  c.push(...cover('מדריך למנהל המועדון', 'הקמה וניהול שוטף של המערכת'));
  c.push(h1('מה המנהל עושה במערכת'));
  c.push(p('כמנהל המועדון יש לך דשבורד פרטי המנהל אך ורק את המועדון שלך. ממנו אתה מקים מאמנים ואולמות, בונה את לוז השבוע, מפרסם אותו להורים, מאשר בקשות שינוי מהמאמנים, ושולח הודעות. כל הנתונים נשמרים במסד הנתונים (DB) של המערכת — הדבר היחיד שנשאר "אקסל זמני" הוא גיליון הטיוטה שלך עד לרגע הפרסום.'));
  c.push(p('להלן כל שלב, לפי הסדר, עם צילום מסך אמיתי מהמערכת.', { color: DIM, size: 20 }));
  c.push(rule());

  c.push(...step(1, 'כניסת מנהל', {
    intro: 'היכנס לכתובת המועדון שלך בתוספת ‎/admin (לדוגמה: ‎/raanana/admin). הזן שם משתמש וסיסמה שקיבלת. המערכת זוכרת אותך במכשיר כך שלא תצטרך להתחבר כל פעם מחדש.',
    fields: [['מגדירים:', 'שם משתמש + סיסמה של המנהל.'], ['רואים:', 'מסך כניסה נקי עם שם המועדון.']],
    shot: 'm01-login.png',
  }));
  c.push(pageBreak());

  c.push(...step(2, 'הגדרות מערכת — חיבור לגיליון הטיוטה', {
    intro: 'בלשונית "⚙️ הגדרות מערכת" מדביקים את הקישור לגיליון ה‑Google Sheet שמשמש כטיוטה השבועית. זהו ה"אקסל הזמני" — המקום היחיד שבו אתה עורך לוז לפני פרסום. כל שאר ההגדרות כבר נשמרות ב‑DB.',
    fields: [['מגדירים:', 'כתובת ה‑CSV של גיליון הטיוטה + כתובת השמירה (Web App).'], ['רואים:', 'אישור חיבור; אחרי חיבור נפתחות הלשוניות "בניית שבוע" ו"תצוגה מקדימה".']],
    shot: 'm02-setup.png',
  }));
  c.push(pageBreak());

  c.push(...step(3, 'הקמת מאמנים', {
    intro: 'בלשונית "👤 ניהול מאמנים" מוסיפים כל מאמן: שם (כפי שמופיע בלוח), קוד אישי לכניסה, וסימון הקבוצות שלו. המאמן ייכנס לפורטל המאמנים עם השם והקוד ויראה רק את הקבוצות שלו.',
    fields: [['מגדירים:', 'שם מאמן · קוד אישי · קבוצות (אפשר כמה).'], ['רואים:', 'רשימת כל המאמנים הקיימים, עם עריכה/מחיקה לכל אחד.']],
    bullets: ['הקוד האישי הוא מה שהמאמן יקליד בכניסה — מסרו לו אותו.', 'אפשר לשייך מאמן לכמה קבוצות בבת אחת.'],
    shot: 'm08-trainers.png',
  }));
  c.push(pageBreak());

  c.push(...step(4, 'הקמת אולמות', {
    intro: 'בלשונית "🏟️ הגדרת אולמות" מגדירים את האולמות והכתובות שלהם. הכתובת שמוזנת כאן היא זו שתופיע להורים ככפתור "ניווט במפות", כך שהם מגיעים בדיוק למקום.',
    fields: [['מגדירים:', 'שם אולם + כתובת לניווט (לכל אולם).'], ['רואים:', 'רשימת האולמות; אפשר לערוך כתובת או להסתיר אולם שלא בשימוש.']],
    shot: 'm07-halls.png',
  }));
  c.push(pageBreak());

  c.push(...step(5, 'בניית שבוע — הגדרות שבועיות לכל קבוצה', {
    intro: 'בלשונית "📅 בניית שבוע" (נפתחת אחרי החיבור לגיליון) מגדירים לכל קבוצה את חוקי השבוע: מספר אימונים בשבוע, משך כל אימון (בדקות), והאם להפעיל אילוץ/שיבוץ אוטומטי. אלו הכללים שעל בסיסם נבנה השבוע.',
    fields: [['מגדירים:', 'לכל קבוצה — מס׳ אימונים, משך, ואילוצים.'], ['רואים:', 'טבלת כל הקבוצות עם החוקים, וכפתור "הפעל אילוץ" לשיבוץ אוטומטי.']],
    bullets: ['העריכה המלאה של השעות והאולמות מתבצעת בגיליון הטיוטה (ה"אקסל הזמני").', 'כאן קובעים את המסגרת; השיבוץ עצמו נראה בתצוגה המקדימה.'],
    shot: 'm03-weekbuilder.png',
  }));
  c.push(pageBreak());

  c.push(...step(6, 'תצוגה מקדימה של הלוז', {
    intro: 'בלשונית "👁️ תצוגה מקדימה" רואים את כל השבוע שנבנה כטבלה מלאה — קבוצות מול ימים, עם כל האימונים בצבעים. כאן בודקים שהכל תקין ומסודר לפני שמפרסמים להורים.',
    fields: [['רואים:', 'את כל אימוני השבוע בטבלה אחת (קבוצות × ימים), עם שעות ואולמות.'], ['בודקים:', 'התנגשויות, חוסרים או טעויות — לפני הפרסום.']],
    shot: 'm03b-preview.png',
  }));
  c.push(pageBreak());

  c.push(...step(7, 'פרסום הלוז להורים', {
    intro: 'כשהשבוע מוכן ובדוק — נכנסים ללשונית "🚀 פרסם לוז" ולוחצים על הכפתור הירוק. המערכת לוקחת תמונת מצב של הטיוטה, שומרת אותה כשבוע ה"חי" ב‑DB עם תאריך, ומאותו רגע כל ההורים רואים את הלוז המעודכן (וגם מקבלים התראה).',
    fields: [['עושים:', 'לחיצה אחת על "פרסם לוז".'], ['רואים:', 'טבלת "פרסומים אחרונים" — כל פרסום עם תאריך, מס׳ אימונים וסטטוס (חי/ארכיון).']],
    bullets: ['הפרסום הקודם נשמר אוטומטית בארכיון — שום מידע לא נמחק.', 'כל פרסום מתועד עם השעה ומי ביצע אותו.', 'עד לרגע הלחיצה — ההורים עדיין רואים את הלוז הקודם; הפרסום הוא הרגע שבו "הכל יוצא לאוויר".'],
    shot: 'm04-publish.png',
  }));
  c.push(pageBreak());

  c.push(...step(8, 'צפייה בארכיון לוז', {
    intro: 'בכל שורה בטבלת הפרסומים יש כפתור "👁️ צפה". לחיצה עליו פותחת בדיוק את הלוז שפורסם באותו תאריך, מסודר לפי ימים — נוח לבדוק "מה היה בשבוע שעבר".',
    fields: [['רואים:', 'כל האימונים של אותו פרסום, מקובצים לפי יום ושעה.']],
    shot: 'm05-archive.png',
  }));
  c.push(pageBreak());

  c.push(...step(9, 'אישור בקשות שינוי ממאמנים', {
    intro: 'כשמאמן מבקש שינוי/ביטול/העברת אימון, הבקשה מגיעה ללשונית "✅ בקשות לאישור" (וגם כהתראה אליך). לכל בקשה יש את הפרטים והסיבה, ושני כפתורים: "אשר" או "דחה". אישור מעדכן מיד את הלוז החי ב‑DB ושולח התראה לקבוצה.',
    fields: [['רואים:', 'את הבקשה: קבוצה, אימון נוכחי, השינוי המבוקש והסיבה.'], ['עושים:', 'לחיצה על "אשר" (מעדכן את הלוז) או "דחה".']],
    shot: 'm06-approvals.png',
  }));
  c.push(pageBreak());

  c.push(...step(10, 'הודעה צפה (באנר נע להורים)', {
    intro: 'בלשונית "📣 הודעה צפה" כותבים הודעה שרצה כבאנר נע בראש דף ההורים. כל שורה היא הודעה נפרדת — אם תכתוב כמה שורות, הן יתחלפו ברצף. אפשר להדליק/לכבות בכל רגע.',
    fields: [['מגדירים:', 'טקסט ההודעה (שורה = הודעה) + מתג הפעלה.'], ['ההורים רואים:', 'באנר נע בצבעי המותג בראש הדף.']],
    shot: 'm09-messages.png',
  }));
  c.push(pageBreak());

  c.push(...step(11, 'שליחת התראות (Push) — כולל בחירה מרובה', {
    intro: 'בלשונית "📢 הודעות" שולחים התראה ישירה למכשירים. אפשר לשלוח לכל המועדון, לכל המאמנים/המפעילים, או לבחור מספר מאמנים או מספר קבוצות יחד (בחירה מרובה) ולשלוח לכולם בבת אחת.',
    fields: [['בוחרים:', 'יעד — כל המועדון / מאמנים / קבוצות (אפשר לסמן כמה).'], ['שולחים:', 'טקסט ההודעה → "שלח הודעה".']],
    shot: 'm12-push-multi.png',
  }));
  c.push(pageBreak());

  c.push(...step(12, 'לינקי הזמנה להורים ולמפעילים', {
    intro: 'בלשונית "🔗 לינקי הזמנה" יוצרים קישור הרשמה אישי לכל קבוצה. שולחים את הלינק להורים (למשל בוואטסאפ הקבוצתי); מי שנרשם דרכו ננעל אוטומטית לקבוצה שלו ויראה רק אותה.',
    fields: [['יוצרים:', 'לינק לפי קבוצה (חבר קבוצה) או לינק מפעיל.'], ['שולחים:', 'את הלינק להורים — הם נרשמים בלחיצה.']],
    shot: 'm10-invites.png',
  }));
  c.push(rule());
  c.push(p('טיפ: בתחתית המסך יש מתג מעבר מהיר בין תצוגות (הורים / מאמן / ניהול) — מופיע רק למנהלים ומאמנים מחוברים, ההורים לא רואים אותו.', { color: DIM, size: 20 }));

  return makeDoc('מדריך למנהל', c);
}

// =================== TRAINER ===================
function trainerDoc() {
  const c = [];
  c.push(...cover('מדריך למאמן', 'צפייה באימונים ובקשות שינוי'));
  c.push(h1('מה המאמן עושה במערכת'));
  c.push(p('כמאמן אתה רואה את האימונים של הקבוצות שלך בלבד, ויכול לבקש שינוי, ביטול או העברת אימון — הבקשה נשלחת למנהל לאישור. אפשר גם להציע למנהל שיבוץ שבועי שלם לקבוצה. הכל מהטלפון, בלי התקנה מסובכת.'));
  c.push(rule());

  c.push(...step(1, 'כניסת מאמן', {
    intro: 'נכנסים לכתובת המועדון בתוספת ‎/trainer (לדוגמה ‎/raanana/trainer). מקלידים את השם (כפי שהמנהל הזין בלוח) ואת הקוד האישי שקיבלת מהמנהל. המערכת זוכרת אותך — לא צריך להתחבר כל פעם.',
    fields: [['מקלידים:', 'שם מאמן + קוד אישי.'], ['רואים:', 'מסך כניסה של "פורטל מאמנים".']],
    shot: 't01-login.png', mobile: true,
  }));

  c.push(...step(2, 'האימונים שלי', {
    intro: 'מיד אחרי הכניסה מופיעים כל האימונים שלך לשבוע, מסודרים לפי קבוצה ויום, עם שעה ומיקום. יש מסננים לפי קבוצה ולפי יום. כפתור "הפעל התראות" מבטיח שתקבל הודעות מהמנהל.',
    fields: [['רואים:', 'רשימת האימונים שלך עם שעה ומקום.'], ['אפשר:', 'לסנן לפי קבוצה/יום, ולהפעיל התראות.']],
    shot: 't02-dashboard.png', mobile: true,
  }));
  c.push(pageBreak());

  c.push(...step(3, 'בקשת שינוי / ביטול / העברת אימון', {
    intro: 'בכל אימון יש כפתור עיפרון ✏️. לחיצה עליו פותחת חלון בקשה: בוחרים את סוג הבקשה — "שינוי פרטים", "החלפת יום" או "ביטול אימון" — ממלאים שעה/מיקום חדשים אם צריך, וחובה לכתוב סיבה. הבקשה נשלחת למנהל לאישור (לא משנה את הלוז עד שהמנהל מאשר).',
    fields: [['בוחרים:', 'סוג בקשה (שינוי / החלפת יום / ביטול).'], ['ממלאים:', 'שעה/מיקום חדשים + סיבה (חובה).'], ['שולחים:', '"שלח לאישור" → מגיע למנהל.']],
    shot: 't03-change-modal.png', mobile: true,
  }));
  c.push(pageBreak());

  c.push(...step(4, 'הזנת לו"ז (הצעת שיבוץ שבועי)', {
    intro: 'בלשונית "הזנת לו\\"ז" אפשר להציע למנהל שיבוץ שלם לקבוצה: לכל יום מזינים שעה ואולם. ההצעות נכתבות אצל המנהל ומסומנות כ"הצעה" — והוא מאשר או משבץ מחדש. נוח לתחילת עונה.',
    fields: [['ממלאים:', 'לכל יום — שעה + אולם.'], ['שולחים:', '"שלח הצעות למנהל".']],
    shot: 't04-propose.png', mobile: true,
  }));
  c.push(rule());
  c.push(p('הערה: ההתראות והבקשות מגיעות ישירות למנהל המועדון — מי שולח ולאן נקבע אוטומטית לפי המועדון והקבוצות שלך.', { color: DIM, size: 20 }));

  return makeDoc('מדריך למאמן', c);
}

// =================== PARENTS ===================
function parentsDoc() {
  const c = [];
  c.push(...cover('מדריך להורים', 'הלו"ז האישי של הקבוצה שלכם'));
  c.push(h1('מה ההורים מקבלים'));
  c.push(p('כהורה אתם מקבלים מהמועדון לינק הרשמה אישי. אחרי הרשמה קצרה, הדף נפתח ישירות על הקבוצה של הילד/ה — בלי לחפש ברשימות. רואים את האימון הקרוב, מיקום עם ניווט, הלו"ז השבועי המלא, ומקבלים התראות ועדכונים מהמועדון.'));
  c.push(rule());

  c.push(...step(1, 'מסך פתיחה למי שעוד לא נרשם', {
    intro: 'מי שמגיע לאתר בלי להירשם רואה מסך הסבר קצר עם הלוגו של המועדון, ומופנה להירשם דרך הלינק האישי. כך הלו"ז נשאר אישי ומסודר.',
    fields: [['רואים:', 'הסבר קצר + לחצן מידע על המערכת.'], ['עושים:', 'נרשמים דרך הלינק שקיבלתם מהמועדון.']],
    shot: 'p01-gate.png', mobile: true,
  }));

  c.push(...step(2, 'הרשמה דרך הלינק', {
    intro: 'הלינק שהמנהל שולח כבר יודע לאיזו קבוצה אתם שייכים (מופיע למעלה כתגית). ממלאים שם, ואימייל או טלפון — וזהו. ההרשמה גם מצרפת אתכם לעדכונים.',
    fields: [['ממלאים:', 'שם + אימייל או טלפון.'], ['מקבלים:', 'כניסה ישירה ללו"ז של הקבוצה שלכם.']],
    shot: 'p02-join.png', mobile: true,
  }));
  c.push(pageBreak());

  c.push(...step(3, 'האימון הקרוב + ניווט', {
    intro: 'מיד עם הכניסה רואים את האימון הקרוב של הקבוצה: שעה, מאמן ומיקום, עם כפתור "ניווט במפות" שמוביל ישר לאולם. אפשר גם לשמור ליומן, להירשם לעדכוני יומן, או לשתף בוואטסאפ.',
    fields: [['רואים:', 'אימון קרוב · שעה · מאמן · מיקום על מפה.'], ['אפשר:', 'ניווט, שמירה ליומן, שיתוף בוואטסאפ.']],
    shot: 'p03-schedule.png', mobile: true,
  }));
  c.push(pageBreak());

  c.push(...step(4, 'הלו"ז השבועי המלא', {
    intro: 'גלילה מטה מציגה את כל השבוע של הקבוצה כציר זמן ברור — יום אחרי יום, עם השעות והמיקומים. ההורה לא צריך לבחור קבוצה: הדף כבר אישי ונעול לקבוצה שלכם.',
    fields: [['רואים:', 'את כל אימוני השבוע של הקבוצה, מסודר לפי יום.']],
    shot: 'p04-weekly.png', mobile: true,
  }));
  c.push(pageBreak());

  c.push(...step(5, 'הודעות מהמועדון', {
    intro: 'בראש הדף רץ באנר נע עם הודעות מהמועדון (משחקים, הרשמות, ביטולים). אם יש כמה הודעות הן מתחלפות ברצף. בנוסף, מקבלים התראות Push ישירות לטלפון.',
    fields: [['רואים:', 'באנר הודעות נע בראש הדף.'], ['מקבלים:', 'התראות לטלפון על שינויים ועדכונים.']],
    shot: 'p05-ticker.png', mobile: true,
  }));
  c.push(rule());
  c.push(p('טיפ: אפשר להתקין את האתר כאפליקציה במסך הבית (כפתור "התקנה") — וליהנות מפתיחה מהירה והתראות.', { color: DIM, size: 20 }));

  return makeDoc('מדריך להורים', c);
}

// ---- write all ----
const jobs = [
  ['Squadio-Onboarding-Manager.docx', managerDoc()],
  ['Squadio-Onboarding-Trainer.docx', trainerDoc()],
  ['Squadio-Onboarding-Parents.docx', parentsDoc()],
];
(async () => {
  for (const [name, doc] of jobs) {
    const buf = await Packer.toBuffer(doc);
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log('wrote', name, '(' + Math.round(buf.length / 1024) + ' KB)');
  }
})();
