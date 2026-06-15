import { useState } from 'react';
import { pushSupported, subscribeToPush, unsubscribeFromPush } from '../push.js';

const RegisterUpdatesModal = ({ isOpen, onClose, teamName, sheetUrl }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const [pushLoading, setPushLoading] = useState(false);
    const [pushMsg, setPushMsg] = useState('');
    const [pushErr, setPushErr] = useState(false);
    const [showUnsub, setShowUnsub] = useState(false);
    const [unsubEmail, setUnsubEmail] = useState('');
    const [unsubMsg, setUnsubMsg] = useState('');

    if (!isOpen) return null;

    const cancelPush = async () => {
        setUnsubMsg('');
        await unsubscribeFromPush(sheetUrl);
        setUnsubMsg('✓ ההתראות בוטלו במכשיר זה.');
    };

    const cancelEmail = async () => {
        if (!unsubEmail) return;
        setUnsubMsg('');
        try {
            await fetch(sheetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'unregisterSubscriber', email: unsubEmail, team: teamName }),
            });
            setUnsubMsg('✓ הוסרת מרשימת התפוצה במייל.');
            setUnsubEmail('');
        } catch {
            setUnsubMsg('שגיאת תקשורת, נסה שוב.');
        }
    };

    const handlePush = async () => {
        setPushLoading(true);
        setPushMsg('');
        setPushErr(false);
        try {
            const result = await subscribeToPush(teamName, sheetUrl);
            if (result.ok) {
                setPushMsg('✓ התראות הופעלו במכשיר זה!');
                setPushErr(false);
            } else if (result.reason === 'unsupported') {
                setPushMsg('הדפדפן הזה לא תומך בהתראות. נסה דרך כרום, או התקן קודם את האפליקציה למסך הבית.');
                setPushErr(true);
            } else if (result.reason === 'denied') {
                setPushMsg('ההרשאה נדחתה. אפשר התראות בהגדרות האתר ונסה שוב.');
                setPushErr(true);
            } else {
                setPushMsg('שגיאה בהפעלת התראות: ' + result.reason);
                setPushErr(true);
            }
        } catch (err) {
            console.error(err);
            setPushMsg('שגיאה בהפעלת התראות. נסה שוב.');
            setPushErr(true);
        } finally {
            setPushLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        setIsError(false);

        try {
            const response = await fetch(sheetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'registerSubscriber',
                    name: name,
                    email: email,
                    team: teamName
                })
            });

            const data = await response.json();

            if (data.error) {
                setMessage(data.error);
                setIsError(true);
            } else {
                setMessage('נרשמת בהצלחה לקבלת עדכונים!');
                setIsError(false);
                setTimeout(() => {
                    onClose();
                    setMessage('');
                    setName('');
                    setEmail('');
                }, 2000);
            }
        } catch (err) {
            console.error(err);
            setMessage('שגיאת תקשורת: אנא נסה שוב מאוחר יותר.');
            setIsError(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: 'white', borderRadius: '12px', padding: '1.5rem',
                width: '90%', maxWidth: '400px', position: 'relative',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}>
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}
                >✕</button>

                <h3 style={{ marginTop: 0, color: '#0f172a', textAlign: 'center', marginBottom: '0.4rem', fontSize: '1.25rem' }}>
                    הישארו מעודכנים 🔔
                </h3>
                <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem', margin: '0 0 1rem' }}>
                    בחרו איך לקבל עדכונים על קבוצת <strong style={{ color: '#0f172a' }}>{teamName}</strong> — פוש, מייל, או שניהם.
                </p>

                {pushSupported() && (
                    <div style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem' }}>
                        <div style={{ fontWeight: 'bold', color: '#9a3412', fontSize: '0.95rem', marginBottom: '0.15rem' }}>📱 התראות לטלפון</div>
                        <div style={{ color: '#9a3412', opacity: 0.8, fontSize: '0.8rem', marginBottom: '0.7rem', lineHeight: 1.5 }}>
                            התראה מיידית למסך, גם כשהאתר סגור. מומלץ.
                        </div>
                        <button
                            type="button"
                            onClick={handlePush}
                            disabled={pushLoading}
                            style={{
                                width: '100%', background: '#ff7a18', color: 'white', border: 'none',
                                padding: '0.7rem', borderRadius: '8px', fontWeight: 'bold',
                                cursor: pushLoading ? 'not-allowed' : 'pointer', opacity: pushLoading ? 0.7 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                            }}
                        >
                            {pushLoading ? 'מפעיל...' : <>🔔 הפעל התראות במכשיר זה</>}
                        </button>
                        {pushMsg && (
                            <div style={{
                                color: pushErr ? '#ef4444' : '#047857', textAlign: 'center',
                                background: pushErr ? '#fef2f2' : '#ecfdf5', padding: '0.5rem',
                                borderRadius: '6px', fontSize: '0.85rem', marginTop: '0.6rem', lineHeight: 1.5
                            }}>
                                {pushMsg}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '10px', padding: '0.9rem' }}>
                    <div style={{ fontWeight: 'bold', color: '#1e3a8a', fontSize: '0.95rem', marginBottom: '0.15rem' }}>✉️ עדכונים למייל</div>
                    <div style={{ color: '#475569', fontSize: '0.8rem', marginBottom: '0.7rem', lineHeight: 1.5 }}>
                        קבלת מייל מסודר בכל שינוי בלו"ז.
                    </div>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem', color: '#475569' }}>שם מלא</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            placeholder="הכנס שם מלא"
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem', color: '#475569' }}>כתובת אימייל</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="example@mail.com"
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', textAlign: 'left', direction: 'ltr' }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !email || !name}
                        style={{
                            background: '#2563EB', color: 'white', border: 'none',
                            padding: '0.8rem', borderRadius: '6px', fontWeight: 'bold',
                            cursor: loading || !email || !name ? 'not-allowed' : 'pointer',
                            marginTop: '0.5rem',
                            opacity: loading || !email || !name ? 0.7 : 1
                        }}
                    >
                        {loading ? 'רושם...' : 'הרשם לעדכוני מייל'}
                    </button>

                    {message && (
                        <div style={{
                            color: isError ? '#ef4444' : '#10b981',
                            textAlign: 'center',
                            background: isError ? '#fef2f2' : '#ecfdf5',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.9rem'
                        }}>
                            {message}
                        </div>
                    )}
                </form>
                </div>

                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                    <button type="button" onClick={() => setShowUnsub(!showUnsub)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
                        כבר רשום? ביטול הרשמה
                    </button>
                    {showUnsub && (
                        <div style={{ marginTop: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.8rem', textAlign: 'right' }}>
                            {pushSupported() && (
                                <button type="button" onClick={cancelPush} style={{ width: '100%', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', padding: '0.55rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '0.6rem' }}>
                                    🔕 בטל התראות במכשיר זה
                                </button>
                            )}
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <input type="email" value={unsubEmail} onChange={(e) => setUnsubEmail(e.target.value)} placeholder="המייל שלך" style={{ flex: 1, padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', textAlign: 'left', direction: 'ltr' }} />
                                <button type="button" onClick={cancelEmail} disabled={!unsubEmail} style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', padding: '0.55rem 0.8rem', borderRadius: '8px', fontWeight: 'bold', cursor: unsubEmail ? 'pointer' : 'not-allowed' }}>
                                    בטל מייל
                                </button>
                            </div>
                            {unsubMsg && <div style={{ marginTop: '0.6rem', textAlign: 'center', fontSize: '0.85rem', color: unsubMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{unsubMsg}</div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RegisterUpdatesModal;
