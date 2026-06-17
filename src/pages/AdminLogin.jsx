import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActiveClub } from '../clubConfig.js';
import '../ActionStyles.css'; // Re-use button styles

const AdminLogin = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        // 1) DB manager account for the active club (created via the superuser console).
        try {
            const res = await fetch(`/api/${getActiveClub().slug}/managers/auth`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (data.valid) {
                localStorage.setItem('isAdmin', 'true');
                localStorage.setItem('managerName', data.name || username);
                if (data.token) localStorage.setItem('mgrToken:' + getActiveClub().slug, data.token);
                navigate(`/${getActiveClub().slug}/admin/dashboard`);
                return;
            }
        } catch { /* fall through to built-in */ }

        // 2) Built-in fallback (legacy).
        if (username === 'Admin' && password === 'Passw0rd') {
            localStorage.setItem('isAdmin', 'true');
            navigate(`/${getActiveClub().slug}/admin/dashboard`);
        } else {
            setError('שם משתמש או סיסמה שגויים');
        }
    };

    return (
        <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="login-card" style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                backdropFilter: 'blur(18px) saturate(1.3)',
                padding: '2.5rem 2rem',
                borderRadius: '22px',
                boxShadow: 'var(--shadow)',
                width: '100%',
                maxWidth: '400px',
                textAlign: 'center'
            }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '0.4rem' }}>🏀</div>
                <h1 className="title" style={{ fontSize: '1.9rem', marginBottom: '0.3rem' }}>כניסת מנהל</h1>
                <p className="subtitle" style={{ fontSize: '0.9rem', marginBottom: '1.6rem' }}>מערכת ניהול הלו"ז · עירוני רעננה</p>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.85rem 1rem',
                                borderRadius: '12px',
                                border: '1px solid var(--bd2)',
                                background: 'var(--ink2)',
                                color: 'var(--text)',
                                fontSize: '1rem',
                                fontFamily: 'Assistant, sans-serif'
                            }}
                        />
                    </div>
                    <div>
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.85rem 1rem',
                                borderRadius: '12px',
                                border: '1px solid var(--bd2)',
                                background: 'var(--ink2)',
                                color: 'var(--text)',
                                fontSize: '1rem',
                                fontFamily: 'Assistant, sans-serif'
                            }}
                        />
                    </div>

                    {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}

                    <button type="submit" className="action-btn" style={{
                        background: 'linear-gradient(135deg,#3b82f6,#0891b2)',
                        color: 'white',
                        width: '100%',
                        justifyContent: 'center',
                        marginTop: '0.5rem'
                    }}>
                        כניסה
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
