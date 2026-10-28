import { v4 as uuidv4 } from 'uuid';

export class BaseMockProvider {
  constructor(providerId) {
    this.providerId = providerId;
    this.inOutage = false;
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.latencies = [];
    this.activeCalls = new Map();
    this.simulatedAnswerRate = 0.40;
    this.simulatedTalkTime = 12.0;
  }

  setOutage(active) {
    this.inOutage = Boolean(active);
    console.log(`[${this.providerId}] Outage mode set to: ${this.inOutage}`);
  }

  setAnswerRate(rate) {
    this.simulatedAnswerRate = Math.max(0.0, Math.min(1.0, rate));
  }

  setTalkTime(seconds) {
    this.simulatedTalkTime = Math.max(1.0, seconds);
  }

  getHealth() {
    if (this.inOutage) {
      return {
        providerId: this.providerId,
        isHealthy: false,
        healthPct: 0.0,
        successRatePct: 0.0,
        avgLatencyMs: 5000.0,
        outageActive: true,
        totalRequests: this.totalRequests
      };
    }

    let successRate = 1.0;
    if (this.totalRequests > 0) {
      successRate = Math.max(0.0, (this.totalRequests - this.failedRequests) / this.totalRequests);
    }

    const recent = this.latencies.slice(-20);
    const avgLat = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 120.0;
    const healthPct = Number((successRate * 100).toFixed(1));

    return {
      providerId: this.providerId,
      isHealthy: healthPct >= 80.0,
      healthPct,
      successRatePct: healthPct,
      avgLatencyMs: Number(avgLat.toFixed(1)),
      outageActive: false,
      totalRequests: this.totalRequests
    };
  }
}

export class ProviderA extends BaseMockProvider {
  constructor() {
    super('PROVIDER_A');
  }

  async initiateCall(callId, phone, webhookCb) {
    this.totalRequests++;

    if (this.inOutage) {
      this.failedRequests++;
      throw new Error(`[${this.providerId}] Outage active - connection timeout`);
    }

    // Fast latency (50 - 150ms)
    const latency = 50 + Math.random() * 100;
    await new Promise((r) => setTimeout(r, latency));
    this.latencies.push(latency);

    const providerCallId = `provA_${uuidv4().substring(0, 8)}`;
    this.activeCalls.set(callId, { providerCallId, active: true });

    // Background lifecycle
    this.simulateCallLifecycle(callId, providerCallId, webhookCb);
    return providerCallId;
  }

  async simulateCallLifecycle(callId, providerCallId, webhookCb) {
    try {
      // 1. INITIATED
      await webhookCb({
        eventId: `evt_${uuidv4().substring(0, 8)}`,
        callId,
        providerId: this.providerId,
        providerCallId,
        eventType: 'INITIATED'
      });

      // 2. RINGING
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
      await webhookCb({
        eventId: `evt_${uuidv4().substring(0, 8)}`,
        callId,
        providerId: this.providerId,
        providerCallId,
        eventType: 'RINGING'
      });

      // Ringing duration
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));

      const answered = Math.random() < this.simulatedAnswerRate;
      if (answered) {
        // 3. ANSWERED
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'ANSWERED'
        });

        const talkDur = Math.min(8.0, Math.max(2.0, this.simulatedTalkTime / 10.0));
        await new Promise((r) => setTimeout(r, talkDur * 1000));

        // 4. COMPLETED
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'COMPLETED',
          talkTimeSec: talkDur * 10.0
        });
      } else {
        // 3. FAILED (No answer)
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'FAILED',
          errorReason: 'NO_ANSWER'
        });
      }
    } catch (e) {
      console.error(`[${this.providerId}] Lifecycle error for ${callId}:`, e.message);
    } finally {
      this.activeCalls.delete(callId);
    }
  }

  async hangup(callId) {
    if (this.activeCalls.has(callId)) {
      this.activeCalls.delete(callId);
      return true;
    }
    return false;
  }
}

export class ProviderB extends BaseMockProvider {
  constructor() {
    super('PROVIDER_B');
    this.duplicateEventRate = 0.35;
    this.outOfOrderRate = 0.25;
  }

  async initiateCall(callId, phone, webhookCb) {
    this.totalRequests++;

    if (this.inOutage) {
      this.failedRequests++;
      throw new Error(`[${this.providerId}] Outage active - connection timeout`);
    }

    // Slower latency (400 - 1000ms)
    const latency = 400 + Math.random() * 600;
    await new Promise((r) => setTimeout(r, latency));
    this.latencies.push(latency);

    if (Math.random() < 0.10) {
      this.failedRequests++;
      throw new Error(`[${this.providerId}] Simulated gateway timeout during call initiation`);
    }

    const providerCallId = `provB_${uuidv4().substring(0, 8)}`;
    this.activeCalls.set(callId, { providerCallId, active: true });

    this.simulateChaosLifecycle(callId, providerCallId, webhookCb);
    return providerCallId;
  }

  async simulateChaosLifecycle(callId, providerCallId, webhookCb) {
    try {
      await webhookCb({
        eventId: `evt_${uuidv4().substring(0, 8)}`,
        callId,
        providerId: this.providerId,
        providerCallId,
        eventType: 'INITIATED'
      });

      await new Promise((r) => setTimeout(r, 400));
      const answered = Math.random() < this.simulatedAnswerRate;
      const shouldOutOfOrder = Math.random() < this.outOfOrderRate;

      if (shouldOutOfOrder && answered) {
        // CHAOS: Send ANSWERED before RINGING
        const ansEvtId = `evt_${uuidv4().substring(0, 8)}`;
        await webhookCb({
          eventId: ansEvtId,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'ANSWERED'
        });

        // Duplicate ANSWERED check
        if (Math.random() < this.duplicateEventRate) {
          await webhookCb({
            eventId: ansEvtId,
            callId,
            providerId: this.providerId,
            providerCallId,
            eventType: 'ANSWERED'
          });
        }

        // Late RINGING after ANSWERED
        await new Promise((r) => setTimeout(r, 150));
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'RINGING'
        });

        const talkDur = Math.min(6.0, Math.max(2.0, this.simulatedTalkTime / 10.0));
        await new Promise((r) => setTimeout(r, talkDur * 1000));

        // COMPLETED
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'COMPLETED',
          talkTimeSec: talkDur * 10.0
        });
      } else {
        // Normal progression with possible duplicate
        await webhookCb({
          eventId: `evt_${uuidv4().substring(0, 8)}`,
          callId,
          providerId: this.providerId,
          providerCallId,
          eventType: 'RINGING'
        });

        await new Promise((r) => setTimeout(r, 600));

        if (answered) {
          const ansEvt = `evt_${uuidv4().substring(0, 8)}`;
          await webhookCb({
            eventId: ansEvt,
            callId,
            providerId: this.providerId,
            providerCallId,
            eventType: 'ANSWERED'
          });

          if (Math.random() < this.duplicateEventRate) {
            await webhookCb({
              eventId: ansEvt,
              callId,
              providerId: this.providerId,
              providerCallId,
              eventType: 'ANSWERED'
            });
          }

          const talkDur = Math.min(6.0, Math.max(2.0, this.simulatedTalkTime / 10.0));
          await new Promise((r) => setTimeout(r, talkDur * 1000));

          await webhookCb({
            eventId: `evt_${uuidv4().substring(0, 8)}`,
            callId,
            providerId: this.providerId,
            providerCallId,
            eventType: 'COMPLETED',
            talkTimeSec: talkDur * 10.0
          });
        } else {
          await webhookCb({
            eventId: `evt_${uuidv4().substring(0, 8)}`,
            callId,
            providerId: this.providerId,
            providerCallId,
            eventType: 'FAILED',
            errorReason: 'BUSY'
          });
        }
      }
    } catch (e) {
      console.error(`[${this.providerId}] Chaos error:`, e.message);
    } finally {
      this.activeCalls.delete(callId);
    }
  }

  async hangup(callId) {
    if (this.activeCalls.has(callId)) {
      this.activeCalls.delete(callId);
      return true;
    }
    return false;
  }
}
