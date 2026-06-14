import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import PublicSchedule from './pages/PublicSchedule';
import PublicScheduleWomen from './pages/PublicScheduleWomen';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import WomenDashboard from './pages/WomenDashboard';
import TrainerPortal from './pages/TrainerPortal';
import FeedbackModal from './components/FeedbackModal';
import InstallPrompt from './components/InstallPrompt';
import { useI18n } from './i18n.jsx';
import './App.css';

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
        <Route path="/" element={<PublicSchedule />} />
        <Route path="/women" element={<PublicScheduleWomen />} />
        <Route path="/trainer" element={<TrainerPortal />} />
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

    </Router>
  );
}

export default App;
