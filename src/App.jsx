import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
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
import AdminSwitcher from './components/AdminSwitcher';
import { useI18n } from './i18n.jsx';
import { isKnownClub } from './clubConfig.js';
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

// Manager dashboard guard — must be inside a known club AND logged in.
const ProtectedRoute = ({ children }) => {
  const { club } = useParams();
  if (!isKnownClub(club)) return <NoClub />;
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  if (!isAdmin) return <Navigate to={`/${club}/admin`} replace />;
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

      {/* Floating Feedback Button - Shows on all pages (or conditionally if needed) */}
      <button
        onClick={() => setIsFeedbackOpen(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px', // LTR public site? or RTL? Using left for now to avoid clash with chat widgets often on right
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

      <AdminSwitcher />

    </Router>
  );
}

export default App;
