import { useEffect, useRef, useState } from "react";
import { ChatAgent } from "../../../lib/chat/agent";
import type { TAvailability } from "../../../lib/chat/agent";
import { PRESETS, highlightJson, validate } from "../../../lib/playground";
import type { TIssue } from "../../../lib/playground";
import { Icon } from "../Icon";

type TCardStatus = "idle" | "running" | "done" | "error";

type TStructuredResult = {
	status: TCardStatus;
	raw?: string;
	parsed?: unknown;
	parseError?: boolean;
	issues?: TIssue[];
	latencyMs?: number;
	error?: string;
};

type TFreeformResult = {
	status: TCardStatus;
	raw?: string;
	latencyMs?: number;
	error?: string;
};

const CODE_PANEL =
	"scrollbar-thin overflow-x-auto rounded-xl bg-zinc-900 p-3.5 font-mono text-[0.8125rem]/6 text-zinc-100 ring-1 ring-white/10";

const SNIPPET = [
	'<span class="text-zinc-500">// Chrome 137+ · runs entirely on-device</span>',
	'<span class="text-zinc-400">const</span> session = <span class="text-zinc-400">await</span> LanguageModel.<span class="text-white">create</span>();',
	'<span class="text-zinc-400">const</span> result = <span class="text-zinc-400">await</span> session.<span class="text-white">prompt</span>(prompt, {',
	'  responseConstraint: { <span class="text-zinc-400">type</span>: <span class="text-white">"boolean"</span> },',
	"});",
	'<span class="text-zinc-400">const</span> data = <span class="text-white">JSON</span>.<span class="text-white">parse</span>(result); <span class="text-zinc-500">// &rarr; true</span>',
].join("\n");

const MODEL_STATUS: Record<TAvailability, { dot: string; text: string }> = {
	available: { dot: "bg-accent", text: "Ready · Gemini Nano" },
	downloadable: { dot: "bg-zinc-400", text: "Model ready to download" },
	downloading: { dot: "bg-zinc-400 animate-pulse", text: "Downloading model…" },
	unavailable: { dot: "bg-zinc-300 dark:bg-zinc-600", text: "Unavailable in this browser" },
};

// Monochrome status badges: a filled accent pill marks success; everything
// else stays muted zinc, with the icon and label carrying the meaning.
function Badge({ tone, icon, label }: { tone: "ok" | "warn" | "err" | "muted"; icon?: string; label: string }) {
	const map = {
		ok: "bg-accent text-accent-fg ring-accent",
		warn: "bg-zinc-950/5 text-zinc-700 ring-zinc-950/10 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/10",
		err: "bg-zinc-950/5 text-zinc-700 ring-zinc-950/10 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/10",
		muted: "bg-zinc-100 text-zinc-500 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10",
	} as const;
	const padding = icon ? "py-0.5 pr-2.5 pl-1.5" : "px-2.5 py-0.5";
	return (
		<span className={`inline-flex items-center gap-1 rounded-full ${padding} text-xs font-medium ring-1 ring-inset ${map[tone]}`}>
			{icon && <Icon name={icon} className="size-3.5" />}
			{label}
		</span>
	);
}

function Spinner({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 py-6 text-sm text-zinc-400 dark:text-zinc-500">
			<span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-accent dark:border-zinc-600"></span>
			{label}
		</div>
	);
}

function ErrorPanel({ message }: { message: string }) {
	return (
		<div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
			{message}
		</div>
	);
}

export default function PlaygroundApp() {
	const [availability, setAvailability] = useState<TAvailability | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);

	const [activePreset, setActivePreset] = useState(PRESETS[0].id);
	const [instruction, setInstruction] = useState(PRESETS[0].instruction);
	const [inputText, setInputText] = useState(PRESETS[0].input);
	const [schemaText, setSchemaText] = useState(JSON.stringify(PRESETS[0].schema, null, 2));
	const [schemaError, setSchemaError] = useState("");

	const [running, setRunning] = useState(false);
	const [tab, setTab] = useState<"parsed" | "raw">("parsed");
	const [structured, setStructured] = useState<TStructuredResult>({ status: "idle" });
	const [freeform, setFreeform] = useState<TFreeformResult>({ status: "idle" });
	const [freeformStream, setFreeformStream] = useState("");

	const abortRef = useRef<AbortController | null>(null);
	const runningRef = useRef(false);

	// The playground shares the chat's agent: same download/availability
	// handling, same streaming core — it just drives the one-shot primitives
	// instead of the conversation loop.
	const agentRef = useRef<ChatAgent | null>(null);
	if (!agentRef.current) {
		agentRef.current = new ChatAgent({
			settings: () => ({ systemPrompt: "", temperature: 1, topK: 3 }),
			hooks: {
				onAvailabilityChange: (availability) => setAvailability(availability),
				onDownloadStart: () => {
					setDownloadProgress(0);
					setDownloading(true);
				},
				onDownloadProgress: (fraction) => setDownloadProgress(Math.max(0, Math.min(1, fraction))),
				onDownloadEnd: () => setDownloading(false),
			},
		});
	}
	const agent = agentRef.current;

	useEffect(() => {
		void agent.boot();
	}, [agent]);

	const applyPreset = (id: string) => {
		const preset = PRESETS.find((p) => p.id === id);
		if (!preset) return;
		setActivePreset(id);
		setInstruction(preset.instruction);
		setInputText(preset.input);
		setSchemaText(JSON.stringify(preset.schema, null, 2));
		setSchemaError("");
	};

	const tryParseSchema = (): { schema: Record<string, unknown> | null; error?: string } => {
		const raw = schemaText.trim();
		if (!raw) return { schema: null };
		try {
			const parsed = JSON.parse(raw);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error('Schema must be a JSON object (or `{ "type": "boolean" }`).');
			}
			return { schema: parsed as Record<string, unknown> };
		} catch (e) {
			return { schema: null, error: (e as Error).message };
		}
	};

	const buildPrompt = () => [instruction.trim(), inputText.trim()].filter(Boolean).join("\n\n");

	const runStructured = async () => {
		if (runningRef.current) {
			abortRef.current?.abort();
			return;
		}
		const { schema, error } = tryParseSchema();
		setSchemaError(error ?? "");
		if (error) return;

		runningRef.current = true;
		setRunning(true);
		setStructured({ status: "running" });

		abortRef.current = new AbortController();
		let result: TStructuredResult = { status: "idle" };
		for await (const event of agent.streamObject({
			prompt: buildPrompt(),
			schema: schema ?? undefined,
			signal: abortRef.current.signal,
		})) {
			switch (event.type) {
				case "chunk":
					break;
				case "done": {
					const parseError = event.parseError !== undefined;
					const issues = parseError || !schema ? [] : validate(schema, event.object);
					result = {
						status: "done",
						raw: event.raw,
						parsed: event.object,
						parseError,
						error: event.parseError,
						issues,
						latencyMs: event.latencyMs,
					};
					break;
				}
				case "aborted":
					result = { status: "idle" };
					break;
				case "error":
					result = { status: "error", error: event.message };
					break;
			}
		}
		abortRef.current = null;
		runningRef.current = false;
		setRunning(false);
		setStructured(result);
	};

	const runFreeform = async () => {
		if (runningRef.current) return;
		runningRef.current = true;
		setRunning(true);
		setFreeform({ status: "running" });
		setFreeformStream("");

		abortRef.current = new AbortController();
		let result: TFreeformResult = { status: "idle" };
		for await (const event of agent.streamText({ prompt: buildPrompt(), signal: abortRef.current.signal })) {
			switch (event.type) {
				case "chunk":
					// Stream the free-form reply live as it generates.
					setFreeformStream(event.content);
					break;
				case "done":
					result = { status: "done", raw: event.content, latencyMs: event.latencyMs };
					break;
				case "aborted":
					result = { status: "idle" };
					break;
				case "error":
					result = { status: "error", error: event.message };
					break;
			}
		}
		abortRef.current = null;
		runningRef.current = false;
		setRunning(false);
		setFreeform(result);
	};

	const formatSchema = () => {
		const { schema, error } = tryParseSchema();
		if (error || !schema) {
			setSchemaError(error || "Nothing to format.");
			return;
		}
		setSchemaError("");
		setSchemaText(JSON.stringify(schema, null, 2));
	};

	const onPromptKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void runStructured();
		}
	};

	const status = availability ? MODEL_STATUS[availability] : { dot: "bg-zinc-400", text: "Checking model…" };
	const unavailable = availability === "unavailable";
	const blocked = unavailable;
	const downloadPct = Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100);

	const presetBtnClass = (active: boolean) => {
		const base = "relative rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors sm:text-sm";
		return active
			? `${base} bg-zinc-950/5 text-zinc-900 ring-zinc-950/15 dark:bg-white/10 dark:text-white dark:ring-white/20`
			: `${base} bg-white text-zinc-600 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white`;
	};

	const tabBtnClass = (active: boolean) =>
		active
			? "-mb-px border-b-2 px-1 pb-2 border-accent text-zinc-900 dark:text-white"
			: "-mb-px border-b-2 px-1 pb-2 border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200";

	return (
		<div className="min-h-dvh">
			<header className="sticky top-0 z-30 border-b border-zinc-950/5 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-zinc-950/80">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
					<a
						href="/"
						className="relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
					>
						<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
						<Icon name="arrow-left" className="size-4" />
						Chat
					</a>
					<span className="h-4 w-px bg-zinc-950/10 dark:bg-white/10" aria-hidden="true"></span>
					<span className="text-accent">
						<Icon name="sparkles" className="size-4" />
					</span>
					<span className="text-sm font-semibold tracking-tight">Structured Output</span>
					<div className="ml-auto flex items-center gap-2 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
						<span className={`size-2 shrink-0 rounded-full ${status.dot}`}></span>
						<span className="truncate">{status.text}</span>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
				<p className="font-mono text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
					Chrome Prompt API · Structured Output
				</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
					Force the model to reply with valid JSON
				</h1>
				<p className="mt-3 max-w-2xl text-base text-pretty text-zinc-600 sm:text-lg dark:text-zinc-400">
					Pass a{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://json-schema.org/"
						rel="noopener"
						target="_blank"
					>
						JSON Schema
					</a>{" "}
					to the Prompt API's{" "}
					<code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8125em] text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
						responseConstraint
					</code>{" "}
					option and the on-device model returns a string you can <em>parse</em> with confidence — no regex rescue
					required.
				</p>

				<section className="mt-8" aria-label="Preset examples">
					<h2 className="sr-only">Presets</h2>
					<div className="flex flex-wrap gap-2">
						{PRESETS.map((p) => (
							<button
								key={p.id}
								type="button"
								aria-pressed={p.id === activePreset}
								onClick={() => applyPreset(p.id)}
								className={presetBtnClass(p.id === activePreset)}
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								{p.label}
							</button>
						))}
					</div>
				</section>

				{unavailable && (
					<div className="mt-8">
						<div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5">
							<span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
								<Icon name="exclamation-triangle" className="size-5" />
							</span>
							<div>
								<p className="font-semibold text-zinc-900 dark:text-white">On-device AI isn't available here.</p>
								<p className="mt-1 text-pretty text-zinc-500 dark:text-zinc-400">
									Structured output needs Chrome 137+ with the built-in Prompt API enabled. Open this page in a recent
									Chrome desktop build on a supported device.
								</p>
							</div>
						</div>
					</div>
				)}

				<div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
					<section
						className="flex flex-col rounded-2xl border border-zinc-950/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"
						aria-label="Input"
					>
						<div className="flex items-center gap-2">
							<Icon name="code-bracket" className="size-4 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Input</h2>
						</div>

						<div className="mt-4">
							<label htmlFor="pg-instruction" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
								Instruction
							</label>
							<input
								id="pg-instruction"
								name="instruction"
								type="text"
								value={instruction}
								onChange={(e) => setInstruction(e.target.value)}
								onKeyDown={onPromptKeyDown}
								className="mt-1 w-full rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-950/10 focus:ring-2 focus:ring-accent/40 focus:outline-none sm:text-base dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10"
							/>
						</div>

						<div className="mt-4">
							<label htmlFor="pg-input" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
								Content to analyze
							</label>
							<textarea
								id="pg-input"
								name="input"
								rows={4}
								value={inputText}
								onChange={(e) => setInputText(e.target.value)}
								onKeyDown={onPromptKeyDown}
								className="scrollbar-thin mt-1 w-full resize-y rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-950/10 focus:ring-2 focus:ring-accent/40 focus:outline-none sm:text-base dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10"
							></textarea>
						</div>

						<div className="mt-4 flex items-center gap-2">
							<label htmlFor="pg-schema" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
								Response schema <span className="font-mono text-zinc-400 dark:text-zinc-500">(responseConstraint)</span>
							</label>
							<button
								type="button"
								onClick={formatSchema}
								className="relative ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								Format
							</button>
						</div>
						<textarea
							id="pg-schema"
							name="schema"
							rows={12}
							spellCheck={false}
							autoCapitalize="off"
							autoComplete="off"
							value={schemaText}
							onChange={(e) => {
								setSchemaText(e.target.value);
								setSchemaError("");
							}}
							className="scrollbar-thin mt-1 w-full resize-y rounded-xl bg-zinc-900 p-3.5 font-mono text-[0.8125rem]/6 text-zinc-100 ring-1 ring-white/10 focus:ring-2 focus:ring-accent/40 focus:outline-none"
						></textarea>
						<p className="mt-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">{schemaError}</p>
						<p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
							Edit the schema freely — the response is validated against it on the client.
						</p>
					</section>

					<section
						className="flex flex-col rounded-2xl border border-zinc-950/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"
						aria-label="Output"
					>
						<div className="flex items-center gap-2">
							<Icon name="sparkles" className="size-4 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Output</h2>
						</div>

						<div className="mt-4 flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() => void runStructured()}
								disabled={running ? false : blocked}
								className="relative inline-flex items-center gap-1.5 rounded-xl bg-accent py-2 pr-3 pl-2 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:shadow-none dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								<span className="flex">
									<Icon name={running ? "stop" : "play"} className="size-4" />
								</span>
								<span>{running ? "Stop" : "Run"}</span>
							</button>
							<button
								type="button"
								onClick={() => void runFreeform()}
								disabled={running || blocked}
								className="relative inline-flex items-center rounded-xl bg-white px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/10 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white"
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								Compare without constraint
							</button>
						</div>

						{downloading && (
							<div className="mt-4">
								<div className="flex items-center gap-3 rounded-xl border border-zinc-950/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
									<span className="text-accent">
										<Icon name="sparkles" className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-zinc-900 dark:text-white">Downloading the on-device model</p>
										<p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
											{downloadPct > 0 ? `${downloadPct}% downloaded` : "Starting download…"}
										</p>
										<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10">
											<div className="h-full rounded-full bg-accent transition-all" style={{ width: `${downloadPct}%` }}></div>
										</div>
									</div>
								</div>
							</div>
						)}

						<StructuredCard result={structured} tab={tab} onTab={setTab} tabBtnClass={tabBtnClass} />
						<FreeformCard result={freeform} streamingText={freeformStream} />
					</section>
				</div>

				<section className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="How it works">
					<div className="lg:col-span-1">
						<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">How it works</h2>
						<p className="mt-2 text-sm text-pretty text-zinc-600 dark:text-zinc-400">
							The Prompt API accepts a JSON Schema via{" "}
							<code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125em] text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
								responseConstraint
							</code>
							. The model then emits a string that conforms to it, so you can{" "}
							<code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125em] text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
								JSON.parse
							</code>{" "}
							the reply directly.
						</p>
					</div>
					<div className="lg:col-span-2">
						<pre
							className="scrollbar-thin overflow-x-auto rounded-xl bg-zinc-900 p-4 font-mono text-[0.8125rem]/6 text-zinc-100 ring-1 ring-white/10"
							dangerouslySetInnerHTML={{ __html: SNIPPET }}
						></pre>
					</div>
				</section>

				<p className="mt-10 text-center text-xs text-zinc-400 dark:text-zinc-500">
					Based on{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://web.dev/articles/structured-output-for-prompt-api"
						rel="noopener"
						target="_blank"
					>
						Structured output for the Prompt API
					</a>{" "}
					by Thomas Steiner.
				</p>
			</main>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Result cards
// ---------------------------------------------------------------------------

type TStructuredCardProps = {
	result: TStructuredResult;
	tab: "parsed" | "raw";
	onTab: (tab: "parsed" | "raw") => void;
	tabBtnClass: (active: boolean) => string;
};

function StructuredCard({ result: r, tab, onTab, tabBtnClass }: TStructuredCardProps) {
	const issues = r.issues ?? [];

	let badge: React.ReactNode;
	if (r.status === "idle") badge = <Badge tone="muted" label="Awaiting run" />;
	else if (r.status === "running") badge = <Badge tone="muted" label="Generating" />;
	else if (r.status === "error") badge = <Badge tone="err" icon="exclamation-triangle" label="Error" />;
	else if (r.parseError) badge = <Badge tone="err" icon="exclamation-triangle" label="Not valid JSON" />;
	else if (issues.length === 0) badge = <Badge tone="ok" icon="check" label="Valid · matches schema" />;
	else
		badge = (
			<Badge
				tone="warn"
				icon="exclamation-triangle"
				label={`${issues.length} schema violation${issues.length === 1 ? "" : "s"}`}
			/>
		);

	return (
		<div className="mt-4 rounded-xl border border-zinc-950/10 bg-zinc-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					{badge}
					<span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
						{r.status === "done" && r.latencyMs !== undefined ? `Done in ${r.latencyMs} ms` : ""}
					</span>
				</div>
				<span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">With responseConstraint</span>
			</div>

			{r.status === "idle" && (
				<p className="mt-3 py-6 text-sm text-zinc-400 dark:text-zinc-500">
					Pick a preset, edit the schema, then choose{" "}
					<span className="font-medium text-zinc-600 dark:text-zinc-300">Run</span> to constrain the model's reply.
				</p>
			)}
			{r.status === "running" && (
				<div className="mt-3">
					<Spinner label="Calling the on-device model…" />
				</div>
			)}
			{r.status === "error" && (
				<div className="mt-3">
					<ErrorPanel message={r.error || "Something went wrong."} />
				</div>
			)}

			{r.status === "done" && (
				<>
					<div className="mt-3 flex gap-4 border-b border-zinc-950/10 text-sm dark:border-white/10">
						<button type="button" aria-selected={tab === "parsed"} onClick={() => onTab("parsed")} className={tabBtnClass(tab === "parsed")}>
							Parsed
						</button>
						<button type="button" aria-selected={tab === "raw"} onClick={() => onTab("raw")} className={tabBtnClass(tab === "raw")}>
							Raw
						</button>
					</div>
					{tab === "parsed" && (
						<div className="mt-3">
							{r.parseError ? (
								<ErrorPanel message={r.error || "The response could not be parsed as JSON."} />
							) : (
								<>
									<pre className={CODE_PANEL} dangerouslySetInnerHTML={{ __html: highlightJson(r.parsed) }}></pre>
									{issues.length > 0 && (
										<ul className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400" role="list">
											{issues.map((issue, i) => (
												<li key={i} className="flex gap-2">
													<span className="font-mono text-zinc-400 dark:text-zinc-500">{issue.path}</span>
													<span>{issue.msg}</span>
												</li>
											))}
										</ul>
									)}
								</>
							)}
						</div>
					)}
					{tab === "raw" && (
						<div className="mt-3">
							<pre className={CODE_PANEL}>{r.raw || ""}</pre>
						</div>
					)}
				</>
			)}
		</div>
	);
}

function FreeformCard({ result: r, streamingText }: { result: TFreeformResult; streamingText: string }) {
	return (
		<div className="mt-4 rounded-xl border border-zinc-950/10 bg-zinc-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					{r.status === "running" ? <Badge tone="muted" label="Generating" /> : r.status === "error" ? (
						<Badge tone="err" icon="exclamation-triangle" label="Error" />
					) : (
						<Badge tone="muted" label="No constraint" />
					)}
					<span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
						{r.status === "done" && r.latencyMs !== undefined ? `Done in ${r.latencyMs} ms` : ""}
					</span>
				</div>
				<span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">No constraint</span>
			</div>

			<div className="mt-3">
				{r.status === "idle" && (
					<p className="py-6 text-sm text-zinc-400 dark:text-zinc-500">
						Run <span className="font-medium text-zinc-600 dark:text-zinc-300">Compare without constraint</span> to see
						the model's free-form reply — often chatty and hard to parse.
					</p>
				)}
				{r.status === "running" &&
					(streamingText ? (
						<pre className={`${CODE_PANEL} whitespace-pre-wrap`}>{streamingText}</pre>
					) : (
						<Spinner label="Calling the on-device model…" />
					))}
				{r.status === "error" && <ErrorPanel message={r.error || "Something went wrong."} />}
				{r.status === "done" && <pre className={`${CODE_PANEL} whitespace-pre-wrap`}>{r.raw || ""}</pre>}
			</div>
		</div>
	);
}
