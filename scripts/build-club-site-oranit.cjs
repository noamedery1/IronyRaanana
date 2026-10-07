// One-off generator: derive the Maccabi Oranit landing page from the Hapoel Raanana template.
// Fails loudly if any expected template fragment is missing (so nothing Raanana-specific leaks through).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'club-sites');
let s = fs.readFileSync(path.join(root, 'hapoel-raanana', 'index.html'), 'utf8');
const R = (a, b) => { if (!s.includes(a)) throw new Error('MISSING: ' + a.slice(0, 80)); s = s.split(a).join(b); };
const RX = (re, b) => { if (!re.test(s)) throw new Error('MISSING RX: ' + re); s = s.replace(re, b); };

// identity
R('https://fcraanana.squadio.techbynoam.com/fcraanana', 'https://squadio.techbynoam.com/macabioranit');
R('fcraanana', 'macabioranit');
R('<title>הפועל רעננה — מחלקת הנוער והילדים | הרשמה לעונת 2026/27</title>', '<title>מכבי אורנית כדורגל — בית ספר לכדורגל ומחלקת ילדים | הרשמה לעונת 2026/27</title>');
RX(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="מכבי אורנית כדורגל — 6 קבוצות מהגן ועד מחלקת הילדים, מאמנים מקצועיים ואפליקציית Squadio להורים. הרשמה לעונה." />');
RX(/<meta property="og:description" content="[^"]*" \/>/, '<meta property="og:description" content="6 קבוצות, 4 מאמנים, לו״ז חי באפליקציה. הרשמה לעונת 2026/27." />');
R('<meta property="og:title" content="הפועל רעננה — בואו לשחק איתנו" />', '<meta property="og:title" content="מכבי אורנית — בואו לשחק איתנו" />');
R("HAPOEL RA'ANANA • FOOTBALL ACADEMY • HAPOEL RA'ANANA • ", 'MACCABI ORANIT F.C. • FOOTBALL ACADEMY • MACCABI ORANIT F.C. • ');

// colors: red -> Maccabi blue, black -> navy
R('--red:#d90b18; --red-d:#a3060f; --ink:#0d0d0f; --ink2:#18181c;', '--red:#1f6fc5; --red-d:#0f4c8f; --ink:#0a1730; --ink2:#12213f;');
R('rgba(217,11,24', 'rgba(31,111,197');
R('#ff3b45', '#4fa3f0');
R('<meta name="theme-color" content="#d90b18" />', '<meta name="theme-color" content="#1f6fc5" />');
R('.art-b .crest-wm{position:absolute;', '.art-b .crest-wm{position:absolute;border-radius:50%;');
R('.nav.solid{background:rgba(13,13,15,.92)', '.nav.solid{background:rgba(10,23,48,.94)');

// copy (club-specific sentences first, then the generic name swap)
R('<span class="l"><span>באדום.</span></span>', '<span class="l"><span>בכחול.</span></span>');
R('מחלקת הכדורגל של הפועל רעננה — מגן חובה ועד הנוער. מאמנים מקצועיים, מגרשים מעולים בלב העיר, וקהילה שמרגישה כמו בית.', 'מועדון הכדורגל של אורנית — מהגן ועד מחלקת הילדים. מאמנים מקצועיים, אווירה משפחתית, וקהילה שמרגישה כמו בית.');
R('הפועל רעננה היא מחלקת הכדורגל הקהילתית של העיר. אצלנו כל ילד וילדה מוצאים מקום — מהצעד הראשון עם הכדור בגן, דרך ליגות הילדים ועד הנוער.', 'מכבי אורנית הוא מועדון הכדורגל הקהילתי של אורנית. אצלנו כל ילד וילדה מוצאים מקום — מהצעד הראשון עם הכדור בגן ועד קבוצות הטרום והילדים.');
R('מקום שמחבר ילדים, הורים ושכונות — בתוך רעננה ולמען רעננה.', 'מקום שמחבר ילדים, הורים ושכנים — באורנית ולמען אורנית.');
R('מתחילים ומתקדמים, מהגן ועד הנוער — מסלול מתאים לכל ילד.', 'מתחילים ומתקדמים, מהגן ועד מחלקת הילדים — מסלול מתאים לכל ילד.');
R('מחלקת הכדורגל לילדים ונוער · רעננה', 'מועדון הכדורגל של אורנית');
R('<div class="big-bg" aria-hidden="true">הפועל</div>', '<div class="big-bg" aria-hidden="true">מכבי</div>');
R('הפועל רעננה', 'מכבי אורנית');
R('<div class="stat"><b data-count="16">0</b><span>קבוצות ליגה</span></div>', '<div class="stat"><b data-count="6">0</b><span>קבוצות</span></div>');
R('<div class="stat"><b data-count="5">0</b><span>קבוצות לגיל הרך</span></div>', '<div class="stat"><b data-count="4">0</b><span>מאמנים מקצועיים</span></div>');
R('<div class="stat"><b data-count="64">0</b><span>אימונים בשבוע</span></div>', '<div class="stat"><b data-count="13">0</b><span>אימונים בשבוע</span></div>');
R('<div class="stat"><b data-count="15">0</b><span>מאמנים מקצועיים</span></div>', '<div class="stat"><b data-count="3">0</b><span>מגרשי אימון</span></div>');
R('<div class="bnum"><b>16</b><span>קבוצות ליגה<br/>+ 5 לגיל הרך</span></div>', '<div class="bnum"><b>6</b><span>קבוצות<br/>מהגן ועד ילדים ג׳</span></div>');
R('<div class="sticker">מגיל<br/>5 ⚽</div>', '<div class="sticker">מגיל<br/>הגן ⚽</div>');
R("יש לנו קבוצות מגן חובה / כיתה א' ועד הנוער.", 'יש לנו קבוצות מגיל הגן (בית הספר לכדורגל) ועד ילדים ג׳ (בערך כיתה ה׳).');

// squadio phone demo
RX(/<div class="top"><b>[^<]*<\/b>/, '<div class="top"><b>טרום א׳ · השבוע</b>');
RX(/<div class="sess"><small>ראשון<\/small>[\s\S]*?<div class="sess"><small>חמישי<\/small>[^\n]*\n/,
`<div class="sess"><small>ראשון</small><b class="t">15:00–16:30</b><em>אמפי שערי תקווה</em></div>
          <div class="sess"><small>שלישי</small><b class="t">16:30–18:00</b><em>אמפי שערי תקווה</em></div>
          <div class="sess" id="demoSess"><small>חמישי · היום</small><b><span class="old t" id="oldTxt"></span> <span class="t" id="newTxt">18:00–19:30</span></b><em id="demoPlace">אמפי שערי תקווה</em></div>
`);
RX(/<span id="notifTxt">[^<]*<\/span>/, '<span id="notifTxt">אימון טרום א׳ היום עבר למיניפיץ גוונים 18:30</span>');
RX(/const SCRIPT = \[[\s\S]*?\];/, `const SCRIPT = [
  ['אימון טרום א׳ היום הוזז לשעה 18:30, מיניפיץ גוונים', '18:30–20:00', 'מיניפיץ גוונים'],
  ['האימון של היום בוטל בגלל מזג האוויר 🌧️', 'בוטל', 'אמפי שערי תקווה'],
];`);
R("newT.textContent = '17:30–19:00'; place.textContent = 'לב הפארק · תחתון';", "newT.textContent = '18:00–19:30'; place.textContent = 'אמפי שערי תקווה';");
R("oldT.textContent = '17:30–19:00';", "oldT.textContent = '18:00–19:30';");

// data
const a = s.indexOf('const VENUES = {'), b = s.indexOf('].map(([cat,name,age,coach,slots])');
if (a < 0 || b < 0) throw new Error('data block not found');
s = s.slice(0, a) + `const VENUES = {
  amfi:   { name:'אמפי שערי תקווה', addr:'', q:'אמפי שערי תקווה', tags:['קבוצות הטרום'], desc:'מגרש האימונים של קבוצות הטרום בשערי תקווה.' },
  gvanim: { name:'מיניפיץ גוונים', addr:'', q:'מיניפיץ גוונים', tags:['מיניפיץ'], desc:'מגרש מיניפיץ לאימוני הקבוצות הצעירות.' },
  field:  { name:'מגרש הכדורגל אורנית', addr:'מבוא אורנית 2, אורנית', tags:['המגרש של המועדון'], desc:'מגרש הכדורגל של אורנית.' },
};
const HALL = {
  'אמפי שערי תקווה':['amfi','אמפי שערי תקווה'], 'מיניפיץ גוונים':['gvanim','מיניפיץ גוונים'], 'מגרש כדורגל אורנית':['field','מגרש הכדורגל אורנית'],
};

const CATS = [
  { id:'school', name:'בית ספר לכדורגל', blurb:'הכרות ראשונה עם הכדור — משחק, תנועה וכיף. מתאים גם למי שמעולם לא שיחק.' },
  { id:'kids',   name:'מחלקת ילדים', blurb:'קבוצות הטרום והילדים — אימון מקצועי מדורג ומשחקי ליגה.' },
];

// Teams — from the live Squadio board (week of 27.9.2026). Ages are approximate; placement by birth year with the secretary.
// slot: [dayIndex, start, end, hall]
const TEAMS = [
  ['school','ביה"ס לכדורגל','גיל הגן – כיתה א׳','גילי נוי',[]],
  ['kids','טרום ג','כיתה ב׳','טל ינובסקי',[[0,'16:30','18:00','מיניפיץ גוונים'],[2,'18:15','19:45','מיניפיץ גוונים']]],
  ['kids','טרום ב צפון','כיתה ג׳','אורי סלם',[[0,'18:00','19:30','אמפי שערי תקווה'],[2,'10:00','11:30','מיניפיץ גוונים'],[4,'10:00','11:30','מיניפיץ גוונים']]],
  ['kids','טרום ב דרום','כיתה ג׳','אורי סלם',[[0,'18:00','19:30','אמפי שערי תקווה'],[2,'10:00','11:30','מיניפיץ גוונים'],[4,'10:00','11:30','מיניפיץ גוונים']]],
  ['kids','טרום א','כיתה ד׳','טל ינובסקי',[[0,'15:00','16:30','אמפי שערי תקווה'],[2,'16:30','18:00','אמפי שערי תקווה'],[4,'18:00','19:30','אמפי שערי תקווה']]],
  ['kids','ילדים ג','כיתה ה׳','נאור פסר',[[2,'09:30','11:00','מיניפיץ גוונים'],[4,'09:30','11:00','מיניפיץ גוונים']]],
` + s.slice(b);

// robustness: venues without a street address, teams without published slots
R("(HALL[s[3]]||['park'])[0]", "(HALL[s[3]]||['amfi'])[0]");
R("const [vk, label] = HALL[h] || ['park', h];", "const [vk, label] = HALL[h] || ['amfi', h];");
R('encodeURIComponent(v.addr)', 'encodeURIComponent(v.q || v.addr)');
R('<p>📍 ${esc(v.addr)}</p>', "<p>📍 ${esc(v.addr || 'כתובת מדויקת תימסר בהרשמה')}</p>");
R('<span class="more">${t.slots.length} אימונים בשבוע · פרטים והרשמה</span>', "<span class=\"more\">${t.slots.length ? t.slots.length + ' אימונים בשבוע' : 'ימי אימון — בקרוב'} · פרטים והרשמה</span>");
R("$('#tdSlots').innerHTML = t.slots.slice()", "$('#tdSlots').innerHTML = !t.slots.length ? '<p style=\"color:var(--muted)\">ימי ושעות האימון יפורסמו בקרוב — המזכירות תעדכן אתכם בהרשמה.</p>' : t.slots.slice()");

const out = path.join(root, 'maccabi-oranit');
fs.mkdirSync(path.join(out, 'img'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), s);
fs.writeFileSync(path.join(out, 'CNAME'), 'maccabi-oranit.techbynoam.com\n');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'img', 'README.txt'), 'Drop hero.jpg / team.jpg / kids.jpg here to replace the illustrations.\n');
console.log('ok', s.length);
