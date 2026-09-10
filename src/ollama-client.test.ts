import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	describeOllamaError,
	OllamaClient,
	OllamaError,
	type OllamaTransport,
	type OllamaTransportRequest,
} from "./ollama-client";

/**
 * OllamaClient tests — a fake transport stands in for requestUrl, so no
 * test ever touches the network. Every typed error class is exercised.
 */

const BASE = "http://localhost:11434";

function jsonResponse(body: unknown, status = 200) {
	return { status, text: JSON.stringify(body) };
}

/** Transport that records requests and routes them through `handler`. */
function fakeTransport(
	handler: (request: OllamaTransportRequest) => { status: number; text: string } | Promise<{ status: number; text: string }>,
): { transport: OllamaTransport; calls: OllamaTransportRequest[] } {
	const calls: OllamaTransportRequest[] = [];
	const transport: OllamaTransport = async (request) => {
		calls.push(request);
		return handler(request);
	};
	return { transport, calls };
}

function client(
	transport: OllamaTransport,
	timeoutMs = 5000,
	baseUrl = BASE,
): OllamaClient {
	return new OllamaClient({ baseUrl, timeoutMs, transport });
}

describe("OllamaClient.listModels", () => {
	it("GETs /api/tags and returns sorted model names", async () => {
		const { transport, calls } = fakeTransport(() =>
			jsonResponse({ models: [{ name: "llama3" }, { name: "mistral" }, { name: "phi3" }] }),
		);
		const models = await client(transport).listModels();
		expect(models).toEqual(["llama3", "mistral", "phi3"]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toBe(`${BASE}/api/tags`);
		expect(calls[0]?.body).toBeUndefined();
	});

	it("normalizes a trailing slash off the base URL", async () => {
		const { transport, calls } = fakeTransport(() => jsonResponse({ models: [] }));
		await client(transport, 5000, `${BASE}/`).listModels();
		expect(calls[0]?.url).toBe(`${BASE}/api/tags`);
	});

	it("skips entries without a name and tolerates an empty list", async () => {
		const { transport } = fakeTransport(() =>
			jsonResponse({ models: [{ name: "llama3" }, { size: 1 }, {}] }),
		);
		expect(await client(transport).listModels()).toEqual(["llama3"]);
	});

	it("throws a typed http error when the response has no model list", async () => {
		const { transport } = fakeTransport(() => jsonResponse({ unexpected: true }));
		await expect(client(transport).listModels()).rejects.toMatchObject({
			name: "OllamaError",
			kind: "http",
		});
	});
});

describe("OllamaClient.generate", () => {
	it("POSTs a non-streaming /api/generate request and returns data.response", async () => {
		const { transport, calls } = fakeTransport(() =>
			jsonResponse({ model: "llama3", response: "BRIEF TEXT", done: true }),
		);
		const result = await client(transport).generate({
			model: "llama3",
			prompt: "prepare a brief",
			temperature: 0.4,
		});
		expect(result).toBe("BRIEF TEXT");

		expect(calls).toHaveLength(1);
		const request = calls[0]!;
		expect(request.method).toBe("POST");
		expect(request.url).toBe(`${BASE}/api/generate`);
		expect(request.headers).toEqual({ "Content-Type": "application/json" });
		expect(JSON.parse(request.body!)).toEqual({
			model: "llama3",
			prompt: "prepare a brief",
			stream: false,
			options: { temperature: 0.4 },
		});
	});

	it("omits the options block when no temperature is given", async () => {
		const { transport, calls } = fakeTransport(() =>
			jsonResponse({ response: "ok" }),
		);
		await client(transport).generate({ model: "llama3", prompt: "p" });
		expect(JSON.parse(calls[0]!.body!)).toEqual({
			model: "llama3",
			prompt: "p",
			stream: false,
		});
	});

	it("throws a typed http error when the response has no response field", async () => {
		const { transport } = fakeTransport(() => jsonResponse({ done: true }));
		await expect(
			client(transport).generate({ model: "llama3", prompt: "p" }),
		).rejects.toMatchObject({ name: "OllamaError", kind: "http" });
	});
});

describe("OllamaClient typed errors", () => {
	/** Await a promise expected to reject, typed as OllamaError. */
	async function rejectionOf(promise: Promise<unknown>): Promise<OllamaError> {
		return (await promise.catch((caught: unknown) => caught)) as OllamaError;
	}

	it("maps a transport rejection to unreachable with actionable guidance", async () => {
		const { transport } = fakeTransport(() => {
			throw new Error("net::ERR_CONNECTION_REFUSED");
		});
		const error = await rejectionOf(client(transport).listModels());
		expect(error).toBeInstanceOf(OllamaError);
		expect(error.kind).toBe("unreachable");
		expect(error.message).toContain(BASE);
		expect(error.message).toContain("ollama serve");
		expect(error.message).toContain("ERR_CONNECTION_REFUSED");
	});

	it("times out when the transport hangs (Promise.race, real timers)", async () => {
		const { transport } = fakeTransport(() => new Promise(() => {}));
		const error = await rejectionOf(client(transport, 15).listModels());
		expect(error).toBeInstanceOf(OllamaError);
		expect(error.kind).toBe("timeout");
		expect(error.message).toContain("15 ms");
	});

	it("maps a non-2xx status to http with the status in the message", async () => {
		const { transport } = fakeTransport(() => ({
			status: 500,
			text: "internal server error",
		}));
		const error = await rejectionOf(
			client(transport).generate({ model: "llama3", prompt: "p" }),
		);
		expect(error.kind).toBe("http");
		expect(error.message).toContain("500");
		expect(error.message).toContain("internal server error");
	});

	it("maps Ollama's 404 model-not-found body to model-not-found with the model name", async () => {
		const { transport } = fakeTransport(() => ({
			status: 404,
			text: JSON.stringify({ error: "model 'llama3' not found, try pulling it first" }),
		}));
		const error = await rejectionOf(
			client(transport).generate({ model: "llama3", prompt: "p" }),
		);
		expect(error.kind).toBe("model-not-found");
		expect(error.message).toContain("llama3");
		expect(error.message).toContain("ollama pull llama3");
	});

	it("keeps a plain 404 (no model mention) as a generic http error", async () => {
		const { transport } = fakeTransport(() => ({ status: 404, text: "no such route" }));
		const error = await rejectionOf(client(transport).listModels());
		expect(error.kind).toBe("http");
	});

	it("maps a 200 with a non-JSON body to http", async () => {
		const { transport } = fakeTransport(() => ({ status: 200, text: "<html>hi</html>" }));
		const error = await rejectionOf(client(transport).listModels());
		expect(error.kind).toBe("http");
		expect(error.message).toContain("non-JSON");
	});

	it("describeOllamaError passes OllamaError messages through and wraps foreign errors", () => {
		expect(describeOllamaError(new OllamaError("timeout", "slow"))).toBe("slow");
		expect(describeOllamaError(new Error("boom"))).toBe("AI request failed: boom");
		expect(describeOllamaError("plain string")).toBe("AI request failed: plain string");
	});
});

describe("OllamaClient boundary", () => {
	it("never touches the vault — no vault/adapter API usage in the module", () => {
		const source = readFileSync(new URL("./ollama-client.ts", import.meta.url), "utf8");
		// Comments may mention the vault; code must not use it.
		expect(source).not.toMatch(/import\s+\{[^}]*\bVault\b[^}]*\}/);
		expect(source).not.toMatch(/\bvault\s*\./);
		expect(source).not.toMatch(/\bapp\.vault\b/);
		expect(source).not.toMatch(/\badapter\s*\./);
		expect(source).not.toMatch(/getAbstractFileByPath|getMarkdownFiles/);
	});
});
