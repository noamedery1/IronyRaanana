import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import PublicSchedule from './pages/PublicSchedule';
import PublicScheduleWomen from './pages/PublicScheduleWomen';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import WomenDashboard from './pages/WomenDashboard';
import TrainerPortal from './pages/TrainerPortal';
import Join from './pages/Join';
import SuperUser from './pages/SuperUser';
import FeedbackModal from './components/FeedbackModal';
import InstallPrompt from './components/InstallPrompt';
import AdminSwitcher from './components/AdminSwitcher';
import { useI18n } from './i18n.jsx';
import { DEFAULT_CLUB } from './clubConfig.js';
import './App.css';

// Launch redirect: trainer devices → trainer portal; everyone else → public schedule.
const RootRedirect = () => {
  const dest = localStorage.getItem('trainerToken') ? `/${DEFAULT_CLUB}/trainer` : `/${DEFAULT_CLUB}`;
  return <Navigate to={dest} replace />;
};

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  if (!isAdmin) {
    return <Navigate to="/admin" replace />;
  }
  return children;
};

function App() {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const { t } = useI18n();

  return (
    <Router>
      <Routes>
        {/* Launch (start_url "/"): a device where a trainer logged in opens straight to
            the trainer portal; everyone else lands on the public schedule. Navigating to
            /raanana directly still shows the parent view (so a trainer can view it). */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/women" element={<Navigate to={`/${DEFAULT_CLUB}/women`} replace />} />

        {/* Superuser console (general manager) */}
        <Route path="/superuser" element={<SuperUser />} />

        {/* Admin (cross-club for now) */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard-women"
          element={
            <ProtectedRoute>
              <WomenDashboard />
            </ProtectedRoute>
          }
        />

        {/* Invite-based registration (parent/trainee per team, or operator) */}
        <Route path="/:club/join" element={<Join />} />

        {/* Per-club manager dashboard — each manager manages only their own club */}
        <Route path="/:club/admin" element={<AdminLogin />} />
        <Route
          path="/:club/admin/dashboard"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Per-club public routes — club slug is the first path segment */}
        <Route path="/:club" element={<PublicSchedule />} />
        <Route path="/:club/women" element={<PublicScheduleWomen />} />
        <Route path="/:club/trainer" element={<TrainerPortal />} />

        {/* Legacy unprefixed trainer link */}
        <Route path="/trainer" element={<Navigate to={`/${DEFAULT_CLUB}/trainer`} replace />} />
      </Routes>

      {/* Floating Feedback Button - Shows on all pages (or conditionally if needed) */}
      <button
        onClick={() => setIsFeedbackOpen(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px', // LTR public site? or RTL? Using left for now to avoid clash with chat widgets often on right
          zIndex: 999,
          background: '#FCD34D', // Amber/Yellow
          color: '#78350F',
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
