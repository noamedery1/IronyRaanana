import { useState } from 'react';

const FeedbackModal = ({
    isOpen,
    onClose,
    onSuccess
}) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

    // This URL should be the LIVE sheet's Web App URL
    // Ideally this comes from ENV or a config file
    const SHEET_URL = "https://script.google.com/macros/s/AKfycbyUzPGUSE7SQb6_jLO9P3OQER1wPAP6jaDq4B7P0zBTuwLvSTZQjPOZcnR6M7ts7b0/exec";

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!message) return;

        setIsSending(true);

        try {
            const payload = {
                action: 'sendFeedback',
                name: name,
                email: email,
                message: message
            };

            await fetch(SHEET_URL, {
                method: 'POST',
                mode: 'no-cors', // Important for Apps Script
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            // Since no-cors returns opaque response, we assume success if no network error
            alert('תודה על המשוב! נשלח בהצלחה.');
            setName('');
            setEmail('');
            setMessage('');
            onSuccess?.();
            onClose();

        } catch (error) {
            console.error('Error sending feedback:', error);
            alert('שגיאה בשליחת המשוב. נסה שוב מאוחר יותר.');
        } finally {
            setIsSending(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '8px',
                width: '90%',
                maxWidth: '400px',
                position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px', // RTL
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.2rem',
                        cursor: 'pointer'
                    }}
                >✕</button>

                <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#BE185D' }}>שליחת משוב / הצעה</h3>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>שם (אופציונלי)</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            placeholder="ישראל ישראלי"
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>אימייל לחזרה (אופציונלי)</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            placeholder="email@example.com"
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>הודעה *</label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid #ddd', minHeight: '100px', resize: 'vertical', maxHeight: '300px' }}
                            placeholder="כתוב כאן את ההצעה או הערה שלך..."
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSending}
                        style={{
                            background: '#BE185D',
                            color: 'white',
                            border: 'none',
                            padding: '0.8rem',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: isSending ? 'not-allowed' : 'pointer',
                            opacity: isSending ? 0.7 : 1
                        }}
                    >
                        {isSending ? 'שולח...' : 'שלח משוב'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default FeedbackModal;
