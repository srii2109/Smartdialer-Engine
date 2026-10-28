/**
 * Normalizes backend payload from either Express (camelCase) or Python/FastAPI (snake_case)
 * to prevent undefined errors and guarantee consistent state shapes across the UI.
 */
export function normalizeStatus(raw) {
  if (!raw) return null;

  const mode = raw.mode || 'PROGRESSIVE';
  const activeProvider = raw.activeProvider || raw.active_provider || 'PROVIDER_A';
  const isRunning = Boolean(raw.isRunning ?? raw.is_running ?? false);

  const totalAgents = Number(raw.totalAgents ?? raw.total_agents ?? 0);
  const availableAgents = Number(raw.availableAgents ?? raw.available_agents ?? 0);
  const reservedAgents = Number(raw.reservedAgents ?? raw.reserved_agents ?? 0);
  const dialingAgents = Number(raw.dialingAgents ?? raw.dialing_agents ?? 0);
  const connectedAgents = Number(raw.connectedAgents ?? raw.connected_agents ?? 0);
  const wrapUpAgents = Number(raw.wrapUpAgents ?? raw.wrap_up_agents ?? 0);
  const pausedAgents = Number(raw.pausedAgents ?? raw.paused_agents ?? 0);
  const offlineAgents = Number(raw.offlineAgents ?? raw.offline_agents ?? 0);

  const activeCalls = Number(raw.activeCalls ?? raw.active_calls ?? 0);
  const ringingCalls = Number(raw.ringingCalls ?? raw.ringing_calls ?? 0);
  const connectedCalls = Number(raw.connectedCalls ?? raw.connected_calls ?? 0);
  const completedCalls = Number(raw.completedCalls ?? raw.completed_calls ?? 0);
  const failedCalls = Number(raw.failedCalls ?? raw.failed_calls ?? 0);
  const abandonedCalls = Number(raw.abandonedCalls ?? raw.abandoned_calls ?? 0);

  const agentUtilizationPct = Number(raw.agentUtilizationPct ?? raw.agent_utilization_pct ?? 0);
  const abandonmentRatePct = Number(raw.abandonmentRatePct ?? raw.abandonment_rate_pct ?? 0);
  const safetyInterventionsCount = Number(raw.safetyInterventionsCount ?? raw.safety_interventions_count ?? 0);

  const ph = raw.providerHealth || raw.provider_health || {};
  const providerHealth = {
    providerId: ph.providerId || ph.provider_id || activeProvider,
    isHealthy: Boolean(ph.isHealthy ?? ph.is_healthy ?? true),
    healthPct: Number(ph.healthPct ?? ph.health_pct ?? 100),
    avgLatencyMs: Number(ph.avgLatencyMs ?? ph.avg_latency_ms ?? 0),
    outageActive: Boolean(ph.outageActive ?? ph.outage_active ?? false),
    totalRequests: Number(ph.totalRequests ?? ph.total_requests ?? 0)
  };

  const ld = raw.lastSafetyDecision || raw.last_safety_decision || null;
  const lastSafetyDecision = ld ? {
    id: ld.id,
    requestedCalls: Number(ld.requestedCalls ?? ld.requested_calls ?? 0),
    approvedCalls: Number(ld.approvedCalls ?? ld.approved_calls ?? 0),
    decision: ld.decision || 'IDLE',
    reason: ld.reason || 'Waiting next cycle',
    mode: ld.mode || mode,
    timestamp: ld.timestamp || ''
  } : null;

  return {
    mode,
    activeProvider,
    isRunning,
    totalAgents,
    availableAgents,
    reservedAgents,
    dialingAgents,
    connectedAgents,
    wrapUpAgents,
    pausedAgents,
    offlineAgents,
    activeCalls,
    ringingCalls,
    connectedCalls,
    completedCalls,
    failedCalls,
    abandonedCalls,
    agentUtilizationPct,
    abandonmentRatePct,
    safetyInterventionsCount,
    providerHealth,
    lastSafetyDecision
  };
}
