"""Telecom Provider Interface and Mock Provider Implementations (Provider A and Provider B).

Includes support for chaos testing, timeouts, duplicate events, and out-of-order event injection.
"""

import abc
import asyncio
import logging
import random
import time
import uuid
from typing import Dict, Any, Optional, Callable, Awaitable

logger = logging.getLogger("smartdialer.providers")

WebhookCallback = Callable[[Dict[str, Any]], Awaitable[None]]


class ITelecomProvider(abc.ABC):
    """Abstract interface defining contract for telecom integrations."""

    @property
    @abc.abstractmethod
    def provider_id(self) -> str:
        pass

    @abc.abstractmethod
    async def initiate_call(self, call_id: str, phone: str, webhook_cb: WebhookCallback) -> str:
        """Initiates an outbound call and returns provider_call_id."""
        pass

    @abc.abstractmethod
    async def hangup(self, call_id: str) -> bool:
        """Terminates an ongoing call."""
        pass

    @abc.abstractmethod
    def get_health(self) -> Dict[str, Any]:
        """Returns health telemetry: success rate, average latency, and outage status."""
        pass

    @abc.abstractmethod
    def set_outage(self, active: bool) -> None:
        """Simulates an outage / downtime for failure testing."""
        pass


class BaseMockProvider(ITelecomProvider):
    def __init__(self, provider_id: str):
        self._provider_id = provider_id
        self._in_outage = False
        self._total_requests = 0
        self._failed_requests = 0
        self._latencies = []
        self._active_calls: Dict[str, Dict[str, Any]] = {}
        self.simulated_answer_rate = 0.40 # Default 40% answer rate
        self.simulated_talk_time = 15.0 # Simulated seconds for testing/demo

    @property
    def provider_id(self) -> str:
        return self._provider_id

    def set_outage(self, active: bool) -> None:
        self._in_outage = active
        logger.warning(f"[{self.provider_id}] Outage mode set to: {active}")

    def set_answer_rate(self, rate: float) -> None:
        self.simulated_answer_rate = max(0.0, min(1.0, rate))

    def set_talk_time(self, seconds: float) -> None:
        self.simulated_talk_time = max(1.0, seconds)

    def get_health(self) -> Dict[str, Any]:
        if self._in_outage:
            return {
                "provider_id": self._provider_id,
                "is_healthy": False,
                "health_pct": 0.0,
                "success_rate_pct": 0.0,
                "avg_latency_ms": 5000.0,
                "outage_active": True,
                "total_requests": self._total_requests
            }
        
        success_rate = 1.0
        if self._total_requests > 0:
            success_rate = max(0.0, (self._total_requests - self._failed_requests) / self._total_requests)
        
        avg_lat = sum(self._latencies[-20:]) / len(self._latencies[-20:]) if self._latencies else 150.0
        health_pct = round(success_rate * 100.0, 1)

        return {
            "provider_id": self._provider_id,
            "is_healthy": health_pct >= 80.0,
            "health_pct": health_pct,
            "success_rate_pct": health_pct,
            "avg_latency_ms": round(avg_lat, 1),
            "outage_active": False,
            "total_requests": self._total_requests
        }


class ProviderA(BaseMockProvider):
    """Provider A: Fast, reliable, low failure rate, strictly ordered events."""

    def __init__(self):
        super().__init__("PROVIDER_A")

    async def initiate_call(self, call_id: str, phone: str, webhook_cb: WebhookCallback) -> str:
        self._total_requests += 1
        start_time = time.time()

        if self._in_outage:
            self._failed_requests += 1
            raise ConnectionError(f"[{self.provider_id}] Outage active - connection timeout")

        # Fast setup latency (50 - 150ms)
        latency = random.uniform(0.05, 0.15)
        await asyncio.sleep(latency)
        self._latencies.append(latency * 1000)

        provider_call_id = f"provA_{uuid.uuid4().hex[:10]}"
        self._active_calls[call_id] = {"provider_call_id": provider_call_id, "active": True}

        # Spawn call progression in background task
        asyncio.create_task(self._simulate_call_lifecycle(call_id, provider_call_id, webhook_cb))
        return provider_call_id

    async def _simulate_call_lifecycle(self, call_id: str, provider_call_id: str, webhook_cb: WebhookCallback):
        try:
            # 1. INITIATED
            await webhook_cb({
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "call_id": call_id,
                "provider_id": self.provider_id,
                "provider_call_id": provider_call_id,
                "event_type": "INITIATED"
            })

            # 2. RINGING (0.2 - 0.4s)
            await asyncio.sleep(random.uniform(0.2, 0.4))
            await webhook_cb({
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "call_id": call_id,
                "provider_id": self.provider_id,
                "provider_call_id": provider_call_id,
                "event_type": "RINGING"
            })

            # Ringing duration (0.5 - 1.2s)
            await asyncio.sleep(random.uniform(0.5, 1.2))

            # Borrower answers or no answer
            answered = random.random() < self.simulated_answer_rate
            if answered:
                # 3. ANSWERED
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "ANSWERED"
                })

                # Simulated conversation duration (compacted for simulation demo: e.g. 3-8s)
                talk_dur = min(8.0, max(2.0, self.simulated_talk_time / 10.0))
                await asyncio.sleep(talk_dur)

                # 4. COMPLETED
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "COMPLETED",
                    "talk_time_sec": talk_dur * 10.0
                })
            else:
                # 3. FAILED (No answer / Busy)
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "FAILED",
                    "error_reason": "NO_ANSWER"
                })
        except Exception as e:
            logger.error(f"[{self.provider_id}] Lifecycle error for call {call_id}: {e}")
        finally:
            self._active_calls.pop(call_id, None)

    async def hangup(self, call_id: str) -> bool:
        if call_id in self._active_calls:
            self._active_calls[call_id]["active"] = False
            return True
        return False


class ProviderB(BaseMockProvider):
    """Provider B: Slower, occasional timeouts, duplicate events, out-of-order events."""

    def __init__(self):
        super().__init__("PROVIDER_B")
        self.duplicate_event_rate = 0.35 # 35% chance to duplicate an event
        self.out_of_order_rate = 0.25   # 25% chance to deliver out-of-order

    async def initiate_call(self, call_id: str, phone: str, webhook_cb: WebhookCallback) -> str:
        self._total_requests += 1

        if self._in_outage:
            self._failed_requests += 1
            raise ConnectionError(f"[{self.provider_id}] Provider outage active")

        # Slower latency (400 - 1200ms)
        latency = random.uniform(0.4, 1.2)
        await asyncio.sleep(latency)
        self._latencies.append(latency * 1000)

        # 10% chance of random network timeout failure
        if random.random() < 0.10:
            self._failed_requests += 1
            raise TimeoutError(f"[{self.provider_id}] Simulated gateway timeout during call initiation")

        provider_call_id = f"provB_{uuid.uuid4().hex[:10]}"
        self._active_calls[call_id] = {"provider_call_id": provider_call_id, "active": True}

        # Spawn chaos lifecycle
        asyncio.create_task(self._simulate_chaos_lifecycle(call_id, provider_call_id, webhook_cb))
        return provider_call_id

    async def _simulate_chaos_lifecycle(self, call_id: str, provider_call_id: str, webhook_cb: WebhookCallback):
        try:
            # INITIATED
            await webhook_cb({
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "call_id": call_id,
                "provider_id": self.provider_id,
                "provider_call_id": provider_call_id,
                "event_type": "INITIATED"
            })

            await asyncio.sleep(0.5)

            answered = random.random() < self.simulated_answer_rate

            # Check if this call will experience out-of-order delivery
            should_out_of_order = random.random() < self.out_of_order_rate

            if should_out_of_order and answered:
                # CHAOS: Send COMPLETED or ANSWERED BEFORE RINGING!
                logger.info(f"[{self.provider_id}] Injecting out-of-order events for call {call_id}!")
                
                # First send ANSWERED
                evt_ans = f"evt_{uuid.uuid4().hex[:8]}"
                await webhook_cb({
                    "event_id": evt_ans,
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "ANSWERED"
                })

                # Check if we should duplicate the ANSWERED event (per assignment: ANSWERED, ANSWERED, ANSWERED)
                if random.random() < self.duplicate_event_rate:
                    logger.info(f"[{self.provider_id}] Injecting duplicate ANSWERED event for call {call_id}")
                    # Send with same event_id (idempotency key test)
                    await webhook_cb({
                        "event_id": evt_ans,
                        "call_id": call_id,
                        "provider_id": self.provider_id,
                        "provider_call_id": provider_call_id,
                        "event_type": "ANSWERED"
                    })

                # Now send late RINGING after ANSWERED!
                await asyncio.sleep(0.2)
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "RINGING"
                })

                # Talk duration
                talk_dur = min(6.0, max(2.0, self.simulated_talk_time / 10.0))
                await asyncio.sleep(talk_dur)

                # Send COMPLETED
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "COMPLETED",
                    "talk_time_sec": talk_dur * 10.0
                })

                # Extra duplicate COMPLETED
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "COMPLETED",
                    "talk_time_sec": talk_dur * 10.0
                })
            else:
                # Standard lifecycle with possible duplicates
                await webhook_cb({
                    "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                    "call_id": call_id,
                    "provider_id": self.provider_id,
                    "provider_call_id": provider_call_id,
                    "event_type": "RINGING"
                })
                await asyncio.sleep(0.8)

                if answered:
                    ans_evt = f"evt_{uuid.uuid4().hex[:8]}"
                    await webhook_cb({
                        "event_id": ans_evt,
                        "call_id": call_id,
                        "provider_id": self.provider_id,
                        "provider_call_id": provider_call_id,
                        "event_type": "ANSWERED"
                    })

                    # Duplicate event simulation
                    if random.random() < self.duplicate_event_rate:
                        await webhook_cb({
                            "event_id": ans_evt,
                            "call_id": call_id,
                            "provider_id": self.provider_id,
                            "provider_call_id": provider_call_id,
                            "event_type": "ANSWERED"
                        })

                    talk_dur = min(6.0, max(2.0, self.simulated_talk_time / 10.0))
                    await asyncio.sleep(talk_dur)

                    await webhook_cb({
                        "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                        "call_id": call_id,
                        "provider_id": self.provider_id,
                        "provider_call_id": provider_call_id,
                        "event_type": "COMPLETED",
                        "talk_time_sec": talk_dur * 10.0
                    })
                else:
                    await webhook_cb({
                        "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                        "call_id": call_id,
                        "provider_id": self.provider_id,
                        "provider_call_id": provider_call_id,
                        "event_type": "FAILED",
                        "error_reason": "BUSY"
                    })
        except Exception as e:
            logger.error(f"[{self.provider_id}] Chaos lifecycle error for {call_id}: {e}")
        finally:
            self._active_calls.pop(call_id, None)

    async def hangup(self, call_id: str) -> bool:
        if call_id in self._active_calls:
            self._active_calls[call_id]["active"] = False
            return True
        return False
