/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import GameCanvas from './components/GameCanvas';
import { socket } from './services/socket';
import { Player } from './types';
import { auth, signInWithGoogle, logout, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { LogOut, User as UserIcon, Trophy, ShoppingBag, Coins, Flag, Star } from 'lucide-react';

const SHOP_ITEMS = [
  { id: 'neon_blue', name: 'Neon Blue Car', price: 5000000, color: '#00f2ff' },
  { id: 'gold_rims', name: 'Gold Rims', price: 10000000, color: '#ffd700' },
  { id: 'super_nitro', name: 'Super Nitro', price: 20000000, color: '#ff4d00' },
  { id: 'creator_skin', name: 'Creator Skin', price: 40000000, color: '#ff0000' },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'lobby' | 'game' | 'shop' | 'tournaments'>('landing');
  const [activeTournaments, setActiveTournaments] = useState<any[]>([]);
  const [winner, setWinner] = useState<{ id: string, name: string } | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsAdmin(currentUser.email === 'oreviera1@gmail.com');
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserProfile(data);
          // Update role if it's the admin email but role isn't set
          if (currentUser.email === 'oreviera1@gmail.com' && data.role !== 'admin') {
            await updateDoc(doc(db, 'users', currentUser.uid), { role: 'admin' });
            setUserProfile({ ...data, role: 'admin' });
          }
        } else {
          const newProfile = {
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Racer',
            photoURL: currentUser.photoURL || '',
            bestLapTime: Infinity,
            totalRaces: 0,
            coins: 1000000, // Starter coins
            inventory: [],
            role: currentUser.email === 'oreviera1@gmail.com' ? 'admin' : 'user'
          };
          await setDoc(doc(db, 'users', currentUser.uid), newProfile);
          setUserProfile(newProfile);
        }
      } else {
        setUserProfile(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    // Listen for active tournaments
    const q = query(collection(db, 'tournaments'), where('status', '==', 'active'), orderBy('createdAt', 'desc'));
    const unsubscribeTournaments = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setActiveTournaments(docs);
    });

    return () => {
      unsubscribe();
      unsubscribeTournaments();
    };
  }, []);

  useEffect(() => {
    socket.on('roomCreated', ({ roomId, players, isHost }) => {
      setRoomCode(roomId);
      setPlayers(players);
      setIsHost(isHost);
      setView('lobby');
      setError('');
    });

    socket.on('roomJoined', ({ roomId, players, isHost }) => {
      setRoomCode(roomId);
      setPlayers(players);
      setIsHost(isHost);
      setView('lobby');
      setError('');
    });

    socket.on('playerJoinedRoom', (player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    socket.on('playerUpdated', (player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    socket.on('playerDisconnected', (id) => {
      setPlayers((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    socket.on('gameStarted', (initialPlayers) => {
      setPlayers(initialPlayers);
      setView('game');
    });

    socket.on('raceFinished', async ({ winnerId, winnerName }) => {
      setWinner({ id: winnerId, name: winnerName });
      
      if (socket.id === winnerId && user && userProfile) {
        // If there's an active tournament, award the prize
        const activeTournament = activeTournaments[0];
        const prize = activeTournament ? activeTournament.prize : 500000; // Default win prize
        
        const newCoins = (userProfile.coins || 0) + prize;
        await updateDoc(doc(db, 'users', user.uid), { 
          coins: newCoins,
          totalRaces: (userProfile.totalRaces || 0) + 1
        });
        setUserProfile(prev => ({ ...prev, coins: newCoins }));

        if (activeTournament) {
          await updateDoc(doc(db, 'tournaments', activeTournament.id), {
            status: 'completed',
            winnerId: user.uid
          });
        }
      }
    });

    socket.on('error', (msg) => {
      setError(msg);
    });
    
    socket.on('hostMigrated', (newHostId) => {
        if (socket.id === newHostId) {
            setIsHost(true);
        }
    });

    return () => {
      socket.off('roomCreated');
      socket.off('roomJoined');
      socket.off('playerJoinedRoom');
      socket.off('playerUpdated');
      socket.off('playerDisconnected');
      socket.off('gameStarted');
      socket.off('error');
      socket.off('hostMigrated');
    };
  }, []);

  const handleCreate = () => {
    if (!user) return;
    socket.emit('createRoom', { name: user.displayName, isAdmin });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!joinCode.trim() || joinCode.length !== 6) {
        setError('Please enter a valid 6-character room code');
        return;
    }
    socket.emit('joinRoom', { roomId: joinCode.toUpperCase(), name: user.displayName, isAdmin });
  };

  const handleStartGame = () => {
    socket.emit('startGame');
  };

  const handleNewBestLap = async (lapTime: number) => {
    if (!user || !userProfile) return;
    
    if (lapTime < (userProfile.bestLapTime || Infinity)) {
      const updatedProfile = { ...userProfile, bestLapTime: lapTime };
      setUserProfile(updatedProfile);
      await updateDoc(doc(db, 'users', user.uid), { bestLapTime: lapTime });
    }
  };

  const handleToggleSpectate = () => {
    socket.emit('toggleSpectator');
  };

  const handleCreateTournament = async () => {
    if (!isAdmin) return;
    const tournamentData = {
      id: Math.random().toString(36).substring(7),
      name: "Grand Prix " + new Date().toLocaleDateString(),
      prize: 40000000,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'tournaments', tournamentData.id), tournamentData);
  };

  const handleBuyItem = async (item: typeof SHOP_ITEMS[0]) => {
    if (!user || !userProfile) return;
    if (userProfile.coins < item.price) {
      setError("Not enough coins!");
      return;
    }
    if (userProfile.inventory?.includes(item.id)) {
      setError("Already owned!");
      return;
    }

    const newCoins = userProfile.coins - item.price;
    const newInventory = [...(userProfile.inventory || []), item.id];
    
    await updateDoc(doc(db, 'users', user.uid), {
      coins: newCoins,
      inventory: newInventory
    });
    
    setUserProfile(prev => ({ ...prev, coins: newCoins, inventory: newInventory }));
  };

  const handleKick = (targetId: string) => {
    socket.emit('kickPlayer', targetId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-500"></div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-900 flex flex-col items-center ${view === 'game' ? 'justify-start' : 'justify-center'} font-sans text-slate-100`}>
      <header className={`w-full max-w-4xl mx-auto ${view === 'game' ? 'p-2' : 'p-6'} flex justify-between items-center transition-all`}>
        <h1 className={`${view === 'game' ? 'text-2xl' : 'text-4xl'} font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 transform -skew-x-12 transition-all`}>
          TURBO RACE
        </h1>
        {user && view !== 'game' && (
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
              <Coins className="text-yellow-500" size={18} />
              <span className="font-mono font-bold text-yellow-400">
                {(userProfile?.coins || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                {isAdmin && <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Creator</span>}
                <span className="text-sm font-bold text-slate-300">{user.displayName}</span>
              </div>
              {userProfile && userProfile.bestLapTime !== Infinity && (
                <span className="text-[10px] text-yellow-500 uppercase tracking-wider flex items-center gap-1">
                  <Trophy size={10} /> Best: {Math.floor(userProfile.bestLapTime / 1000)}s
                </span>
              )}
            </div>
            <button 
              onClick={logout}
              className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        )}
      </header>

      <nav className={`w-full max-w-4xl mx-auto flex gap-4 px-6 mb-4 ${view === 'game' ? 'hidden' : ''}`}>
        <button onClick={() => setView('landing')} className={`px-4 py-2 rounded-lg font-bold transition-all ${view === 'landing' ? 'bg-yellow-500 text-black' : 'text-slate-400 hover:text-white'}`}>RACE</button>
        <button onClick={() => setView('shop')} className={`px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2 ${view === 'shop' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}><ShoppingBag size={18}/> SHOP</button>
        <button onClick={() => setView('tournaments')} className={`px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2 ${view === 'tournaments' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}><Flag size={18}/> TOURNAMENTS</button>
      </nav>

      <main className={`flex-1 w-full flex flex-col items-center ${view === 'game' ? 'p-0' : 'p-4'} transition-all`}>
        {view === 'landing' && (
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-6 text-center">Start Your Engines</h2>
            
            <div className="space-y-6">
              {error && <div className="text-red-400 text-sm text-center bg-red-900/20 p-2 rounded">{error}</div>}

              {!user ? (
                <button
                  onClick={signInWithGoogle}
                  className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-95"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                  SIGN IN WITH GOOGLE
                </button>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={handleCreate}
                    className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-400 hover:to-orange-500 text-black font-bold py-3 rounded-lg shadow-lg transition-transform active:scale-95"
                  >
                    CREATE RACE
                  </button>
                  
                  <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-700"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                          <span className="px-2 bg-slate-800 text-slate-500">Or join a friend</span>
                      </div>
                  </div>

                  <form onSubmit={handleJoin} className="flex gap-2">
                      <input
                          type="text"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white uppercase tracking-widest font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                          placeholder="CODE"
                          maxLength={6}
                      />
                      <button
                          type="submit"
                          className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-lg shadow-lg transition-transform active:scale-95"
                      >
                          JOIN
                      </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'shop' && (
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 max-w-4xl w-full">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-black italic tracking-tighter text-blue-400">TURBO SHOP</h2>
              <div className="flex items-center gap-2 bg-black/30 px-4 py-2 rounded-xl border border-slate-600">
                <Coins className="text-yellow-500" size={24} />
                <span className="text-2xl font-mono font-bold text-yellow-400">{(userProfile?.coins || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {SHOP_ITEMS.map(item => (
                <div key={item.id} className="bg-slate-900 p-6 rounded-xl border border-slate-700 flex justify-between items-center group hover:border-blue-500 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg shadow-inner" style={{ backgroundColor: item.color }}></div>
                    <div>
                      <h3 className="font-bold text-lg">{item.name}</h3>
                      <div className="flex items-center gap-1 text-yellow-500 font-mono text-sm">
                        <Coins size={14} /> {item.price.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuyItem(item)}
                    disabled={userProfile?.inventory?.includes(item.id)}
                    className={`px-6 py-2 rounded-lg font-bold transition-all ${
                      userProfile?.inventory?.includes(item.id)
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
                    }`}
                  >
                    {userProfile?.inventory?.includes(item.id) ? 'OWNED' : 'BUY'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'tournaments' && (
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 max-w-4xl w-full">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-black italic tracking-tighter text-purple-400">TOURNAMENTS</h2>
              {isAdmin && (
                <button
                  onClick={handleCreateTournament}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-2 rounded-lg shadow-lg transition-all active:scale-95 flex items-center gap-2"
                >
                  <Star size={18} /> CREATE TOURNAMENT
                </button>
              )}
            </div>

            <div className="space-y-4">
              {activeTournaments.length === 0 ? (
                <div className="text-center py-12 text-slate-500 italic bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
                  No active tournaments. Wait for the Creator to start one!
                </div>
              ) : (
                activeTournaments.map(t => (
                  <div key={t.id} className="bg-slate-900 p-6 rounded-xl border-l-4 border-purple-500 flex justify-between items-center">
                    <div>
                      <h3 className="text-xl font-bold text-white">{t.name}</h3>
                      <p className="text-slate-400 text-sm">Started on {new Date(t.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Grand Prize</div>
                      <div className="text-2xl font-mono font-bold text-yellow-400 flex items-center gap-2 justify-end">
                        <Coins size={20} /> {t.prize.toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {view === 'lobby' && (
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 max-w-2xl w-full">
                <div className="text-center mb-8">
                    {activeTournaments.length > 0 && (
                      <div className="mb-4 bg-purple-600/20 border border-purple-500/50 rounded-xl p-3 flex items-center justify-center gap-3 animate-pulse">
                        <Star className="text-purple-400" size={20} />
                        <span className="text-purple-300 font-bold uppercase tracking-wider">Tournament Active: {activeTournaments[0].name}</span>
                        <div className="flex items-center gap-1 text-yellow-400 font-mono">
                          <Coins size={16} /> {activeTournaments[0].prize.toLocaleString()}
                        </div>
                      </div>
                    )}
                    <h2 className="text-xl text-slate-400 mb-2">Room Code</h2>
                    <div className="text-6xl font-mono font-black tracking-widest text-yellow-400 bg-black/30 p-4 rounded-xl inline-block border-2 border-dashed border-slate-600 select-all">
                        {roomCode}
                    </div>
                    <p className="text-sm text-slate-500 mt-2">Share this code with your friends!</p>
                </div>

                <div className="mb-8">
                    <h3 className="text-lg font-bold mb-4 flex justify-between items-center">
                        <span>Racers ({Object.values(players).filter(p => !p.isSpectator).length})</span>
                        {isHost && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">You are Host</span>}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        {Object.values(players).filter(p => !p.isSpectator).map(p => (
                            <div key={p.id} className="bg-slate-700/50 p-3 rounded-lg flex items-center gap-3 border border-slate-600">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }}></div>
                                <div className="flex flex-col min-w-0">
                                  <span className="font-bold truncate leading-none">{p.name}</span>
                                  {p.isAdmin && <span className="text-[8px] text-red-400 font-black uppercase tracking-tighter mt-0.5">Creator</span>}
                                </div>
                                {p.id === socket.id ? (
                                  <span className="text-xs text-slate-400">(You)</span>
                                ) : (
                                  isAdmin && (
                                    <button 
                                      onClick={() => handleKick(p.id)}
                                      className="ml-auto text-[10px] bg-red-900/30 hover:bg-red-600 text-red-400 hover:text-white px-2 py-1 rounded transition-colors font-bold uppercase"
                                    >
                                      Kick
                                    </button>
                                  )
                                )}
                            </div>
                        ))}
                    </div>

                    {Object.values(players).some(p => p.isSpectator) && (
                        <>
                            <h3 className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wider">Spectators ({Object.values(players).filter(p => p.isSpectator).length})</h3>
                            <div className="grid grid-cols-2 gap-3 mb-6 opacity-60">
                                {Object.values(players).filter(p => p.isSpectator).map(p => (
                                    <div key={p.id} className="bg-slate-800/50 p-2 rounded-lg flex items-center gap-3 border border-slate-700">
                                        <div className="flex flex-col min-w-0">
                                          <span className="text-sm truncate leading-none">{p.name}</span>
                                          {p.isAdmin && <span className="text-[8px] text-red-400 font-black uppercase tracking-tighter mt-0.5">Creator</span>}
                                        </div>
                                        {p.id === socket.id ? (
                                          <span className="text-xs text-slate-400">(You)</span>
                                        ) : (
                                          isAdmin && (
                                            <button 
                                              onClick={() => handleKick(p.id)}
                                              className="ml-auto text-[10px] bg-red-900/30 hover:bg-red-600 text-red-400 hover:text-white px-2 py-1 rounded transition-colors font-bold uppercase"
                                            >
                                              Kick
                                            </button>
                                          )
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <button 
                        onClick={handleToggleSpectate}
                        className={`w-full py-2 rounded-lg border-2 transition-all font-bold text-sm ${
                            players[socket.id || '']?.isSpectator 
                            ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/20' 
                            : 'bg-slate-700/30 border-slate-600 text-slate-400 hover:bg-slate-700/50'
                        }`}
                    >
                        {players[socket.id || '']?.isSpectator ? 'SWITCH TO RACER' : 'SWITCH TO SPECTATOR'}
                    </button>
                </div>

                {isHost ? (
                    <button
                        onClick={handleStartGame}
                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl shadow-lg text-xl tracking-wide transition-transform active:scale-95 animate-pulse"
                    >
                        START RACE
                    </button>
                ) : (
                    <div className="text-center text-slate-400 italic animate-pulse">
                        Waiting for host to start the race...
                    </div>
                )}
            </div>
        )}

        {view === 'game' && (
          <div className="relative w-full h-full">
            <GameCanvas initialPlayers={players} onNewBestLap={handleNewBestLap} />
            {winner && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 animate-in fade-in zoom-in duration-500">
                <Trophy size={120} className="text-yellow-500 mb-6 animate-bounce" />
                <h2 className="text-6xl font-black italic tracking-tighter text-white mb-2">RACE FINISHED!</h2>
                <p className="text-3xl text-yellow-400 font-bold mb-8">{winner.name} WINS!</p>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      setWinner(null);
                      setView('lobby');
                    }}
                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-black px-12 py-4 rounded-xl text-2xl transition-all active:scale-95"
                  >
                    BACK TO LOBBY
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
