const protocol = "zimster.pi-delegation.v1";
const methods = ["probe", "launch", "status", "cancel", "collect"];

function supportsProtocol(transport: unknown): transport is Record<string, (...args: unknown[]) => unknown> {
  return Boolean(transport) && methods.every((method) => typeof (transport as Record<string, unknown>)[method] === "function");
}

export function createPiDelegationCapability(transport?: unknown) {
  const available = supportsProtocol(transport);
  return Object.freeze({
    async probe() {
      if (!available) return { available: false, protocol, reason: "optional_transport_unavailable" };
      return transport.probe({ protocol, maxParallelImplementers: 2, maxSubagentDepth: 0 });
    },
    async launch(request: { depth?: number } = {}) {
      if ((request.depth ?? 0) !== 0) throw new Error("Pi delegation depth must remain zero");
      if (!available) return { status: "inline_required", reason: "optional_transport_unavailable" };
      return transport.launch({ ...request, protocol, allowNestedSubagents: false, maxParallelImplementers: 2 });
    },
    async status(request: unknown) {
      if (!available) return { status: "inline_required", reason: "optional_transport_unavailable" };
      return transport.status(request);
    },
    async cancel(request: unknown) {
      if (!available) return { status: "inline_required", reason: "optional_transport_unavailable" };
      return transport.cancel(request);
    },
    async collect(request: unknown) {
      if (!available) return { status: "inline_required", reason: "optional_transport_unavailable" };
      return transport.collect(request);
    }
  });
}
