import { createContext, useContext, useState, useEffect, useRef } from 'react';

// Lightweight i18n: dictionary + provider + hook + language switcher.
// Translates the UI chrome only; schedule data (team/hall names) stays in its source language.

export const LANGS = [
    { code: 'he', label: 'עברית', short: 'עב' },
    { code: 'ar', label: 'العربية', short: 'ع' },
    { code: 'ru', label: 'Русский', short: 'RU' },
    { code: 'en', label: 'English', short: 'EN' },
];
const RTL = ['he', 'ar'];

// Hebrew day name -> localized day name
const DAYS = {
    he: { 'ראשון': 'ראשון', 'שני': 'שני', 'שלישי': 'שלישי', 'רביעי': 'רביעי', 'חמישי': 'חמישי', 'שישי': 'שישי', 'שבת': 'שבת' },
    ar: { 'ראשון': 'الأحد', 'שני': 'الاثنين', 'שלישי': 'الثلاثاء', 'רביעי': 'الأربعاء', 'חמישי': 'الخميس', 'שישי': 'الجمعة', 'שבת': 'السبت' },
    ru: { 'ראשון': 'Воскресенье', 'שני': 'Понедельник', 'שלישי': 'Вторник', 'רביעי': 'Среда', 'חמישי': 'Четверг', 'שישי': 'Пятница', 'שבת': 'Суббота' },
    en: { 'ראשון': 'Sunday', 'שני': 'Monday', 'שלישי': 'Tuesday', 'רביעי': 'Wednesday', 'חמישי': 'Thursday', 'שישי': 'Friday', 'שבת': 'Saturday' },
};

// Hall/venue core-name translations (proper nouns transliterated). Foreign languages show
// "Translated (original Hebrew)"; Hebrew stays as-is. Team names are NOT translated.
const HALLS = {
    'מטרו': { ar: 'مترو', ru: 'Метро', en: 'Metro' },
    'השרון': { ar: 'هشارون', ru: 'ХаШарон', en: 'HaSharon' },
    'שרון': { ar: 'شارون', ru: 'Шарон', en: 'Sharon' },
    'דקל': { ar: 'دكيل', ru: 'Декель', en: 'Dekel' },
    'תלי': { ar: 'تالي', ru: 'Тали', en: 'Tali' },
    'זמר': { ar: 'زمر', ru: 'Земер', en: 'Zemer' },
    'פארק': { ar: 'بارك', ru: 'Парк', en: 'Park' },
    'יונתן': { ar: 'يوناتان', ru: 'Йонатан', en: 'Yonatan' },
    'אוסטרו': { ar: 'أوسترو', ru: 'Островски', en: 'Ostrovsky' },
    'יחדיו': { ar: 'يحديف', ru: 'Яхдав', en: 'Yahdav' },
    'אביב': { ar: 'أبيب', ru: 'Авив', en: 'Aviv' },
    'יובל': { ar: 'يوفال', ru: 'Юваль', en: 'Yuval' },
    'מור': { ar: 'مور', ru: 'Мор', en: 'Mor' },
    'אסייג': { ar: 'أسياج', ru: 'Асаяг', en: 'Assayag' },
    'רימון': { ar: 'ريمون', ru: 'Римон', en: 'Rimon' },
};

const DICT = {
    he: {
        brand_sub: 'מחלקת הכדורסל · לו"ז שבועי', men: 'גברים', women: 'נשים', admin: 'ניהול',
        select_team: 'בחר קבוצה', tab_team: 'לו"ז קבוצה', tab_halls: 'אולמות', tab_daily: 'יומי מרוכז',
        pick_team: 'נא לבחור קבוצה לצפייה בלו"ז', no_week: 'אין אימונים מתוכננים לשבוע זה',
        next_training: 'האימון הקרוב', no_next: 'אין אימון קרוב', today: 'היום', match: 'משחק', training: 'אימון', coach: 'מאמן',
        location: 'מיקום', venue_default: 'אולם האימון', pick_team_location: 'בחר קבוצה לצפייה במיקום', navigate: 'ניווט במפות', nav_with: 'נווט עם',
        share_whatsapp: 'שיתוף בוואטסאפ', cal_live: 'יומן מתעדכן', cal_save: 'שמור ליומן', updates: 'עדכונים',
        cal_live_title: 'הירשם ליומן שמתעדכן אוטומטית בכל שינוי', cal_save_title: 'הורדה חד-פעמית ליומן',
        full_week: 'לו"ז שבועי מלא', cancelled: 'בוטל', changed: 'שינוי', coach_edit_title: 'כניסת מאמן לעריכה', suggest: 'הצעה לשיפור',
        cal_choose: 'הוסף ליומן:', cal_apple: 'אייפון (Apple)', cal_android: 'יומן המכשיר (אנדרואיד)', cal_google: 'Google Calendar', cal_copy: 'העתק קישור', cal_copied: '✓ הועתק',
        cal_hint: 'אייפון = מנוי מתעדכן · אנדרואיד = הוספה מיידית · Google = הדבק את הקישור (שהועתק) בהגדרות › הוספת יומן › מכתובת',
        install_title: 'התקינו את האפליקציה 🏀', install_btn: 'התקנה', install_later: 'אחר כך', install_ios: 'להתקנה: הקישו על שיתוף ⬆ ואז "הוסף למסך הבית"',
        install_desc: 'הוסיפו את הלו"ז למסך הבית — נפתח כמו אפליקציה, במסך מלא וזמין במהירות.',
        install_manual: 'להתקנה: פתחו את תפריט הדפדפן (⋮ / שיתוף) ובחרו "הוסף למסך הבית".',
    },
    ar: {
        brand_sub: 'قسم كرة السلة · الجدول الأسبوعي', men: 'رجال', women: 'نساء', admin: 'الإدارة',
        select_team: 'اختر فريقاً', tab_team: 'جدول الفريق', tab_halls: 'القاعات', tab_daily: 'يومي',
        pick_team: 'يرجى اختيار فريق لعرض الجدول', no_week: 'لا توجد تمارين مجدولة هذا الأسبوع',
        next_training: 'التمرين القادم', no_next: 'لا يوجد تمرين قادم', today: 'اليوم', match: 'مباراة', training: 'تمرين', coach: 'مدرب',
        location: 'الموقع', venue_default: 'قاعة التمرين', pick_team_location: 'اختر فريقاً لعرض الموقع', navigate: 'فتح في الخرائط', nav_with: 'التنقّل عبر',
        share_whatsapp: 'مشاركة عبر واتساب', cal_live: 'تقويم محدّث', cal_save: 'حفظ في التقويم', updates: 'تحديثات',
        cal_live_title: 'اشترك في تقويم يتحدّث تلقائياً عند كل تغيير', cal_save_title: 'تنزيل لمرة واحدة',
        full_week: 'الجدول الأسبوعي الكامل', cancelled: 'أُلغي', changed: 'تغيير', coach_edit_title: 'دخول المدرب للتعديل', suggest: 'اقتراح للتحسين',
        cal_choose: 'أضف إلى التقويم:', cal_apple: 'آيفون (Apple)', cal_android: 'تقويم الجهاز (أندرويد)', cal_google: 'Google Calendar', cal_copy: 'نسخ الرابط', cal_copied: '✓ تم النسخ',
        cal_hint: 'آيفون = اشتراك محدّث · أندرويد = إضافة فورية · Google = الصق الرابط (المنسوخ) في الإعدادات › إضافة تقويم › من الرابط',
        install_title: 'ثبّت التطبيق 🏀', install_btn: 'تثبيت', install_later: 'لاحقاً', install_ios: 'للتثبيت: اضغط مشاركة ⬆ ثم "إضافة إلى الشاشة الرئيسية"',
        install_desc: 'أضِف الجدول إلى الشاشة الرئيسية — يُفتح كتطبيق بملء الشاشة ووصول سريع.',
        install_manual: 'للتثبيت: افتح قائمة المتصفح (⋮ / مشاركة) واختر "إضافة إلى الشاشة الرئيسية".',
    },
    ru: {
        brand_sub: 'Баскетбол · Недельное расписание', men: 'Мужчины', women: 'Женщины', admin: 'Админ',
        select_team: 'Выберите команду', tab_team: 'Расписание', tab_halls: 'Залы', tab_daily: 'По дням',
        pick_team: 'Выберите команду, чтобы увидеть расписание', no_week: 'На эту неделю тренировок нет',
        next_training: 'Ближайшая тренировка', no_next: 'Нет ближайших тренировок', today: 'Сегодня', match: 'Игра', training: 'Тренировка', coach: 'Тренер',
        location: 'Место', venue_default: 'Место тренировки', pick_team_location: 'Выберите команду', navigate: 'Открыть в картах', nav_with: 'Навигация через',
        share_whatsapp: 'Поделиться в WhatsApp', cal_live: 'Авто-календарь', cal_save: 'В календарь', updates: 'Обновления',
        cal_live_title: 'Подписка на авто-обновляемый календарь', cal_save_title: 'Разовая загрузка',
        full_week: 'Полное недельное расписание', cancelled: 'Отменено', changed: 'Изменение', coach_edit_title: 'Вход тренера', suggest: 'Предложение',
        cal_choose: 'Добавить в календарь:', cal_apple: 'iPhone (Apple)', cal_android: 'Календарь устройства (Android)', cal_google: 'Google Calendar', cal_copy: 'Копировать ссылку', cal_copied: '✓ Скопировано',
        cal_hint: 'iPhone = авто-подписка · Android = добавить сейчас · Google = вставьте ссылку в Настройки › Добавить календарь › по URL',
        install_title: 'Установите приложение 🏀', install_btn: 'Установить', install_later: 'Позже', install_ios: 'Чтобы установить: нажмите Поделиться ⬆ и «На экран «Домой»»',
        install_desc: 'Добавьте расписание на главный экран — откроется как приложение, на весь экран и под рукой.',
        install_manual: 'Чтобы установить: откройте меню браузера (⋮ / Поделиться) и выберите «На экран «Домой»».',
    },
    en: {
        brand_sub: 'Basketball Dept · Weekly Schedule', men: 'Men', women: 'Women', admin: 'Admin',
        select_team: 'Select a team', tab_team: 'Team schedule', tab_halls: 'Venues', tab_daily: 'Daily',
        pick_team: 'Select a team to view the schedule', no_week: 'No trainings scheduled this week',
        next_training: 'Next training', no_next: 'No upcoming training', today: 'Today', match: 'Game', training: 'Training', coach: 'Coach',
        location: 'Location', venue_default: 'Training venue', pick_team_location: 'Select a team to see location', navigate: 'Open in maps', nav_with: 'Navigate with',
        share_whatsapp: 'Share on WhatsApp', cal_live: 'Auto calendar', cal_save: 'Save to calendar', updates: 'Updates',
        cal_live_title: 'Subscribe to an auto-updating calendar', cal_save_title: 'One-time download',
        full_week: 'Full weekly schedule', cancelled: 'Cancelled', changed: 'Changed', coach_edit_title: 'Coach edit access', suggest: 'Suggest improvement',
        cal_choose: 'Add to calendar:', cal_apple: 'iPhone (Apple)', cal_android: 'Device calendar (Android)', cal_google: 'Google Calendar', cal_copy: 'Copy link', cal_copied: '✓ Copied',
        cal_hint: 'iPhone = live subscription · Android = add now · Google = paste the copied link in Settings › Add calendar › From URL',
        install_title: 'Install the app 🏀', install_btn: 'Install', install_later: 'Later', install_ios: 'To install: tap Share ⬆ then "Add to Home Screen"',
        install_desc: 'Add the schedule to your home screen — opens like an app, full-screen and a tap away.',
        install_manual: 'To install: open the browser menu (⋮ / Share) and choose "Add to Home Screen".',
    },
};

const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'he');
    useEffect(() => {
        localStorage.setItem('lang', lang);
        document.documentElement.lang = lang;
        document.documentElement.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
    }, [lang]);
    const t = (key) => (DICT[lang] && DICT[lang][key]) || DICT.he[key] || key;
    const localizeDay = (heDay) => (DAYS[lang] && DAYS[lang][heDay]) || heDay;
    const localizeHall = (loc) => {
        if (!loc || lang === 'he') return loc;
        const keys = Object.keys(HALLS).sort((a, b) => b.length - a.length);
        for (const k of keys) {
            if (loc.includes(k) && HALLS[k][lang]) return `${HALLS[k][lang]} (${loc})`;
        }
        return loc;
    };
    const dir = RTL.includes(lang) ? 'rtl' : 'ltr';
    return <I18nCtx.Provider value={{ lang, setLang, t, localizeDay, localizeHall, dir }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx) || { lang: 'he', t: (k) => DICT.he[k] || k, localizeDay: (d) => d, localizeHall: (l) => l, dir: 'rtl', setLang: () => {} };

export function LanguageSwitcher() {
    const { lang, setLang } = useI18n();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);
    const current = LANGS.find(l => l.code === lang) || LANGS[0];
    return (
        <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <button onClick={() => setOpen(o => !o)} title="Language / שפה"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text)', borderRadius: '10px', padding: '0.45rem 0.6rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                🌐 <span>{current.short}</span>
            </button>
            {open && (
                <div style={{ position: 'absolute', top: '120%', insetInlineEnd: 0, zIndex: 80, background: 'var(--ink2)', border: '1px solid var(--bd2)', borderRadius: '12px', padding: '0.4rem', boxShadow: '0 16px 40px -16px rgba(0,0,0,.8)', minWidth: '140px' }}>
                    {LANGS.map(l => (
                        <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }}
                            style={{ display: 'block', width: '100%', textAlign: 'start', background: l.code === lang ? 'var(--glass-2)' : 'transparent', border: 'none', color: 'var(--text)', borderRadius: '8px', padding: '0.5rem 0.7rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '0.9rem' }}>
                            {l.label}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
}
