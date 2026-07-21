import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { DRES_BASE_URL } from '../../api';

export default function DresLoginModal({ onClose, onLoginSuccess, onLogout, sessionId, evaluationId }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [evaluations, setEvaluations] = useState([]);
  const [fetchingEvals, setFetchingEvals] = useState(false);

  useEffect(() => {
    if (sessionId) {
      setFetchingEvals(true);
      fetch(`${DRES_BASE_URL}/api/v2/client/evaluation/list?session=${sessionId}`)
        .then(res => {
          if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
          return res.json();
        })
        .then(data => {
          if (data && data.length > 0) {
            setEvaluations(data);
          } else {
            setEvaluations([]);
          }
        })
        .catch(err => {
          console.error('Error fetching evaluations:', err);
          toast.error('Failed to load active evaluations.');
        })
        .finally(() => {
          setFetchingEvals(false);
        });
    }
  }, [sessionId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    
    setLoading(true);
    try {
      // Step 1: Login to get session ID
      const loginRes = await fetch(`${DRES_BASE_URL}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() })
      });
      
      if (!loginRes.ok) {
        throw new Error(`Login failed: ${loginRes.statusText}`);
      }
      
      const loginData = await loginRes.json();
      const newSessionId = loginData.sessionId;
      
      if (!newSessionId) {
        throw new Error('No sessionId returned from server');
      }

      // Step 2: Fetch evaluation ID
      const evalRes = await fetch(`${DRES_BASE_URL}/api/v2/client/evaluation/list?session=${newSessionId}`);
      
      if (!evalRes.ok) {
        throw new Error(`Failed to fetch evaluations: ${evalRes.statusText}`);
      }
      
      const evalData = await evalRes.json();
      
      let newEvalId = null;
      if (evalData && evalData.length > 0) {
        newEvalId = evalData[0].id;
      }
      
      onLoginSuccess(newSessionId, newEvalId, username.trim());
      toast.success('DRES Logged in successfully!');
      // Do not call onClose() here, allow the user to see the evaluation selection UI
    } catch (error) {
      console.error('DRES Login Error:', error);
      toast.error(error.message || 'Failed to login to DRES');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
      toast.success('Logged out from DRES');
      onClose();
    }
  };

  const handleSelectEval = (e) => {
    const selectedId = e.target.value;
    if (onLoginSuccess && sessionId) {
      onLoginSuccess(sessionId, selectedId);
      toast.success('Active evaluation updated');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-[3000] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-[340px] rounded-lg shadow-[var(--shadow-heavy)] overflow-hidden flex flex-col backdrop-blur-md animate-scaleIn relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg)] transition-colors z-10"
        >
          <i className="fas fa-times"></i>
        </button>
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--glass-bg)] flex flex-col items-center gap-3">
          <div className="h-12 w-12 flex items-center justify-center flex-shrink-0 animate-float drop-shadow-lg text-3xl text-emerald-500">
            <i className="fas fa-server"></i>
          </div>
          <h2 className="text-base font-bold text-center text-[var(--text-primary)]">
            {sessionId ? 'DRES Active Session' : 'DRES Login'}
          </h2>
        </div>
        
        {sessionId ? (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-[var(--text-secondary)] font-medium">Select Evaluation:</label>
              {fetchingEvals ? (
                <div className="text-xs text-[var(--text-secondary)] py-2 flex items-center gap-2">
                  <i className="fas fa-spinner fa-spin"></i> Fetching...
                </div>
              ) : (
                <select
                  value={evaluationId || ''}
                  onChange={handleSelectEval}
                  className="w-full px-3 py-2.5 bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  {evaluations.map(ev => (
                    <option key={ev.id} value={ev.id} className="bg-[var(--bg-primary)] text-white">
                      {ev.name || ev.id}
                    </option>
                  ))}
                  {evaluations.length === 0 && (
                    <option disabled value="">No active evaluations found</option>
                  )}
                </select>
              )}
            </div>
            
            <button
              onClick={handleLogout}
              className="w-full mt-2 bg-red-500/10 border border-red-500/20 text-red-400 font-semibold text-xs py-3 rounded-lg hover:bg-red-500/20 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth cursor-pointer"
            >
              <i className="fas fa-sign-out-alt mr-2"></i> Logout
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
            <p className="text-xs text-[var(--text-secondary)]">Enter your DRES credentials.</p>
            <input
              type="text"
              className="w-full px-3 py-2.5 bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-secondary)]"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <input
              type="password"
              className="w-full px-3 py-2.5 bg-[var(--glass-bg)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-secondary)]"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-semibold text-xs py-3 rounded-lg hover:bg-[var(--accent-secondary)] hover:shadow-glow hover:-translate-y-0.5 active:scale-95 active:translate-y-0 transition-all duration-300 ease-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Login'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
