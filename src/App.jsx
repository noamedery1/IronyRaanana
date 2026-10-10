import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import PublicSchedule from './pages/PublicSchedule';
import PublicScheduleWomen from './pages/PublicScheduleWomen';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import TrainerPortal from './pages/TrainerPortal';
import Join from './pages/Join';
import CodeJoin from './pages/CodeJoin';
import SmartJoin from './pages/SmartJoin';
import Account from './pages/Account';
import SuperUser from './pages/SuperUser';
import NoClub from './pages/NoClub';
import ErrorPage from './pages/ErrorPage';
import FeedbackModal from './components/FeedbackModal';
import InstallPrompt from './components/InstallPrompt';
import { useI18n } from './i18n.jsx';
import { isKnownClub } from './clubConfig.js';
import { isManagerOf } from './adminApi.js';
import './App.css';

// Root ("/") → the product sales page (the server also serves it; this covers in-app nav).
const RootRedirect = () => {
  window.location.replace('/sales-landing.html');
  return null;
};

// Gate every club-scoped route: the URL must carry a real, registered club slug.
// A link without a valid club (e.g. /admin, an unknown slug) shows "not connected to a club".
const RequireClub = ({ children }) => {
  const { club } = useParams();
  if (!isKnownClub(club)) return <NoClub />;
  return children;
};

// A manager or coach who signed in on this device keeps their session (manager: isAdmin + per-club
// mgrToken; coach: trainerToken/trainerInfo) in localStorage — but after going "home" to the native
// launcher and reopening the club they land on the public schedule with no obvious way back to their
// own screen. These persistent pills give them one from anywhere (welcome gate, schedule, …). One
// person can hold several roles, so both pills can show at once. Hidden on the admin/trainer routes
// themselves; the real auth (ProtectedRoute + per-club token, trainer token) still gates access.
const RoleReturn = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const parts = location.pathname.split('/').filter(Boolean);
  const slug = parts[0];
  const seg = parts[1];
  let isManager = false;
  let isCoach = false;
  try {
    // Per-club: only a valid manager token FOR THIS club counts (decoded + club-matched), never the
    // global isAdmin flag — otherwise a manager of club A sees a "back to management" pill on club B.
    isManager = Boolean(slug) && isManagerOf(slug);
    isCoach = Boolean(localStorage.getItem('trainerToken'));
  } catch { /* storage blocked */ }
  const showManager = isManager && seg !== 'admin';
  const showCoach = isCoach && seg !== 'trainer';
  if (!showManager && !showCoach) return null;
  const pill = (bg, shadow) => ({
    border: 'none', color: '#fff', padding: '0.55rem 1.05rem', borderRadius: '30px',
    background: bg, boxShadow: shadow, cursor: 'pointer', fontWeight: 800, fontSize: '0.88rem',
    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem',
  });
  return (
    <div style={{
      position: 'fixed', top: 'max(12px, env(safe-area-inset-top))', left: '50%',
      transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
      justifyContent: 'center', maxWidth: '96vw',
    }}>
      {showManager && (
        <button onClick={() => navigate(`/${slug}/admin/dashboard`)} style={pill('linear-gradient(135deg,#7c3aed,#4f46e5)', '0 8px 22px -6px rgba(124,58,237,0.7)')}>
          <span>⚙</span> חזרה לניהול
        </button>
      )}
      {showCoach && (
        <button onClick={() => navigate(`/${slug}/trainer`)} style={pill('linear-gradient(135deg,#0d9488,#059669)', '0 8px 22px -6px rgba(13,148,136,0.7)')}>
          <span>🏃</span> חזרה למסך מאמן
        </button>
      )}
    </div>
  );
};

// Manager dashboard guard — must be inside a known club AND hold a valid manager token FOR THAT club.
// (Checking the per-club token, not the global isAdmin flag, is what stops a manager of one club from
// opening another club's dashboard. The server also re-verifies the token's HMAC on every API call.)
const ProtectedRoute = ({ children }) => {
  const { club } = useParams();
  if (!isKnownClub(club)) return <NoClub />;
  if (!isManagerOf(club)) return <Navigate to={`/${club}/admin`} replace />;
  return children;
};

function App() {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const { t } = useI18n();

  return (
    <Router>
      <Routes>
        {/* Root → product sales page. Clubs are only reachable via /<slug>. */}
        <Route path="/" element={<RootRedirect />} />

        {/* Superuser console (system owner) */}
        <Route path="/superuser" element={<SuperUser />} />

        {/* Smart link — one shareable link per team (code is global, so no club segment). Routes the
            visitor to the app / correct store / browser, with the code shown as the fallback. */}
        <Route path="/s/:code" element={<SmartJoin />} />

        {/* Invite-based registration — only valid inside a real club link. Path-based variants
            (/:club/join/:role[/:team]) carry the role/team in the PATH, because iOS strips the query
            string from a PWA's start_url — so the installed icon must not rely on "?r=operator". */}
        {/* Join by 5-digit code — a friendlier front door than an invite link. */}
        <Route path="/:club/code" element={<RequireClub><CodeJoin /></RequireClub>} />

        {/* My account — view + delete account/data (App Store account-deletion requirement). */}
        <Route path="/:club/account" element={<RequireClub><Account /></RequireClub>} />

        <Route path="/:club/join" element={<RequireClub><Join /></RequireClub>} />
        <Route path="/:club/join/:role" element={<RequireClub><Join /></RequireClub>} />
        <Route path="/:club/join/:role/:team" element={<RequireClub><Join /></RequireClub>} />

        {/* Path-based personal sign-in link (/:club/u/<token>[/<role>[/<team>]]) — the iOS-safe
            start_url the installed app opens at. boot's applyIdentityLink signs the user in and
            rewrites the URL to /<club> before render; this route just serves the app if it doesn't. */}
        <Route path="/:club/u/*" element={<RequireClub><PublicSchedule /></RequireClub>} />

        {/* Per-club manager dashboard — each manager manages only their own club */}
        <Route path="/:club/admin" element={<RequireClub><AdminLogin /></RequireClub>} />
        <Route
          path="/:club/admin/dashboard"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Per-club public routes — club slug is the first path segment */}
        <Route path="/:club" element={<RequireClub><PublicSchedule /></RequireClub>} />
        <Route path="/:club/women" element={<RequireClub><PublicScheduleWomen /></RequireClub>} />
        <Route path="/:club/trainer" element={<RequireClub><TrainerPortal /></RequireClub>} />

        {/* Any unmatched URL → designed 404. (Unknown club slugs are handled
            separately by RequireClub → NoClub, which gives a "use your link" hint.) */}
        <Route path="*" element={<ErrorPage mode="notFound" />} />
      </Routes>

      {/* Persistent "back to my screen" pills for a signed-in manager/coach (hidden on their own routes). */}
      <RoleReturn />

      {/* Floating Feedback Button - Shows on all pages (or conditionally if needed) */}
      <button
        onClick={() => setIsFeedbackOpen(true)}
        style={{
          position: 'fixed',
          bottom: 'max(20px, env(safe-area-inset-bottom))',
          left: 'max(20px, env(safe-area-inset-left))', // keep clear of the phone's home indicator / gesture bar
          zIndex: 999,
          background: '#3b82f6', // Amber/Yellow
          color: '#ffffff',
          border: 'none',
          padding: '0.8rem 1.2rem',
          borderRadius: '30px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          transition: 'transform 0.2s',
          fontSize: '0.9rem'
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <span>💡</span> {t('suggest')}
      </button>

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
      />

      <InstallPrompt />

    </Router>
  );
}

export default App;
