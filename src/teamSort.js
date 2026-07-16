// Shared team ordering used everywhere teams are listed/picked (teams screen,
// constraints, the schedule board, …). Non-destructive — always returns a new array.
//
// Teams come in two shapes: the DB `teams` row uses { gender }, while the
// builder/rules rows use { type }. Both carry { name } and (optionally) { age }.

const genderOf = (t) => t.gender || t.type || '';
const ageOf = (t) => (t.age ?? '').toString().trim();
const gradeOf = (t) => (t.grade ?? '').toString().trim();

export const SORT_MODES = [
    { value: 'name', label: 'א-ב' },
    { value: 'age', label: 'גיל' },
    { value: 'grade', label: 'כיתה' },
    { value: 'gender', label: 'מגדר' },
];

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'he', { numeric: true });

// Sort by an optional text field (age/grade): empties last, then natural compare, then name.
const byField = (get) => (a, b) => {
    const aa = get(a), bb = get(b);
    if (!aa && !bb) return byName(a, b);
    if (!aa) return 1;
    if (!bb) return -1;
    const c = aa.localeCompare(bb, 'he', { numeric: true });
    return c !== 0 ? c : byName(a, b);
};

export function sortTeams(list, mode = 'name') {
    const arr = [...(list || [])];
    if (mode === 'age') return arr.sort(byField(ageOf));
    if (mode === 'grade') return arr.sort(byField(gradeOf));
    if (mode === 'gender') {
        const rank = (t) => (genderOf(t) === 'W' ? 1 : 0); // בנים first, then בנות
        return arr.sort((a, b) => (rank(a) - rank(b)) || byName(a, b));
    }
    return arr.sort(byName); // 'name' (א-ב)
}
