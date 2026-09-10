import { requestUrl } from "obsidian";

/**
 * OllamaClient — the ONLY module in the plugin that talks to the AI server
 * (see .mex/context/ollama.md, boundary rules). It never reads the vault:
 * no vault/adapter imports, context is assembled elsewhere and passed in as
 * a prompt string.
 *
 * Transport: Obsidian's `requestUrl` rather than `fetch` — it runs outside
 * the renderer's CORS sandbox, so a locally running Ollama is reachable
 * without any server-side CORS headers (the fetch-vs-requestUrl question
 * from .mex/patterns/ollama-feature.md). Tests inject a fake transport.
 *
 * Endpoint choice: `/api/generate` (non-streaming) rather than `/api/chat`.
 * Our prompts are one-shot formatted strings with no multi-turn structure,
 * so the simpler endpoint wins; we read `data.response` from the
 * stream:false response.
 *
 * Every method goes through one shared timeout/error wrapper
 * (Promise.race — requestUrl has no abort support) so graceful degradation
 * is enforced in exactly one place. Errors are typed via `OllamaError.kind`
 * and every message is written to be shown in a Notice verbatim.
 */

/** One HTTP exchange — the slice of requestUrl's options this client needs. */
export interface OllamaTransportRequest {
	url: string;
	method: "GET" | "POST";
	body?: string;
	headers?: Record<string, string>;
	/** requestUrl never throws on HTTP error statuses itself; we interpret them. */
	throw?: false;
}

/** The slice of requestUrl's response this client reads. */
export interface OllamaTransportResponse {
	status: number;
	text: string;
}

/** Pluggable transport so tests never touch the network. */
export type OllamaTransport = (
	request: OllamaTransportRequest,
) => Promise<OllamaTransportResponse>;

export interface OllamaClientOptions {
	/** Server base URL, e.g. "http://localhost:11434". Trailing "/" tolerated. */
	baseUrl: string;
	/** Shared timeout for every request, in milliseconds. */
	timeoutMs: number;
	/** Defaults to Obsidian's requestUrl. */
	transport?: OllamaTransport;
}

export interface GenerateRequest {
	model: string;
	prompt: string;
	temperature?: number;
}

export type OllamaErrorKind =
	| "unreachable"
	| "timeout"
	| "http"
	| "model-not-found";

/** Every failure this client produces — check `.kind`, show `.message`. */
export class OllamaError extends Error {
	readonly kind: OllamaErrorKind;

	constructor(kind: OllamaErrorKind, message: string) {
		super(message);
		this.name = "OllamaError";
		this.kind = kind;
	}
}

/**
 * Turn any thrown value from an AI call into a Notice-ready string.
 * OllamaError messages already carry the actionable guidance; anything else
 * is wrapped so callers never have to special-case.
 */
export function describeOllamaError(error: unknown): string {
	if (error instanceof OllamaError) {
		return error.message;
	}
	if (error instanceof Error) {
		return `AI request failed: ${error.message}`;
	}
	return `AI request failed: ${String(error)}`;
}

/** Default transport: Obsidian's requestUrl (bypasses renderer CORS). */
async function requestUrlTransport(
	request: OllamaTransportRequest,
): Promise<OllamaTransportResponse> {
	const response = await requestUrl(request);
	return { status: response.status, text: response.text };
}

function unreachableError(url: string, cause: unknown): OllamaError {
	const detail = cause instanceof Error ? cause.message : String(cause);
	return new OllamaError(
		"unreachable",
		`Could not reach the Ollama server at ${url} — is it running? ` +
			`Start it with "ollama serve" and check the URL in TeamSync settings. (${detail})`,
	);
}

function timeoutError(url: string, timeoutMs: number): OllamaError {
	return new OllamaError(
		"timeout",
		`The Ollama server at ${url} did not respond within ${timeoutMs} ms. ` +
			"Try a longer timeout in TeamSync settings, or a smaller model.",
	);
}

function httpError(url: string, status: number, text: string): OllamaError {
	const snippet = text.slice(0, 200).trim();
	return new OllamaError(
		"http",
		`The Ollama server at ${url} returned HTTP ${status}` +
			(snippet === "" ? "." : `: ${snippet}`),
	);
}

function modelNotFoundError(url: string, model: string): OllamaError {
	return new OllamaError(
		"model-not-found",
		`Model "${model}" is not installed on the Ollama server at ${url}. ` +
			`Pull it with "ollama pull ${model}", or pick an installed model in TeamSync settings.`,
	);
}

export class OllamaClient {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly transport: OllamaTransport;

	constructor(options: OllamaClientOptions) {
		this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
		this.timeoutMs = options.timeoutMs;
		this.transport = options.transport ?? requestUrlTransport;
	}

	/** Installed model names from GET /api/tags, sorted. */
	async listModels(): Promise<string[]> {
		const data = (await this.jsonRequest("GET", "/api/tags")) as {
			models?: unknown;
		};
		if (!Array.isArray(data?.models)) {
			throw new OllamaError(
				"http",
				`Unexpected response from ${this.baseUrl}/api/tags — no model list. ` +
					"Is this really an Ollama server?",
			);
		}
		return data.models
			.map((model) => String((model as { name?: unknown }).name ?? ""))
			.filter((name) => name !== "")
			.sort();
	}

	/** One-shot generation via POST /api/generate (stream: false). */
	async generate(request: GenerateRequest): Promise<string> {
		const payload: Record<string, unknown> = {
			model: request.model,
			prompt: request.prompt,
			stream: false,
		};
		if (request.temperature !== undefined) {
			payload.options = { temperature: request.temperature };
		}
		const data = (await this.jsonRequest(
			"POST",
			"/api/generate",
			JSON.stringify(payload),
		)) as { response?: unknown };
		if (typeof data?.response !== "string") {
			throw new OllamaError(
				"http",
				`Unexpected response from ${this.baseUrl}/api/generate — no "response" field.`,
			);
		}
		return data.response;
	}

	/**
	 * Shared timeout/error wrapper: every request races a timer (requestUrl
	 * cannot be aborted) and every failure surfaces as a typed OllamaError.
	 */
	private async jsonRequest(
		method: "GET" | "POST",
		path: string,
		body?: string,
	): Promise<unknown> {
		const url = `${this.baseUrl}${path}`;
		const pending = this.transport({
			url,
			method,
			body,
			headers: body === undefined ? undefined : { "Content-Type": "application/json" },
			throw: false,
		}).then(
			(response) => this.interpretResponse(url, response, method),
			(cause: unknown) => {
				throw unreachableError(url, cause);
			},
		);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(timeoutError(url, this.timeoutMs)), this.timeoutMs);
		});
		try {
			return await Promise.race([pending, timeout]);
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
	}

	private interpretResponse(
		url: string,
		response: OllamaTransportResponse,
		method: "GET" | "POST",
	): unknown {
		if (response.status < 200 || response.status >= 300) {
			// Ollama reports a missing model as 404 with an "error" JSON body.
			if (
				response.status === 404 &&
				/model[^\n]{0,80}not found|not found[^\n]{0,80}model/i.test(response.text)
			) {
				const match = response.text.match(/model ['"]([^'"]+)['"]/i);
				throw modelNotFoundError(url, match?.[1] ?? "the configured model");
			}
			throw httpError(url, response.status, response.text);
		}
		try {
			return JSON.parse(response.text);
		} catch {
			throw new OllamaError(
				"http",
				`The Ollama server at ${url} returned a non-JSON response ` +
					`(${method} ${pathOf(url)}). Is this really an Ollama server?`,
			);
		}
	}
}

function pathOf(url: string): string {
	const index = url.indexOf("/", url.indexOf("://") + 3);
	return index === -1 ? "/" : url.slice(index);
}
