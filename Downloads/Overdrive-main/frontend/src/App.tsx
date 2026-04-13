import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL } from './config';
import './App.css';

type Role = 'racer' | 'bettor' | 'viewer';

interface Bet {
  userId: string;
  amount: number;
  carId: string;
  bettorName?: string;
}

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
  bettingPool: Record<string, Bet[]>;
}

interface AbilityInventory {
  nitro: number;
  risk: number;
  shield: number;
  collide: number;
}

interface User {
  id: string;
  username?: string | null;
  balance: number;
  wins: number;
  total_earnings: number;
  abilities: AbilityInventory;
}

interface SessionResponse {
  session: {
    authorId: string;
    channelId: string;
    status: string;
    loopActive?: boolean;
  };
  race: Race;
  user: User;
}

interface LeaderboardEntry {
  id: string;
  username?: string;
  balance: number;
  wins: number;
  total_earnings: number;
}

const getInitialSessionParams = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session') ?? '';
  const userId = urlParams.get('user') ?? '';

  return {
    sessionId,
    userId
  };
};

function App() {
  const initialSession = getInitialSessionParams();
  const socketRef = useRef<Socket | null>(null);
  const [sessionId] = useState<string>(initialSession.sessionId);
  const [userId] = useState<string>(initialSession.userId);
  const [race, setRace] = useState<Race | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [shopMessage, setShopMessage] = useState('');
  const [username, setUsername] = useState('');
  const [bettorName, setBettorName] = useState('');
  const [betAmount, setBetAmount] = useState(100);
  const [selectedCar, setSelectedCar] = useState('');
  const [betPlaced, setBetPlaced] = useState(false);
  const [abilityMessage, setAbilityMessage] = useState('');
  const [error, setError] = useState('');
  const [betWinners, setBetWinners] = useState<Array<{ name: string, amount: number, payout: number }>>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [hoveredCarId, setHoveredCarId] = useState<string | null>(null);
  const [collideTarget, setCollideTarget] = useState<string>('');
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/leaderboard`);
      if (!res.ok) {
        return;
      }

      const data = await res.json() as LeaderboardEntry[];
      setLeaderboard(data);
    } catch {
      console.warn('Failed to load leaderboard');
    }
  }, []);

  const fetchSessionData = useCallback(async (session: string, user: string) => {
    try {
      const res = await fetch(`${API_URL}/api/session/${session}?user=${user}`);
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        const message = body.error || 'Failed to load session';
        if (message.includes('Session not found')) {
          setError('Session not found. Make sure you opened a valid Discord bot link generated from the race command.');
        } else {
          setError(message);
        }
        return;
      }
      const data = await res.json() as SessionResponse;
      setRace(data.race);
      setUser(data.user);
      setError('');
      await fetchLeaderboard();
    } catch {
      setError('Unable to reach backend server. Make sure backend is deployed and running.');
    }
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (!sessionId || !userId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchSessionData(sessionId, userId);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchSessionData, sessionId, userId]);

  useEffect(() => {
    if (!sessionId || !userId) {
      return;
    }

    const nextSocket = io(API_URL, {
      query: { session: sessionId, user: userId }
    });
    socketRef.current = nextSocket;

    nextSocket.on('race_updated', (updatedRace: Race) => {
      setRace(updatedRace);
    });

    nextSocket.on('race_state', (state: { cars: Car[] }) => {
      setRace((prev) => (prev ? { ...prev, cars: state.cars } : null));
    });

    nextSocket.on('race_finished', (finishedRace: Race) => {
      setRace(finishedRace);
      setBetPlaced(false);
      setSelectedCar('');
      setBettorName('');
      setCollideTarget('');
      setAbilityMessage('');
      setRole(null);
      void fetchSessionData(sessionId, userId);
    });

    nextSocket.on('bet_winners', (winners: Array<{ name: string, amount: number, payout: number }>) => {
      setBetWinners(winners);
    });

    nextSocket.on('ability_feedback', (message: string) => {
      setAbilityMessage(message);
    });

    nextSocket.on('next_race', (nextRace: Race) => {
      setRace(nextRace);
      setBetPlaced(false);
      setSelectedCar('');
      setBetWinners([]);
      setBettorName('');
      setCollideTarget('');
      setAbilityMessage('');
      setRole(null);
      void fetchLeaderboard();
    });

    nextSocket.on('user_updated', (updatedUser: User) => {
      setUser(updatedUser);
      void fetchLeaderboard();
    });

    nextSocket.on('error_message', (msg: string) => {
      setError(msg);
    });

    return () => {
      nextSocket.disconnect();
      if (socketRef.current === nextSocket) {
        socketRef.current = null;
      }
    };
  }, [fetchLeaderboard, fetchSessionData, sessionId, userId]);

  useEffect(() => {
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
    const interval = window.setInterval(update, 200);

    return () => {
      window.clearInterval(interval);
    };
  }, [race]);

  const formatTimer = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatAbilityDuration = (ms: number) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${seconds}s`;
  };

  const joinAsRacer = async () => {
    if (!username) {
      setError('Please enter a username to join as a racer.');
      return;
    }
    if (!race) {
      await fetchSessionData(sessionId, userId);
    }
    const socket = socketRef.current;
    if (!socket) {
      setError('Connection to the race server is still starting. Please try again.');
      return;
    }
    socket.emit('join_race', { username });
    setRole('racer');
    setError('');
  };

  const enterAsBettor = () => {
    setRole('bettor');
  };

  const chooseRole = (newRole: Role) => {
    setError('');
    setRole(newRole);
  };

  const submitBet = () => {
    if (!selectedCar || betAmount <= 0) {
      setError('Choose a car and a positive bet amount.');
      return;
    }
    const socket = socketRef.current;
    if (!socket) {
      setError('Connection to the race server is still starting. Please try again.');
      return;
    }
    socket.emit('place_bet', { amount: betAmount, carId: selectedCar, bettorName: bettorName || 'Bettor' });
    setBetPlaced(true);
    setRole('bettor');
  };

  const buyAbility = async (ability: 'nitro' | 'risk' | 'shield' | 'collide') => {
    setShopMessage('');
    if (!userId) {
      setShopMessage('Unable to identify user for purchase.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/shop/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ability })
      });
      const body = await res.json();
      if (!res.ok) {
        setShopMessage(body.message || 'Purchase failed.');
        return;
      }
      setUser(body.user);
      setShopMessage(`Purchased ${ability} for $200.`);
    } catch {
      setShopMessage('Unable to complete purchase. Try again later.');
    }
  };

  const startRace = () => {
    socketRef.current?.emit('start_race');
  };

  const triggerAbility = (ability: keyof AbilityInventory, targetId?: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (ability === 'collide') {
      socket.emit('use_ability', { ability, targetId });
    } else {
      socket.emit('use_ability', ability);
    }
  };

  if (!sessionId || !userId) {
    return (
      <div className="role-selection">
        <h1>Street Racing Game</h1>
        <p>Open this page using a valid session link, for example:</p>
        <code>?session=test-session&user=test</code>
      </div>
    );
  }

  if (!race && !error) {
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
        <div className="shop-panel neon-card">
          <h2>Ability Shop</h2>
          <p>Each ability costs <strong>$200</strong>.</p>
          {user && (
            <div className="shop-items">
              {['nitro', 'risk', 'shield', 'collide'].map((ability) => (
                <div key={ability} className="shop-item">
                  <span>{ability.charAt(0).toUpperCase() + ability.slice(1)}</span>
                  <span>Owned: {user.abilities[ability as keyof typeof user.abilities]}</span>
                  <button onClick={() => buyAbility(ability as 'nitro' | 'risk' | 'shield' | 'collide')}
                    disabled={user.balance < 200}>
                    Buy</button>
                </div>
              ))}
            </div>
          )}
          {shopMessage && <p className="shop-message">{shopMessage}</p>}
        </div>
        <button onClick={() => chooseRole('viewer')}>Viewer</button>
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
  const hasActiveAbility =
    Boolean(myCar) &&
    (
      myCar.nitroBoostRemaining > 0 ||
      myCar.riskShaftRemaining > 0 ||
      myCar.shieldRemaining > 0 ||
      myCar.speedPenaltyRemaining > 0
    );
  const visibleAbilityMessage = hasActiveAbility ? abilityMessage : '';
  const allBets: Bet[] = Object.values(race.bettingPool).flatMap((bets) => bets as Bet[]);
  const betPoolTotal = allBets.reduce((sum, bet) => sum + bet.amount, 0);
  const betCount = allBets.length;
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
              <button className={`ability-btn ${myCar?.nitroBoostRemaining ? 'active' : ''}`} onClick={() => triggerAbility('nitro')} disabled={race.status !== 'active' || !myCar || myCar.nitroBoostRemaining > 0 || (user?.abilities.nitro ?? 0) <= 0}>Nitro Boost ({user?.abilities.nitro ?? 0})</button>
              <button className={`ability-btn ${myCar?.riskShaftRemaining ? 'active' : ''}`} onClick={() => triggerAbility('risk')} disabled={race.status !== 'active' || !myCar || myCar.riskShaftRemaining > 0 || (user?.abilities.risk ?? 0) <= 0}>Risk Shaft ({user?.abilities.risk ?? 0})</button>
              <button className={`ability-btn ${myCar?.shieldRemaining ? 'active' : ''}`} onClick={() => triggerAbility('shield')} disabled={race.status !== 'active' || !myCar || myCar.shieldRemaining > 0 || (user?.abilities.shield ?? 0) <= 0}>Safety Shield ({user?.abilities.shield ?? 0})</button>
              <button className={`ability-btn ${myCar?.speedPenaltyRemaining ? 'active' : ''}`} onClick={() => triggerAbility('collide', collideTarget)} disabled={race.status !== 'active' || !myCar || myCar.speedPenaltyRemaining > 0 || (user?.abilities.collide ?? 0) <= 0}>Collide ({user?.abilities.collide ?? 0})</button>
            </div>
          </div>
          {myCar ? (
            <>
              {myCar.speedPenaltyRemaining <= 0 && race.status === 'active' && (
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
              <div className="ability-cooldown-row">
                {myCar.nitroBoostRemaining > 0 && <span className="ability-status">Nitro active: {formatAbilityDuration(myCar.nitroBoostRemaining)}</span>}
                {myCar.riskShaftRemaining > 0 && <span className="ability-status">Risk Shaft active: {formatAbilityDuration(myCar.riskShaftRemaining)}</span>}
                {myCar.shieldRemaining > 0 && <span className="ability-status">Safety Shield active: {formatAbilityDuration(myCar.shieldRemaining)}</span>}
                {myCar.speedPenaltyRemaining > 0 && <span className="ability-status">Speed penalty: {formatAbilityDuration(myCar.speedPenaltyRemaining)}</span>}
              </div>
              {race.status !== 'active' && <div className="ability-message">Abilities unlock once the race goes active.</div>}
            </>
          ) : (
            <div className="ability-message">Waiting for a racer slot and car assignment...</div>
          )}
          {visibleAbilityMessage && <div className="ability-message ability-active-message">{visibleAbilityMessage}</div>}
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
