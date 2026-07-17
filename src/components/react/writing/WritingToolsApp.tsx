import { useEffect, useRef, useState } from "react";
import {
	REWRITER_LENGTHS,
	REWRITER_TONES,
	WRITER_FORMATS,
	WRITER_LENGTHS,
	WRITER_TONES,
	WritingEngine,
	buildProofreadSegments,
	optionLabel,
} from "../../../lib/writing";
import type {
	TProofreadSegment,
	TRewriterOptions,
	TTool,
	TWriterOptions,
	TWritingAvailability,
} from "../../../lib/writing";
import { Icon } from "../Icon";
import { MarkdownOutput } from "../MarkdownOutput";

type TRunStatus = "idle" | "running" | "done" | "error";

const TOOLS: { id: TTool; label: string; icon: string }[] = [
	{ id: "write", label: "Write", icon: "pencil-square" },
	{ id: "rewrite", label: "Rewrite", icon: "arrow-path" },
	{ id: "proofread", label: "Proofread", icon: "check" },
];

const TOOL_FLAGS: Record<TTool, { flag: string; name: string }> = {
	write: { flag: "chrome://flags/#writer-api-for-gemini-nano", name: "Writer API" },
	rewrite: { flag: "chrome://flags/#rewriter-api-for-gemini-nano", name: "Rewriter API" },
	proofread: { flag: "chrome://flags/#proofreader-api", name: "Proofreader API" },
};

const SAMPLES = {
	writePrompt: "An email to my landlord asking to fix the kitchen tap that has been dripping for a week.",
	writeContext: "I'm a tenant at Flat 4B. Keep it friendly but firm; this is the second time I'm asking.",
	rewriteText:
		"Hey, so basically the meeting got moved again which is super annoying, but whatever. Can you just make sure the deck is done before Thursday? Thanks!!",
	rewriteContext: "A message to a colleague at work.",
	proofreadText:
		"I seen him yesterday at the store, and he buyed two loafs of bread. their going to make sandwichs for the picnic tomorow.",
};

const STATUS_META: Record<TWritingAvailability, { dot: string; text: string; short: string }> = {
	available: { dot: "bg-accent", text: "Ready · On-device", short: "Ready" },
	downloadable: { dot: "bg-zinc-400", text: "Model ready to download", short: "Downloadable" },
	downloading: { dot: "bg-zinc-400 animate-pulse", text: "Downloading model…", short: "Downloading…" },
	unavailable: { dot: "bg-zinc-300 dark:bg-zinc-600", text: "Unavailable · needs flag", short: "Unavailable" },
};

const SNIPPET = [
	'<span class="text-zinc-500">// Writer &amp; Rewriter: origin trial · Proofreader: origin trial / flag</span>',
	'<span class="text-zinc-400">const</span> writer = <span class="text-zinc-400">await</span> Writer.<span class="text-white">create</span>({ tone: <span class="text-white">"formal"</span>, length: <span class="text-white">"short"</span> });',
	'<span class="text-zinc-400">for await</span> (<span class="text-zinc-400">const</span> chunk <span class="text-zinc-400">of</span> writer.<span class="text-white">writeStreaming</span>(prompt)) { &hellip; }',
	"",
	'<span class="text-zinc-400">const</span> rewriter = <span class="text-zinc-400">await</span> Rewriter.<span class="text-white">create</span>({ tone: <span class="text-white">"more-casual"</span> });',
	'<span class="text-zinc-400">const</span> proofreader = <span class="text-zinc-400">await</span> Proofreader.<span class="text-white">create</span>();',
	'<span class="text-zinc-400">const</span> { correctedInput, corrections } = <span class="text-zinc-400">await</span> proofreader.<span class="text-white">proofread</span>(text);',
	'<span class="text-zinc-500">// corrections[i] &rarr; { startIndex, endIndex, correction, types }</span>',
].join("\n");

function Badge({ tone, icon, label }: { tone: "ok" | "warn" | "muted"; icon?: string; label: string }) {
	const map = {
		ok: "bg-accent text-accent-fg ring-accent",
		warn: "bg-zinc-950/5 text-zinc-700 ring-zinc-950/10 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/10",
		muted: "bg-zinc-100 text-zinc-500 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10",
	} as const;
	const padding = icon ? "py-0.5 pr-2.5 pl-1.5" : "px-2.5 py-0.5";
	return (
		<span className={`inline-flex items-center gap-1 rounded-full ${padding} text-xs font-medium ring-1 ring-inset ${map[tone]}`}>
			{icon && <Icon name={icon} className="size-3.5 shrink-0" />}
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

// Segmented pill control shared by all option rows.
function OptionRow({
	label,
	values,
	active,
	onChange,
	disabled,
}: {
	label: string;
	values: readonly string[];
	active: string;
	onChange: (value: string) => void;
	disabled?: boolean;
}) {
	return (
		<div className="mt-4">
			<p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
			<div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={label}>
				{values.map((value) => {
					const isActive = value === active;
					const base = "relative rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50";
					return (
						<button
							key={value}
							type="button"
							disabled={disabled}
							aria-pressed={isActive}
							onClick={() => onChange(value)}
							className={
								isActive
									? `${base} bg-zinc-950/5 text-zinc-900 ring-zinc-950/15 dark:bg-white/10 dark:text-white dark:ring-white/20`
									: `${base} bg-white text-zinc-600 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white`
							}
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
							{optionLabel(value)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

const FIELD_CLASS =
	"scrollbar-thin mt-1 w-full resize-y rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-950/10 placeholder:text-zinc-400 focus:ring-2 focus:ring-accent/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-base dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10 dark:placeholder:text-zinc-500";

export default function WritingToolsApp() {
	const [tool, setTool] = useState<TTool>("write");
	const [availability, setAvailability] = useState<Record<TTool, TWritingAvailability | null>>({
		write: null,
		rewrite: null,
		proofread: null,
	});

	const [writePrompt, setWritePrompt] = useState("");
	const [writeContext, setWriteContext] = useState("");
	const [writerOptions, setWriterOptions] = useState<TWriterOptions>({
		tone: "neutral",
		format: "plain-text",
		length: "medium",
	});
	const [rewriteText, setRewriteText] = useState("");
	const [rewriteContext, setRewriteContext] = useState("");
	const [rewriterOptions, setRewriterOptions] = useState<TRewriterOptions>({
		tone: "as-is",
		format: "as-is",
		length: "as-is",
	});
	const [proofreadText, setProofreadText] = useState("");

	const [status, setStatus] = useState<TRunStatus>("idle");
	const [output, setOutput] = useState("");
	const [segments, setSegments] = useState<TProofreadSegment[] | null>(null);
	const [correctedInput, setCorrectedInput] = useState("");
	const [error, setError] = useState("");
	const [latencyMs, setLatencyMs] = useState<number | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [copied, setCopied] = useState(false);

	const runningRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);

	const engineRef = useRef<WritingEngine | null>(null);
	if (!engineRef.current) {
		engineRef.current = new WritingEngine({
			onDownloadStart: () => {
				setDownloadProgress(0);
				setDownloading(true);
			},
			onDownloadProgress: (fraction) => setDownloadProgress(Math.max(0, Math.min(1, fraction))),
			onDownloadEnd: () => setDownloading(false),
		});
	}
	const engine = engineRef.current;

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const entries = await Promise.all(
				TOOLS.map(async ({ id }) => [id, await engine.availability(id)] as const),
			);
			if (!cancelled) {
				setAvailability({ write: null, rewrite: null, proofread: null, ...Object.fromEntries(entries) });
			}
		})();
		return () => {
			cancelled = true;
			engine.destroy();
		};
	}, [engine]);

	const resetResult = () => {
		setStatus("idle");
		setOutput("");
		setSegments(null);
		setCorrectedInput("");
		setError("");
		setLatencyMs(null);
		setCopied(false);
	};

	const switchTool = (next: TTool) => {
		if (next === tool) return;
		abortRef.current?.abort();
		setTool(next);
		resetResult();
	};

	const loadSample = () => {
		if (tool === "write") {
			setWritePrompt(SAMPLES.writePrompt);
			setWriteContext(SAMPLES.writeContext);
		} else if (tool === "rewrite") {
			setRewriteText(SAMPLES.rewriteText);
			setRewriteContext(SAMPLES.rewriteContext);
		} else {
			setProofreadText(SAMPLES.proofreadText);
		}
		resetResult();
	};

	const inputForTool = () => (tool === "write" ? writePrompt : tool === "rewrite" ? rewriteText : proofreadText);

	const run = async () => {
		if (runningRef.current) {
			abortRef.current?.abort();
			return;
		}
		const text = inputForTool().trim();
		if (!text) return;

		runningRef.current = true;
		abortRef.current = new AbortController();
		const signal = abortRef.current.signal;
		resetResult();
		setStatus("running");

		if (tool === "proofread") {
			const event = await engine.proofread({ text, signal });
			if (event.type === "done") {
				setSegments(buildProofreadSegments(text, event.result.corrections));
				setCorrectedInput(event.result.correctedInput);
				setLatencyMs(event.latencyMs);
				setStatus("done");
			} else if (event.type === "error") {
				setError(event.message);
				setStatus("error");
			} else {
				setStatus("idle");
			}
		} else {
			const stream =
				tool === "write"
					? engine.writeStream({ prompt: text, context: writeContext.trim(), options: writerOptions, signal })
					: engine.rewriteStream({ text, context: rewriteContext.trim(), options: rewriterOptions, signal });
			for await (const event of stream) {
				switch (event.type) {
					case "chunk":
						setOutput(event.content);
						break;
					case "done":
						setOutput(event.content);
						setLatencyMs(event.latencyMs);
						setStatus("done");
						break;
					case "aborted":
						setStatus("idle");
						break;
					case "error":
						setError(event.message);
						setStatus("error");
						break;
				}
			}
		}
		runningRef.current = false;
		abortRef.current = null;
	};

	const copyResult = async () => {
		const text = tool === "proofread" ? correctedInput : output;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void run();
		}
	};

	const toolAvailability = availability[tool];
	const meta = toolAvailability
		? STATUS_META[toolAvailability]
		: { dot: "bg-zinc-400", text: "Checking…", short: "Checking…" };
	const unavailable = toolAvailability === "unavailable";
	const running = status === "running";
	const downloadPct = Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100);
	const activeTool = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
	const correctionCount = segments?.filter((s) => s.kind === "correction").length ?? 0;
	const copyable = tool === "proofread" ? correctedInput : output;

	const toolBtnClass = (active: boolean) => {
		const base =
			"relative inline-flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-xs font-medium ring-1 transition-colors sm:text-sm";
		return active
			? `${base} bg-zinc-950/5 text-zinc-900 ring-zinc-950/15 dark:bg-white/10 dark:text-white dark:ring-white/20`
			: `${base} bg-white text-zinc-600 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white`;
	};

	return (
		<div className="min-h-dvh">
			<header className="sticky top-0 z-30 border-b border-zinc-950/5 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-zinc-950/80">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
					<a
						href="/"
						className="relative flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
					>
						<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
						<Icon name="arrow-left" className="size-4 shrink-0" />
						Chat
					</a>
					<span className="h-4 w-px shrink-0 bg-zinc-950/10 dark:bg-white/10" aria-hidden="true"></span>
					<span className="hidden shrink-0 text-accent sm:inline">
						<Icon name="pencil-square" className="size-4" />
					</span>
					<span className="min-w-0 truncate text-sm font-semibold tracking-tight">Writing Tools</span>
					<div className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
						<span className={`size-2 shrink-0 rounded-full ${meta.dot}`}></span>
						<span className="truncate sm:hidden">{meta.short}</span>
						<span className="hidden truncate sm:inline">
							{TOOL_FLAGS[tool].name} · {meta.text}
						</span>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
				<p className="font-mono text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
					Chrome Writer · Rewriter · Proofreader APIs
				</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
					Draft, rework, and proofread on-device
				</h1>
				<p className="mt-3 max-w-2xl text-base text-pretty text-zinc-600 sm:text-lg dark:text-zinc-400">
					Three writing-assistance APIs share Chrome's built-in model: the{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://developer.chrome.com/docs/ai/writer-api"
						rel="noopener"
						target="_blank"
					>
						Writer API
					</a>{" "}
					drafts new text with a tone and length,{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://developer.chrome.com/docs/ai/rewriter-api"
						rel="noopener"
						target="_blank"
					>
						Rewriter
					</a>{" "}
					reworks what you already have, and{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://developer.chrome.com/docs/ai/proofreader-api"
						rel="noopener"
						target="_blank"
					>
						Proofreader
					</a>{" "}
					returns indexed corrections you can highlight in place.
				</p>

				<section className="mt-8" aria-label="Tools">
					<h2 className="sr-only">Tools</h2>
					<div className="flex flex-wrap gap-2">
						{TOOLS.map((t) => (
							<button
								key={t.id}
								type="button"
								aria-pressed={t.id === tool}
								onClick={() => switchTool(t.id)}
								className={toolBtnClass(t.id === tool)}
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								<Icon name={t.icon} className="size-4 shrink-0" />
								{t.label}
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
							<div className="min-w-0">
								<p className="font-semibold text-zinc-900 dark:text-white">
									The {TOOL_FLAGS[tool].name} isn't available here.
								</p>
								<p className="mt-1 text-pretty text-zinc-500 dark:text-zinc-400">
									It's in origin trial, so it also needs a flag on localhost: enable{" "}
									<code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125em] break-all text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
										{TOOL_FLAGS[tool].flag}
									</code>{" "}
									in a recent Chrome desktop build, then relaunch.
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
							<Icon name={activeTool.icon} className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">{activeTool.label}</h2>
							<button
								type="button"
								onClick={loadSample}
								className="relative ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								Load example
							</button>
						</div>

						{tool === "write" && (
							<>
								<div className="mt-4 flex-1">
									<label htmlFor="wt-prompt" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
										What should it write?
									</label>
									<textarea
										id="wt-prompt"
										name="prompt"
										rows={5}
										placeholder="Describe the text you need…"
										value={writePrompt}
										onChange={(e) => setWritePrompt(e.target.value)}
										onKeyDown={onKeyDown}
										className={FIELD_CLASS}
									></textarea>
								</div>
								<div className="mt-4">
									<label htmlFor="wt-context" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
										Context <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
									</label>
									<input
										id="wt-context"
										name="context"
										type="text"
										placeholder="Background the model should know…"
										value={writeContext}
										onChange={(e) => setWriteContext(e.target.value)}
										onKeyDown={onKeyDown}
										className={FIELD_CLASS.replace(" resize-y", "")}
									/>
								</div>
								<OptionRow
									label="Tone"
									values={WRITER_TONES}
									active={writerOptions.tone}
									onChange={(tone) => setWriterOptions((o) => ({ ...o, tone: tone as TWriterOptions["tone"] }))}
									disabled={running}
								/>
								<OptionRow
									label="Length"
									values={WRITER_LENGTHS}
									active={writerOptions.length}
									onChange={(length) => setWriterOptions((o) => ({ ...o, length: length as TWriterOptions["length"] }))}
									disabled={running}
								/>
								<OptionRow
									label="Format"
									values={WRITER_FORMATS}
									active={writerOptions.format}
									onChange={(format) => setWriterOptions((o) => ({ ...o, format: format as TWriterOptions["format"] }))}
									disabled={running}
								/>
							</>
						)}

						{tool === "rewrite" && (
							<>
								<div className="mt-4 flex-1">
									<label htmlFor="wt-rewrite" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
										Text to rewrite
									</label>
									<textarea
										id="wt-rewrite"
										name="text"
										rows={5}
										placeholder="Paste the text to rework…"
										value={rewriteText}
										onChange={(e) => setRewriteText(e.target.value)}
										onKeyDown={onKeyDown}
										className={FIELD_CLASS}
									></textarea>
								</div>
								<div className="mt-4">
									<label htmlFor="wt-rewrite-context" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
										Context <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
									</label>
									<input
										id="wt-rewrite-context"
										name="context"
										type="text"
										placeholder="Where will this text be used?"
										value={rewriteContext}
										onChange={(e) => setRewriteContext(e.target.value)}
										onKeyDown={onKeyDown}
										className={FIELD_CLASS.replace(" resize-y", "")}
									/>
								</div>
								<OptionRow
									label="Tone"
									values={REWRITER_TONES}
									active={rewriterOptions.tone}
									onChange={(tone) => setRewriterOptions((o) => ({ ...o, tone: tone as TRewriterOptions["tone"] }))}
									disabled={running}
								/>
								<OptionRow
									label="Length"
									values={REWRITER_LENGTHS}
									active={rewriterOptions.length}
									onChange={(length) =>
										setRewriterOptions((o) => ({ ...o, length: length as TRewriterOptions["length"] }))
									}
									disabled={running}
								/>
							</>
						)}

						{tool === "proofread" && (
							<div className="mt-4 flex-1">
								<label htmlFor="wt-proofread" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
									Text to proofread
								</label>
								<textarea
									id="wt-proofread"
									name="text"
									rows={9}
									placeholder="Paste text with typos, grammar slips, or missing words…"
									value={proofreadText}
									onChange={(e) => setProofreadText(e.target.value)}
									onKeyDown={onKeyDown}
									className={FIELD_CLASS}
								></textarea>
							</div>
						)}

						<div className="mt-5 flex items-center gap-3">
							<button
								type="button"
								onClick={() => void run()}
								disabled={running ? false : unavailable || !inputForTool().trim()}
								className="relative inline-flex items-center gap-1.5 rounded-xl bg-accent py-2 pr-3 pl-2 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:shadow-none dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								<span className="flex">
									<Icon name={running ? "stop" : "play"} className="size-4" />
								</span>
								<span>{running ? "Stop" : activeTool.label}</span>
							</button>
							<p className="text-xs text-zinc-400 dark:text-zinc-500">
								<kbd className="font-sans">⌘</kbd>
								<kbd className="font-sans">↵</kbd> to run
							</p>
						</div>
					</section>

					<section
						className="flex flex-col rounded-2xl border border-zinc-950/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"
						aria-label="Result"
					>
						<div className="flex flex-wrap items-center gap-2">
							<Icon name="sparkles" className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Result</h2>
							<div className="ml-auto flex items-center gap-2">
								{status === "done" && latencyMs !== null && (
									<span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">Done in {latencyMs} ms</span>
								)}
								<button
									type="button"
									onClick={() => void copyResult()}
									disabled={!copyable}
									aria-label={tool === "proofread" ? "Copy corrected text" : "Copy result"}
									className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
								>
									<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
									<Icon name={copied ? "check" : "clipboard"} className="size-4 shrink-0" />
								</button>
							</div>
						</div>

						<div className="mt-4 flex-1">
							{downloading && (
								<div className="mb-3 flex items-center gap-3 rounded-xl border border-zinc-950/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
									<span className="shrink-0 text-accent">
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
							)}

							{status === "idle" && !downloading && (
								<p className="py-6 text-sm text-zinc-400 dark:text-zinc-500">
									{tool === "write" && "Describe what you need and the draft streams in here."}
									{tool === "rewrite" && "The reworked version of your text streams in here."}
									{tool === "proofread" && "Corrections appear here, highlighted in place."}
								</p>
							)}

							{status === "running" &&
								(tool !== "proofread" && output ? (
									<div className="scrollbar-thin max-h-[28rem] overflow-y-auto">
										<MarkdownOutput content={output} animating />
									</div>
								) : (
									<Spinner label={tool === "proofread" ? "Proofreading…" : "Calling the on-device model…"} />
								))}

							{status === "error" && (
								<p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
									{error}
								</p>
							)}

							{status === "done" && tool !== "proofread" && (
								<div className="scrollbar-thin max-h-[28rem] overflow-y-auto">
									<MarkdownOutput content={output} />
								</div>
							)}

							{status === "done" && tool === "proofread" && segments && (
								<div>
									<div className="mb-3">
										{correctionCount === 0 ? (
											<Badge tone="ok" icon="check" label="No issues found" />
										) : (
											<Badge
												tone="warn"
												icon="exclamation-triangle"
												label={`${correctionCount} correction${correctionCount === 1 ? "" : "s"}`}
											/>
										)}
									</div>
									<p className="scrollbar-thin max-h-72 overflow-y-auto rounded-xl bg-zinc-50 p-3.5 text-base/7 whitespace-pre-wrap text-zinc-900 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10">
										{segments.map((segment, i) =>
											segment.kind === "text" ? (
												<span key={i}>{segment.text}</span>
											) : (
												<span key={i}>
													<del className="rounded bg-zinc-950/5 px-0.5 text-zinc-400 dark:bg-white/10 dark:text-zinc-500">
														{segment.original}
													</del>{" "}
													<ins className="rounded bg-accent px-1 font-medium text-accent-fg no-underline">
														{segment.correction}
													</ins>
												</span>
											),
										)}
									</p>
									{correctionCount > 0 && (
										<ul className="mt-3 space-y-1.5" role="list">
											{segments
												.filter((s) => s.kind === "correction")
												.map((s, i) => (
													<li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
														<span className="text-zinc-400 line-through dark:text-zinc-500">{s.original}</span>
														<span className="font-medium text-zinc-900 dark:text-white">{s.correction}</span>
														{s.types.map((type) => (
															<span
																key={type}
																className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 ring-1 ring-zinc-950/10 ring-inset dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
															>
																{type}
															</span>
														))}
														{s.explanation && <span className="w-full text-xs text-zinc-400 dark:text-zinc-500">{s.explanation}</span>}
													</li>
												))}
										</ul>
									)}
								</div>
							)}
						</div>
					</section>
				</div>

				<section className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="How it works">
					<div className="lg:col-span-1">
						<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">How it works</h2>
						<p className="mt-2 text-sm text-pretty text-zinc-600 dark:text-zinc-400">
							Each tool wraps one API. Writer and Rewriter bake tone, length, and format into{" "}
							<code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125em] text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
								create()
							</code>{" "}
							and stream their output; Proofreader returns the corrected text plus index ranges for every fix, which is
							what powers the inline highlights.
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
					Built on the{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://developer.chrome.com/docs/ai/writer-api"
						rel="noopener"
						target="_blank"
					>
						Writer
					</a>
					,{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://developer.chrome.com/docs/ai/rewriter-api"
						rel="noopener"
						target="_blank"
					>
						Rewriter
					</a>
					, and{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://developer.chrome.com/docs/ai/proofreader-api"
						rel="noopener"
						target="_blank"
					>
						Proofreader
					</a>{" "}
					APIs, currently in origin trials.
				</p>
			</main>
		</div>
	);
}
