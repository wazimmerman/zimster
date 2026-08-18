const protocol = "zimster.pi-delegation.v1";
const methods = ["probe", "launch", "status", "cancel", "collect"];

function supportsProtocol(transport: unknown): transport is Record<string, (...args: unknown[]) => unknown> {
  return Boolean(transport) && methods.every((method) => typeof (transport as Record<string, unknown>)[method] === "function");
}

export function createPiDelegationCapability(transport?: unknown) {
  const available = supportsProtocol(transport);
  const unavailable = available ? "mechanical_parallelism_unenforced" : "optional_transport_unavailable";
  return Object.freeze({
    async probe() {
      return { available: false, protocol, reason: unavailable };
    },
    async launch(request: { depth?: number } = {}) {
      if ((request.depth ?? 0) !== 0) throw new Error("Pi delegation depth must remain zero");
      return { status: "inline_required", reason: unavailable };
    },
    async status(request: unknown) {
      return { status: "inline_required", reason: unavailable };
    },
    async cancel(request: unknown) {
      return { status: "inline_required", reason: unavailable };
    },
    async collect(request: unknown) {
      return { status: "inline_required", reason: unavailable };
    }
  });
}
