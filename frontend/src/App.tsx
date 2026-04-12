import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

interface Car {
  id: string;
  ownerId?: string;
  name: string;
  speed: number;
  acceleration: number;
  luck: number;
  position: number;
  nitroBoostRemaining: number;
  shieldRemaining: number;
  riskShaftRemaining: number;
  speedPenaltyRemaining: number;
  speedPenaltyMultiplier: number;
  nitroUsed: boolean;
  shieldUsed: boolean;
  riskUsed: boolean;
  collideUsed: boolean;
}

interface Race {
  id: string;
  trackLength: number;
  raceDurationMs?: number;
  startCountdownAt?: number;
  cars: Car[];
  status: 'waiting' | 'starting' | 'active' | 'finished';
  startTime: number;
  bettingPool: Record<string, any[]>;
}

interface User {
  id: string;
  username?: string | null;
  balance: number;
  wins: number;
  total_earnings: number;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [race, setRace] = useState<Race | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'racer' | 'bettor' | 'viewer' | null>(null);
  const [username, setUsername] = useState('');
  const [bettorName, setBettorName] = useState('');
  const [betAmount, setBetAmount] = useState(100);
  const [selectedCar, setSelectedCar] = useState('');
  const [betPlaced, setBetPlaced] = useState(false);
  const [abilityMessage, setAbilityMessage] = useState('');
  const [error, setError] = useState('');
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  const [betWinners, setBetWinners] = useState<Array<{ name: string, amount: number, payout: number }>>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; username?: string; balance: number; wins: number; total_earnings: number }>>([]);
  const [hoveredCarId, setHoveredCarId] = useState<string | null>(null);
  const [collideTarget, setCollideTarget] = useState<string>('');
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const session = urlParams.get('session');
    const user = urlParams.get('user');
    if (session && user) {
      setSessionId(session);
      setUserId(user);
      fetchSessionData(session, user).finally(() => setInitialFetchDone(true));
    } else {
      setInitialFetchDone(true);
    }
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      setLeaderboard(data);
    } catch (err) {
      console.warn('Failed to load leaderboard');
    }
  };

  const fetchSessionData = async (session: string, user: string) => {
    try {
      const res = await fetch(`http://localhost:3001/api/session/${session}?user=${user}`);
      if (!res.ok) {
        const body = await res.json();
        const message = body.error || 'Failed to load session';
        if (message.includes('Session not found')) {
          setError('Session not found. Make sure you opened a valid Discord bot link generated from the race command.');
        } else {
          setError(message);
        }
        return;
      }
      const data = await res.json();
      setRace(data.race);
      setUser(data.user);
      fetchLeaderboard();
    } catch (err) {
      setError('Unable to reach backend server at localhost:3001. Make sure backend is running.');
    }
  };

  const createSocket = (): Socket => {
    if (socket) return socket;

    const newSocket = io('http://localhost:3001', {
      query: { session: sessionId, user: userId }
    });
    setSocket(newSocket);

    newSocket.on('race_updated', (updatedRace: Race) => {
      setRace(updatedRace);
    });

    newSocket.on('race_state', (state: { cars: Car[] }) => {
      setRace(prev => prev ? { ...prev, cars: state.cars } : null);
    });

    newSocket.on('race_finished', (finishedRace: Race) => {
      setRace(finishedRace);
      fetchSessionData(sessionId, userId); // refresh user data
    });

    newSocket.on('bet_winners', (winners: Array<{ name: string, amount: number, payout: number }>) => {
      setBetWinners(winners);
    });

    newSocket.on('ability_feedback', (message: string) => {
      setAbilityMessage(message);
    });

    newSocket.on('next_race', (nextRace: Race) => {
      setRace(nextRace);
      setBetPlaced(false);
      setSelectedCar('');
      setBetWinners([]);
      setBettorName('');
      setRole(prev => prev === 'viewer' ? 'viewer' : null);
      fetchLeaderboard();
    });

    newSocket.on('user_updated', (updatedUser: User) => {
      setUser(updatedUser);
      fetchLeaderboard();
    });

    newSocket.on('error_message', (msg: string) => {
      setError(msg);
    });

    return newSocket;
  };

  useEffect(() => {
    if (sessionId && userId && !socket) {
      createSocket();
    }
  }, [sessionId, userId, socket]);

  useEffect(() => {
    let interval: number | undefined;

    const update = () => {
      if (!race) {
        setTimeLeftMs(null);
        return;
      }

      if (race.status === 'starting' && race.startCountdownAt) {
        const remaining = Math.max(0, 5000 - (Date.now() - race.startCountdownAt));
        setTimeLeftMs(remaining);
        return;
      }

      if (race.status === 'active' && race.startTime && race.raceDurationMs) {
        const remaining = Math.max(0, race.raceDurationMs - (Date.now() - race.startTime));
        setTimeLeftMs(remaining);
        return;
      }

      setTimeLeftMs(null);
    };

    update();
    interval = window.setInterval(update, 200);

    return () => {
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [race?.status, race?.startCountdownAt, race?.startTime, race?.raceDurationMs]);

  const formatTimer = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const joinAsRacer = async () => {
    if (!username) {
      setError('Please enter a username to join as a racer.');
      return;
    }
    if (!race) {
      await fetchSessionData(sessionId, userId);
    }
    const s = createSocket();
    s.emit('join_race', { username });
    setRole('racer');
    setError('');
  };

  const enterAsBettor = () => {
    if (!socket && sessionId && userId) {
      createSocket();
    }
    setRole('bettor');
  };

  const chooseRole = (newRole: 'racer' | 'bettor' | 'viewer') => {
    if (!socket && sessionId && userId) {
      createSocket();
    }
    setError('');
    setRole(newRole);
  };

  const submitBet = () => {
    if (!selectedCar || betAmount <= 0) {
      setError('Choose a car and a positive bet amount.');
      return;
    }
    const s = createSocket();
    s.emit('place_bet', { amount: betAmount, carId: selectedCar, bettorName: bettorName || `Bettor` });
    setBetPlaced(true);
    setRole('bettor');
  };

  const startRace = () => {
    if (!socket) return;
    socket.emit('start_race');
  };

  const useAbility = (ability: string, targetId?: string) => {
    if (!socket) return;
    if (ability === 'collide') {
      socket.emit('use_ability', { ability, targetId });
    } else {
      socket.emit('use_ability', ability);
    }
  };

  if (!sessionId || !userId) {
    if (!initialFetchDone) {
      return <div className="role-selection"><h1>Street Racing Game</h1><p>Loading...</p></div>;
    }
    return (
      <div className="role-selection">
        <h1>Street Racing Game</h1>
        <p>Open this page using a valid session link, for example:</p>
        <code>?session=test-session&user=test</code>
      </div>
    );
  }

  if (!race && !initialFetchDone) {
    return <div className="role-selection"><h1>Street Racing Game</h1><p>Loading...</p></div>;
  }

  if (!race) {
    return (
      <div className="role-selection">
        <h1>Error</h1>
        <p>{error || 'Failed to load race data'}</p>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="role-selection">
        <h1>Street Racing Game</h1>
        <p>Choose your role:</p>
        <button onClick={() => { createSocket(); setRole('viewer'); }}>Viewer</button>
        <div>
          <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <button onClick={joinAsRacer}>Join as Racer</button>
        </div>
        <div>
          <button onClick={enterAsBettor}>Enter as Bettor</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const myCar = race.cars.find(c => c.ownerId === userId);
  const betPoolTotal = Object.values(race.bettingPool).flat().reduce((sum, bet: any) => sum + (bet.amount || 0), 0);
  const betCount = Object.values(race.bettingPool).flat().length;
  const hoveredCar = race.cars.find(c => c.id === hoveredCarId);
  const trackColors = ['#ff4cc2', '#43ffee', '#7e6cff', '#ffd144', '#51ff7f', '#ff7b48'];

  return (
    <div className="app-shell">
      <div className="video-background" />
      <div className="game neon-panel">
        <div className="hero-panel">
          <div>
            <h1>OVERDRIVE - Where Risk meets Rush</h1>
            <p className="subtitle">Bet on racers, activate abilities, and climb the leaderboard in real time.</p>
          </div>
          <div className="header-stats">
            <span>Session: <strong>{sessionId}</strong></span>
            {user && <span>Welcome: <strong>{user.username || 'Racer'}</strong></span>}
          </div>
        </div>
        {hoveredCar && (
          <div className="car-tooltip">
            <strong>{hoveredCar.name}</strong> is pacing the circuit.
          </div>
        )}
        <div className="race-header">
          <div>
            <h2>Race Status</h2>
            <span className={`status-pill status-${race.status}`}>{race.status}</span>
            {timeLeftMs !== null && (
              <div className="race-timer">
                {race.status === 'starting'
                  ? `Race starts in ${formatTimer(timeLeftMs)}`
                  : `Time left: ${formatTimer(timeLeftMs)}`}
              </div>
            )}
          </div>
          <div className="pool-info">
            <span>Pool: ${betPoolTotal}</span>
            <span>Bets: {betCount}</span>
          </div>
        </div>
        <div className="track">
          {race.cars.map((car, idx) => {
            const progress = Math.min(Math.max(car.position / race.trackLength, 0), 1);
            const angle = progress * 360 - 90;
            const radians = angle * (Math.PI / 180);
            const x = 50 + Math.cos(radians) * 38;
            const y = 50 + Math.sin(radians) * 38;
            return (
              <div
                key={car.id}
                className="car-dot"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: trackColors[idx % trackColors.length]
                }}
                onMouseEnter={() => setHoveredCarId(car.id)}
                onMouseLeave={() => setHoveredCarId(null)}
              />
            );
          })}
        </div>
      {role === 'racer' && (
        <div className="controls">
          <div className="controls-top">
            <h2>Racer Abilities</h2>
            <div className="ability-action-row">
              <button className={`ability-btn ${myCar?.nitroUsed ? (myCar.nitroBoostRemaining > 0 ? 'active' : 'expired') : ''}`} onClick={() => useAbility('nitro')} disabled={race.status !== 'active' || !myCar || myCar.nitroUsed}>Nitro Boost</button>
              <button className={`ability-btn ${myCar?.riskUsed ? (myCar.riskShaftRemaining > 0 ? 'active' : 'expired') : ''}`} onClick={() => useAbility('risk')} disabled={race.status !== 'active' || !myCar || myCar.riskUsed}>Risk Shaft</button>
              <button className={`ability-btn ${myCar?.shieldUsed ? (myCar.shieldRemaining > 0 ? 'active' : 'expired') : ''}`} onClick={() => useAbility('shield')} disabled={race.status !== 'active' || !myCar || myCar.shieldUsed}>Safety Shield</button>
              <button className={`ability-btn ${myCar?.collideUsed ? 'expired' : ''}`} onClick={() => useAbility('collide', collideTarget)} disabled={race.status !== 'active' || !myCar || myCar.collideUsed}>Collide</button>
            </div>
          </div>
          {myCar ? (
            <>
              {!myCar.collideUsed && race.status === 'active' && (
                <div className="collide-target-row">
                  <label htmlFor="collide-target">Target:</label>
                  <select id="collide-target" value={collideTarget} onChange={e => setCollideTarget(e.target.value)}>
                    <option value="">Random</option>
                    {race.cars.filter(car => car.id !== myCar.id).map(car => (
                      <option key={car.id} value={car.id}>{car.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {race.status !== 'active' && <div className="ability-message">Abilities unlock once the race goes active.</div>}
            </>
          ) : (
            <div className="ability-message">Waiting for a racer slot and car assignment...</div>
          )}
          {abilityMessage && <div className="ability-message ability-active-message">{abilityMessage}</div>}
        </div>
      )}
      {role === 'bettor' && race.status !== 'finished' && (
        <div className="bet-controls">
          <h2>Place your wager</h2>
          <input placeholder="Your Name" value={bettorName} onChange={e => setBettorName(e.target.value)} />
          <input type="number" placeholder="Bet Amount" value={betAmount} onChange={e => setBetAmount(Number(e.target.value))} />
          <select value={selectedCar} onChange={e => setSelectedCar(e.target.value)}>
            <option value="">Select Car</option>
            {race.cars.map(car => <option key={car.id} value={car.id}>{car.name}</option>)}
          </select>
          <button onClick={submitBet}>Place Bet</button>
          {betPlaced && selectedCar && (
            <div className="bet-summary">Current bet: {betAmount} on {race.cars.find(car => car.id === selectedCar)?.name}</div>
          )}
          {race.status === 'waiting' && <button onClick={startRace}>Start Race</button>}
          <p className="bet-note">You can add more money to any racer while the race is active. Bets cannot be removed.</p>
        </div>
      )}
      {role !== 'bettor' && race.status === 'waiting' && (
        <button className="start-race-button" onClick={startRace}>Start Race</button>
      )}
      <div className="status-panels">
        {user && (
          <div className="user-info neon-card">
            <div><strong>Balance:</strong> ${user.balance}</div>
            <div><strong>Wins:</strong> {user.wins}</div>
            <div><strong>Earnings:</strong> ${user.total_earnings}</div>
          </div>
        )}
      </div>
      <div className="leaderboard-section">
        <div className="race-board neon-card">
          <h3>Race Standings</h3>
          { [...race.cars].sort((a, b) => b.position - a.position).map((car, idx) => (
            <div key={car.id} className="leaderboard-row">
              <span>#{idx + 1}</span>
              <span>{car.name}</span>
              <span>{Math.min(Math.round((car.position / race.trackLength) * 100), 100)}%</span>
            </div>
          )) }
        </div>
        <div className="server-board neon-card">
          <h3>Server Leaderboard</h3>
          { leaderboard.length === 0 ? (
            <p>Loading leaderboard...</p>
          ) : (
            leaderboard.map((item, idx) => (
              <div key={item.id} className="leaderboard-row">
                <span>#{idx + 1}</span>
                <span>{item.username || item.id}</span>
                <span>{item.wins} wins · ${item.total_earnings}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {race.status === 'finished' && (
        <div className="post-race">
          <h2>Winner: {race.cars.reduce((prev, current) => prev.position > current.position ? prev : current).name}</h2>
          {betWinners.length > 0 && (
            <div className="bet-winners">
              <h3>💰 Bet Winners:</h3>
              {betWinners.map((winner, idx) => (
                <div key={idx} className="winner-item">
                  <strong>{winner.name}</strong>: Bet ${winner.amount} → Won ${winner.payout}
                </div>
              ))}
            </div>
          )}
          <div className="post-race-options">
            <p>The next race will start soon. Choose your role for the next round:</p>
            <button onClick={() => chooseRole('viewer')}>Viewer</button>
            <button onClick={() => chooseRole('racer')}>Racer</button>
            <button onClick={() => chooseRole('bettor')}>Bettor</button>
            <span className="role-note">Your choice will apply to the next race once it starts.</span>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default App;
