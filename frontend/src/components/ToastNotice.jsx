import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function ToastNotice({ notice }) {
  if (!notice) return null;

  const isError = notice.isError;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      pointerEvents: 'none', // Prevents toast from ever blocking clicks to any buttons underneath!
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      backgroundColor: isError ? '#991b1b' : '#065f46',
      border: `1px solid ${isError ? '#ef4444' : '#10b981'}`,
      color: '#ffffff',
      padding: '10px 16px',
      borderRadius: 8,
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
      fontSize: 13,
      fontWeight: 600,
      maxWidth: 380
    }}>
      {isError ? (
        <AlertCircle size={18} color="#fca5a5" style={{ flexShrink: 0 }} />
      ) : (
        <CheckCircle2 size={18} color="#34d399" style={{ flexShrink: 0 }} />
      )}
      <span style={{ lineHeight: 1.4 }}>{notice.msg}</span>
    </div>
  );
}
