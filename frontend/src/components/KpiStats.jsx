import React from 'react';
import { motion } from 'framer-motion';
import { Activity, ShieldAlert, Users, Radio, ShieldCheck } from 'lucide-react';

export default function KpiStats({ status }) {
  if (!status) return null;

  const isAbandonmentHigh = status.abandonmentRatePct > 3.0;

  const cards = [
    {
      label: 'AGENT UTILIZATION',
      value: `${status.agentUtilizationPct}%`,
      subtext: `${status.connectedAgents} active in conversation`,
      color: '#60a5fa',
      glow: 'rgba(96, 165, 250, 0.15)',
      icon: Activity,
      progress: Math.min(100, Math.max(0, status.agentUtilizationPct))
    },
    {
      label: 'ABANDONMENT RATE',
      value: `${status.abandonmentRatePct}%`,
      subtext: `Target: <3.0% (${status.abandonedCalls} dropped)`,
      color: isAbandonmentHigh ? '#ef4444' : '#10b981',
      glow: isAbandonmentHigh ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.15)',
      icon: ShieldAlert,
      badge: isAbandonmentHigh ? 'NON-COMPLIANT' : 'COMPLIANT'
    },
    {
      label: 'AVAILABLE WORKFORCE',
      value: `${status.availableAgents}`,
      unit: `/ ${status.totalAgents}`,
      subtext: `${status.dialingAgents} dialing, ${status.offlineAgents} offline`,
      color: '#34d399',
      glow: 'rgba(52, 211, 153, 0.15)',
      icon: Users
    },
    {
      label: 'CALLS IN FLIGHT',
      value: `${status.activeCalls}`,
      subtext: `${status.ringingCalls} ringing, ${status.connectedCalls} connected`,
      color: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.15)',
      icon: Radio
    },
    {
      label: 'SAFETY INTERVENTIONS',
      value: `${status.safetyInterventionsCount}`,
      subtext: 'Audited evaluations in MySQL',
      color: '#c084fc',
      glow: 'rgba(192, 132, 252, 0.15)',
      icon: ShieldCheck
    }
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
      gap: 14,
      marginBottom: 24
    }}>
      {cards.map((c, idx) => {
        const Icon = c.icon;
        return (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: idx * 0.06 }}
            whileHover={{ y: -3, transition: { duration: 0.2 } }}
            className="glass-panel"
            style={{
              padding: '16px 18px',
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* Subtle top accent corner glow */}
            <div style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 80,
              height: 80,
              background: `radial-gradient(circle at top right, ${c.glow}, transparent 70%)`,
              pointerEvents: 'none'
            }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
                {c.label}
              </span>
              <div style={{
                background: c.glow,
                padding: 7,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${c.color}33`
              }}>
                <Icon size={14} color={c.color} />
              </div>
            </div>

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                {c.value}
              </span>
              {c.unit && (
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                  {c.unit}
                </span>
              )}
              {c.badge && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background: isAbandonmentHigh ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  color: c.color,
                  border: `1px solid ${c.color}44`
                }}>
                  {c.badge}
                </span>
              )}
            </div>

            {typeof c.progress === 'number' && (
              <div style={{
                width: '100%',
                background: 'rgba(30, 41, 59, 0.8)',
                height: 5,
                borderRadius: 3,
                marginTop: 12,
                overflow: 'hidden'
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${c.progress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  style={{
                    background: `linear-gradient(90deg, #3b82f6, ${c.color})`,
                    height: '100%',
                    borderRadius: 3
                  }}
                />
              </div>
            )}

            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: typeof c.progress === 'number' ? 8 : 10 }}>
              {c.subtext}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
