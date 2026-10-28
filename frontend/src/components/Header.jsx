import React from 'react';
import { motion } from 'framer-motion';
import { PhoneCall, Play, Pause, RefreshCw } from 'lucide-react';

export default function Header({ status, onSetMode, onSetProvider, onToggleDialer }) {
  const isPredictive = status?.mode === 'PREDICTIVE';
  const isRunning = status?.isRunning;
  const activeProvider = status?.activeProvider;

  return (
    <header className="glass-panel" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 22px',
      borderRadius: 16,
      marginBottom: 20,
      flexWrap: 'wrap',
      gap: 16
    }}>
      {/* Brand & Subtitle with glowing ambient beacon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          position: 'relative',
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          padding: 10,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 24px rgba(99, 102, 241, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
        }}>
          <PhoneCall size={22} color="#fff" />
          <div style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 15,
            border: '1px solid rgba(99, 102, 241, 0.4)',
            pointerEvents: 'none'
          }} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="shimmer-text" style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>
              SmartDialer
            </h1>
            <span style={{
              fontSize: 10,
              color: '#a5b4fc',
              fontWeight: 700,
              padding: '2px 8px',
              background: 'rgba(99, 102, 241, 0.15)',
              borderRadius: 6,
              border: '1px solid rgba(99, 102, 241, 0.3)',
              letterSpacing: '0.05em'
            }}>
              MISSION CONTROL
            </span>

            {/* Pulsing live status indicator */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 14,
              background: isRunning ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)',
              color: isRunning ? '#34d399' : '#94a3b8',
              border: `1px solid ${isRunning ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
            }}>
              <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                {isRunning && (
                  <span style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    animation: 'beaconPulse 1.8s infinite'
                  }} />
                )}
                <span style={{
                  position: 'relative',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: isRunning ? '#10b981' : '#64748b'
                }} />
              </span>
              <span>{isRunning ? 'DISPATCHING LIVE' : 'PAUSED'}</span>
            </div>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
            Progressive &amp; Predictive Pacing with Non-Bypassable Compliance Controller
          </p>
        </div>
      </div>

      {/* Control Actions Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        
        {/* Dialing Mode Segmented Switcher with Framer Motion slide */}
        <div style={{
          position: 'relative',
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.8)',
          padding: 3,
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <button
            onClick={() => onSetMode('PROGRESSIVE')}
            style={{
              position: 'relative',
              background: 'transparent',
              color: !isPredictive ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              zIndex: 1,
              transition: 'color 0.2s ease'
            }}
          >
            {!isPredictive && (
              <motion.div
                layoutId="modeSlider"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: '#4f46e5',
                  borderRadius: 8,
                  zIndex: -1,
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)'
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            Progressive (1:1)
          </button>

          <button
            onClick={() => onSetMode('PREDICTIVE')}
            style={{
              position: 'relative',
              background: 'transparent',
              color: isPredictive ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              zIndex: 1,
              transition: 'color 0.2s ease'
            }}
          >
            {isPredictive && (
              <motion.div
                layoutId="modeSlider"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: '#4f46e5',
                  borderRadius: 8,
                  zIndex: -1,
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)'
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            Predictive (Pacing)
          </button>
        </div>

        {/* Telecom Provider Segmented Switcher */}
        <div style={{
          position: 'relative',
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.8)',
          padding: 3,
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <button
            onClick={() => onSetProvider('PROVIDER_A')}
            style={{
              background: activeProvider === 'PROVIDER_A' ? '#059669' : 'transparent',
              color: activeProvider === 'PROVIDER_A' ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              boxShadow: activeProvider === 'PROVIDER_A' ? '0 2px 8px rgba(5, 150, 105, 0.35)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            Provider A (Fast)
          </button>
          <button
            onClick={() => onSetProvider('PROVIDER_B')}
            style={{
              background: activeProvider === 'PROVIDER_B' ? '#d97706' : 'transparent',
              color: activeProvider === 'PROVIDER_B' ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              boxShadow: activeProvider === 'PROVIDER_B' ? '0 2px 8px rgba(217, 119, 6, 0.35)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            Provider B (Chaos)
          </button>
        </div>

        {/* Start / Pause / Resume Button */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onToggleDialer(isRunning ? 'pause' : 'resume')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: isRunning
              ? 'rgba(30, 41, 59, 0.9)'
              : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#ffffff',
            border: `1px solid ${isRunning ? 'rgba(255, 255, 255, 0.12)' : 'rgba(16, 185, 129, 0.5)'}`,
            padding: '8px 16px',
            borderRadius: 10,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 12,
            boxShadow: isRunning
              ? 'none'
              : '0 4px 14px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.25)',
            transition: 'all 0.2s ease'
          }}
        >
          {isRunning ? (
            <>
              <Pause size={14} /> Pause Engine
            </>
          ) : (
            <>
              <Play size={14} fill="#ffffff" /> Resume Engine
            </>
          )}
        </motion.button>

        {/* Reset Button */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onToggleDialer('reset')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(239, 68, 68, 0.12)',
            color: '#fca5a5',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            padding: '8px 14px',
            borderRadius: 10,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 12,
            transition: 'all 0.2s ease'
          }}
          title="Reset database and restart dialer loop"
        >
          <RefreshCw size={13} /> Reset
        </motion.button>
      </div>
    </header>
  );
}
