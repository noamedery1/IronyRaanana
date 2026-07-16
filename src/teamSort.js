// Shared team ordering used everywhere teams are listed/picked (teams screen,
// constraints, the schedule board, …). Non-destructive — always returns a new array.
//
// Teams come in two shapes: the DB `teams` row uses { gender }, while the
// builder/rules rows use { type }. Both carry { name } and (optionally) { age }.

const genderOf = (t) => t.gender || t.type || '';
const ageOf = (t) => (t.age ?? '').toString().trim();

export const SORT_MODES = [
    { value: 'name', label: 'א-ב' },
    { value: 'age', label: 'גיל' },
    { value: 'gender', label: 'מגדר' },
];

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'he', { numeric: true });

export function sortTeams(list, mode = 'name') {
    const arr = [...(list || [])];
    if (mode === 'age') {
        return arr.sort((a, b) => {
            const aa = ageOf(a), bb = ageOf(b);
            if (!aa && !bb) return byName(a, b);
            if (!aa) return 1;   // teams without an age go last
            if (!bb) return -1;
            const c = aa.localeCompare(bb, 'he', { numeric: true });
            return c !== 0 ? c : byName(a, b);
        });
    }
    if (mode === 'gender') {
        const rank = (t) => (genderOf(t) === 'W' ? 1 : 0); // בנים first, then בנות
        return arr.sort((a, b) => (rank(a) - rank(b)) || byName(a, b));
    }
    return arr.sort(byName); // 'name' (א-ב)
}
