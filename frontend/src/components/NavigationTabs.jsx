import React from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Users, ShieldCheck, FlaskConical } from 'lucide-react';

export default function NavigationTabs({ activeTab, onSelectTab, counts }) {
  const tabs = [
    {
      id: 'overview',
      label: 'Overview & Pipeline',
      icon: LayoutDashboard,
      badge: counts.activeCalls > 0 ? `${counts.activeCalls} active` : null,
      badgeColor: '#3b82f6'
    },
    {
      id: 'agents',
      label: 'Agent Workforce',
      icon: Users,
      badge: `${counts.availableAgents}/${counts.totalAgents} free`,
      badgeColor: '#10b981'
    },
    {
      id: 'safety',
      label: 'Safety & Compliance',
      icon: ShieldCheck,
      badge: `${counts.safetyCount} logged`,
      badgeColor: '#a855f7'
    },
    {
      id: 'testing',
      label: 'Chaos & Testing Lab',
      icon: FlaskConical,
      badge: 'Live',
      badgeColor: '#f59e0b'
    }
  ];

  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      padding: '6px',
      borderRadius: 14,
      border: '1px solid rgba(255, 255, 255, 0.08)',
      marginBottom: 24,
      overflowX: 'auto',
      boxShadow: '0 8px 24px -6px rgba(0, 0, 0, 0.5)'
    }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: isActive ? '#ffffff' : '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              zIndex: 1,
              transition: 'color 0.2s ease'
            }}
          >
            {isActive && (
              <motion.div
                layoutId="activeTabIndicator"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.9), rgba(99, 102, 241, 0.75))',
                  borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(79, 70, 229, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                  zIndex: -1
                }}
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}

            <Icon size={16} color={isActive ? '#ffffff' : '#94a3b8'} />
            <span>{tab.label}</span>

            {tab.badge && (
              <span style={{
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 12,
                background: isActive ? 'rgba(255, 255, 255, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                color: isActive ? '#ffffff' : '#cbd5e1',
                border: isActive ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgba(255, 255, 255, 0.05)',
                fontWeight: 600
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
