import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../ActionStyles.css'; // Re-use button styles

const AdminLogin = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = (e) => {
        e.preventDefault();
        if (username === 'Admin' && password === 'Passw0rd') {
            // In a real app, use a proper auth token
            localStorage.setItem('isAdmin', 'true');
            navigate('/admin/dashboard');
        } else {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="login-card" style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '16px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                width: '100%',
                maxWidth: '400px',
                textAlign: 'center'
            }}>
                <h1 className="title" style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Admin Login</h1>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.8rem',
                                borderRadius: '8px',
                                border: '1px solid #ddd',
                                fontSize: '1rem'
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
                                padding: '0.8rem',
                                borderRadius: '8px',
                                border: '1px solid #ddd',
                                fontSize: '1rem'
                            }}
                        />
                    </div>

                    {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}

                    <button type="submit" className="action-btn" style={{
                        background: '#FCA311',
                        color: 'white',
                        width: '100%',
                        justifyContent: 'center',
                        marginTop: '1rem'
                    }}>
                        Login
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
