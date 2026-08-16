import { randomUUID } from "node:crypto";

const protocol = "pi-subagents.delegation.v1";
const requestEvent = "prompt-template:subagent:request";
const responseEvent = "prompt-template:subagent:response";
const cancelEvent = "prompt-template:subagent:cancel";

type EventBus = {
  on: (name: string, listener: (payload: unknown) => void) => (() => void);
  emit: (name: string, payload: unknown) => void;
};

type LaunchRequest = {
  requestId?: string;
  ownerRunId: string;
  nodeId: string;
  role: string;
  task: string;
  context: "fresh" | "fork";
  cwd: string;
  depth?: number;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  result?: { kind: "text" } | { kind: "structured"; schema: Record<string, unknown> };
};

type PendingAttempt = {
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
};

function eventBus(value: unknown): EventBus | null {
  const candidate = value && typeof value === "object" && "events" in value
    ? (value as { events?: unknown }).events
    : value;
  if (!candidate || typeof candidate !== "object") return null;
  const bus = candidate as Partial<EventBus>;
  return typeof bus.on === "function" && typeof bus.emit === "function" ? bus as EventBus : null;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Pi delegation requires ${field}`);
  return value;
}

export function createPiDelegationCapability(transport?: unknown) {
  const events = eventBus(transport);
  const attempts = new Map<string, PendingAttempt>();
  let disposed = false;
  const unsubscribe = events?.on(responseEvent, (payload) => {
    if (!payload || typeof payload !== "object") return;
    const response = payload as Record<string, unknown>;
    const requestId = response.requestId;
    if (typeof requestId !== "string") return;
    const attempt = attempts.get(requestId);
    if (!attempt) return;
    if (response.ownerRunId !== undefined
      && response.ownerRunId !== attempt.request.ownerRunId) return;
    if (response.nodeId !== undefined && response.nodeId !== attempt.request.nodeId) return;
    if (typeof response.status !== "string") return;
    attempt.response = Object.freeze({ ...response });
  });

  function unavailable() {
    return !events || disposed;
  }

  return Object.freeze({
    async probe() {
      if (unavailable()) return { available: false, protocol, reason: "optional_transport_unavailable" };
      return {
        available: true,
        protocol,
        transport: "pi-subagents/delegation",
        maxParallelImplementers: 2,
        maxSubagentDepth: 0
      };
    },
    async launch(input: Partial<LaunchRequest> = {}) {
      if ((input.depth ?? 0) !== 0) throw new Error("Pi delegation depth must remain zero");
      if (unavailable()) return { status: "inline_required", reason: "optional_transport_unavailable" };
      const active = [...attempts.values()].filter(({ response }) => response === null).length;
      if (active >= 2) throw new Error("Pi delegation permits at most two active owned leaves");
      const requestId = input.requestId || randomUUID();
      if (attempts.has(requestId)) throw new Error(`Pi delegation request ID is already used: ${requestId}`);
      const request = {
        requestId,
        ownerRunId: requiredText(input.ownerRunId, "ownerRunId"),
        nodeId: requiredText(input.nodeId, "nodeId"),
        agent: requiredText(input.role, "role"),
        task: requiredText(input.task, "task"),
        context: input.context === "fork" ? "fork" : "fresh",
        cwd: requiredText(input.cwd, "cwd"),
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinking ? { thinking: input.thinking } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        result: input.result || { kind: "text" }
      };
      attempts.set(requestId, { request, response: null });
      events.emit(requestEvent, request);
      return {
        status: "running",
        requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId
      };
    },
    async status(input: { requestId?: string } = {}) {
      if (unavailable()) return { status: "inline_required", reason: "optional_transport_unavailable" };
      const attempt = attempts.get(requiredText(input.requestId, "requestId"));
      if (!attempt) return { status: "unknown_request", requestId: input.requestId };
      return attempt.response || { status: "running", requestId: input.requestId };
    },
    async cancel(input: { requestId?: string } = {}) {
      if (unavailable()) return { status: "inline_required", reason: "optional_transport_unavailable" };
      const requestId = requiredText(input.requestId, "requestId");
      const attempt = attempts.get(requestId);
      if (!attempt) return { status: "unknown_request", requestId };
      if (attempt.response) return attempt.response;
      const cancellation = {
        requestId,
        ownerRunId: attempt.request.ownerRunId,
        nodeId: attempt.request.nodeId
      };
      events.emit(cancelEvent, cancellation);
      return { status: "cancel_requested", ...cancellation };
    },
    async collect(input: { requestId?: string } = {}) {
      if (unavailable()) return { status: "inline_required", reason: "optional_transport_unavailable" };
      const requestId = requiredText(input.requestId, "requestId");
      const attempt = attempts.get(requestId);
      if (!attempt) return { status: "unknown_request", requestId };
      return attempt.response || { status: "pending", requestId };
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
    }
  });
}
