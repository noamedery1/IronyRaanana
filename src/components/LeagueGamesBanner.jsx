import { useState, useEffect } from 'react';

const LeagueGamesBanner = () => {
    // Hardcoded data for now as requested
    const games = [
        {
            day: "שני",
            time: "18:30",
            opponent: "הפועל גלבוע גליל",
            location: 'היכל מטרווסט',
            league: "משחק ליגה",
            date: "26.1.26"
        }
    ];

    const [isVisible, setIsVisible] = useState(true);

    if (!isVisible) return null;

    return (
        <div style={{
            background: 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 50%, #1e3a8a 100%)',
            color: 'white',
            padding: '12px 0',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            direction: 'rtl'
        }}>
            <div className="banner-content" style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                whiteSpace: 'nowrap',
                animation: 'pulse 2s infinite'
            }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>🏀 משחקי השבוע: </span>
                {games.map((game, idx) => (
                    <span key={idx} style={{ margin: '0 10px', fontSize: '1.1rem' }}>
                        {game.league}: <strong>{game.day} {game.date}</strong> בשעה <strong>{game.time}</strong> נגד <strong>{game.opponent}</strong> ({game.location})
                    </span>
                ))}
            </div>

            {/* Close button if needed, but ads usually stay */}
            <style>
                {`
                    @keyframes pulse {
                        0% { opacity: 0.9; transform: scale(0.99); }
                        50% { opacity: 1; transform: scale(1.01); }
                        100% { opacity: 0.9; transform: scale(0.99); }
                    }
                `}
            </style>
        </div>
    );
};

export default LeagueGamesBanner;
