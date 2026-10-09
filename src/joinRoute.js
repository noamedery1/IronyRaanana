import { encodePathSeg } from './encodeSeg.js';

// Given a resolved join code ({ clubSlug, team, role }) from /api/join/:code, the in-app path to open.
// Members land on their team's registration; operators on the operator board join; coaches on the
// trainer login (where they enter name + personal code). role defaults to 'member' (team code).
export function joinPathForCode(d) {
    const slug = d.clubSlug;
    if (d.role === 'operator') return `/${slug}/join/operator`;
    if (d.role === 'coach') return `/${slug}/trainer`;
    return `/${slug}/join/member/${encodePathSeg(d.team)}`;
}
