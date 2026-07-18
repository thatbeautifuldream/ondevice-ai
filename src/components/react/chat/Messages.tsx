import { memo, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { MarkdownOutput } from "../MarkdownOutput";
import type { TChatMessage, TToolUse } from "../../../lib/chat/types";
import { modelLabel } from "../../../lib/chat/models";
import { SpeechEngine, speakableText } from "../../../lib/speech";

// ---------------------------------------------------------------------------
// Tool activity
// ---------------------------------------------------------------------------

function toolArgSummary(use: TToolUse): string {
	const firstArg = Object.values(use.args).find((v) => typeof v === "string");
	return firstArg ?? JSON.stringify(use.args);
}

function ToolStatusIcon({ ok }: { ok?: boolean }) {
	if (ok === undefined) {
		return (
			<span className="shrink-0 animate-spin text-zinc-400 dark:text-zinc-500">
				<Icon name="arrow-path" className="size-3.5" />
			</span>
		);
	}
	return (
		<span className={`shrink-0 ${ok ? "text-accent" : "text-zinc-400 dark:text-zinc-500"}`}>
			<Icon name={ok ? "check" : "exclamation-triangle"} className="size-3.5" />
		</span>
	);
}

function ToolCalls({ tools }: { tools: TToolUse[] }) {
	return (
		<div className="mb-3 flex flex-col gap-1.5">
			{tools.map((use, i) => (
				<details key={i} className="group max-w-[72ch] rounded-lg bg-zinc-50 dark:bg-white/5">
					<summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-zinc-950/2.5 [&::-webkit-details-marker]:hidden dark:hover:bg-white/5">
						<ToolStatusIcon ok={use.ok} />
						<span className="shrink-0 font-medium text-zinc-900 dark:text-white">{use.tool}</span>
						<span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">{toolArgSummary(use)}</span>
						<svg
							viewBox="0 0 8 5"
							width="8"
							height="5"
							fill="none"
							className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180 dark:text-zinc-500"
						>
							<path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
						</svg>
					</summary>
					<div className="border-t border-zinc-950/5 px-3 py-2.5 dark:border-white/5">
						<dl className="flex flex-col gap-2.5">
							<div>
								<dt className="text-xs font-medium text-zinc-900 dark:text-white">Input</dt>
								<dd className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
									<code className="break-all font-mono">{JSON.stringify(use.args)}</code>
								</dd>
							</div>
							<div>
								<dt className="text-xs font-medium text-zinc-900 dark:text-white">Output</dt>
								<dd className="scrollbar-thin mt-1 max-h-48 overflow-y-auto text-xs whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
									{use.result ?? "Running…"}
								</dd>
							</div>
						</dl>
					</div>
				</details>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Message actions (copy / read aloud / regenerate)
// ---------------------------------------------------------------------------

// One engine for the whole thread. `owner` tracks which button is speaking so
// starting one message silences the other button's state, and an unmounting
// button only stops speech it owns.
const speech = new SpeechEngine();
type TSpeechOwner = { silence: () => void };
let owner: TSpeechOwner | null = null;

function SpeakButton({ text }: { text: string }) {
	const [speaking, setSpeaking] = useState(false);
	const ownerRef = useRef<TSpeechOwner | null>(null);

	// Stop speech this button started if it unmounts mid-read.
	useEffect(
		() => () => {
			if (ownerRef.current && owner === ownerRef.current) {
				speech.stop();
				owner = null;
			}
		},
		[],
	);

	const toggle = () => {
		if (speaking) {
			speech.stop();
			setSpeaking(false);
			owner = null;
			ownerRef.current = null;
			return;
		}
		owner?.silence();
		const me: TSpeechOwner = { silence: () => setSpeaking(false) };
		owner = me;
		ownerRef.current = me;
		setSpeaking(true);
		const clear = () => {
			setSpeaking(false);
			if (owner === me) owner = null;
		};
		void speech.speak({ text: speakableText(text), onEnd: clear, onError: clear });
	};

	return (
		<button
			type="button"
			onClick={toggle}
			className="relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
		>
			<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
			{speaking ? (
				<span className="flex items-center gap-1.5 text-accent">
					<Icon name="stop" />
					Stop
				</span>
			) : (
				<span className="flex items-center gap-1.5">
					<Icon name="speaker-wave" />
					Read aloud
				</span>
			)}
		</button>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			/* ignore */
		}
	};

	return (
		<button
			type="button"
			onClick={() => void copy()}
			className="relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
		>
			<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
			{copied ? (
				<span className="flex items-center gap-1.5 text-accent">
					<Icon name="check" />
					Copied
				</span>
			) : (
				<span className="flex items-center gap-1.5">
					<Icon name="clipboard" />
					Copy
				</span>
			)}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Single message row
// ---------------------------------------------------------------------------

// The chat store mutates message objects in place while streaming, so the memo
// comparator must snapshot scalar fields as props — comparing through `msg`
// would always see the same (already-mutated) object and skip re-renders.
type TMessageProps = {
	role: TChatMessage["role"];
	content: string;
	streaming?: boolean;
	error?: boolean;
	tools?: TToolUse[];
	model?: string;
	// Serialized snapshot of `tools` — the store mutates the array in place, so
	// the memo comparator needs a value frozen at render time.
	toolsKey: string;
	isLast: boolean;
	onRegenerate: () => void;
};

export const Message = memo(
	function Message({ role, content, streaming, error, tools, model, toolsKey: _toolsKey, isLast, onRegenerate }: TMessageProps) {
		const msg = { role, content, streaming, error };
		if (msg.role === "user") {
			return (
				<li className="flex justify-end">
					<div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-base text-zinc-900 dark:bg-white/10 dark:text-zinc-100">
						{msg.content}
					</div>
				</li>
			);
		}

		const showActions = !msg.error && !(msg.streaming && !msg.content);

		return (
			<li className="flex gap-3">
				<div className="mt-0.5 shrink-0 text-accent">
					<Icon name="sparkles" className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					{model && !msg.error && (
						<p className="mb-1.5 truncate text-xs font-medium text-zinc-400 dark:text-zinc-500">{modelLabel(model)}</p>
					)}
					{tools && tools.length > 0 && <ToolCalls tools={tools} />}
					{msg.error ? (
						<div className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
							<span className="mt-0.5 shrink-0">
								<Icon name="exclamation-triangle" />
							</span>
							<div>{msg.content || "Something went wrong."}</div>
						</div>
					) : msg.streaming && !msg.content ? (
						<span className="flex items-center gap-1 py-1.5">
							<span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500"></span>
							<span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500"></span>
							<span className="size-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"></span>
						</span>
					) : (
						<MarkdownOutput
							className="max-w-[72ch] text-base/7 text-zinc-700 dark:text-zinc-300"
							content={msg.content}
							animating={!!msg.streaming}
						/>
					)}
					{showActions && (
						<div className="mt-2 flex items-center gap-1">
							<CopyButton text={msg.content} />
							{!msg.streaming && SpeechEngine.supported() && <SpeakButton text={msg.content} />}
							{isLast && !msg.streaming && (
								<button
									type="button"
									onClick={onRegenerate}
									className="relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
								>
									<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
									<Icon name="arrow-path" />
									Regenerate
								</button>
							)}
						</div>
					)}
				</div>
			</li>
		);
	},
	(prev, next) =>
		prev.role === next.role &&
		prev.content === next.content &&
		prev.streaming === next.streaming &&
		prev.error === next.error &&
		prev.isLast === next.isLast &&
		prev.model === next.model &&
		prev.toolsKey === next.toolsKey,
);

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
	{ title: "Explain a concept", subtitle: "Explain quantum entanglement like I'm five", prompt: "Explain quantum entanglement like I'm five years old." },
	{ title: "Write something", subtitle: "A short poem about the autumn rain", prompt: "Write a short, evocative poem about the autumn rain." },
	{ title: "Brainstorm ideas", subtitle: "Names for a cozy neighborhood bookstore", prompt: "Brainstorm 10 names for a cozy neighborhood bookstore, with a one-line rationale each." },
	{ title: "Get advice", subtitle: "Tips for staying focused while remote", prompt: "Give me 5 practical tips for staying focused while working from home." },
];

export function EmptyState({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-10 sm:py-16">
			<div className="flex size-12 items-center justify-center text-accent">
				<Icon name="sparkles" className="size-7" />
			</div>
			<h1 className="mt-4 max-w-[40ch] text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
				Chat with on-device AI
			</h1>
			<p className="mt-2 max-w-[56ch] text-center text-pretty text-sm text-zinc-500 sm:text-base dark:text-zinc-400">
				Use the browser's built-in model or download an open one. Everything runs on your device and never leaves it.
			</p>

			<div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
				{SUGGESTIONS.map((s) => (
					<button
						key={s.title}
						type="button"
						onClick={() => onSuggestion(s.prompt)}
						className="group flex flex-col gap-1 rounded-xl bg-zinc-50 p-4 text-left transition-colors hover:bg-zinc-100 dark:bg-white/5 dark:hover:bg-white/10"
					>
						<span className="text-sm font-medium text-zinc-900 dark:text-white">{s.title}</span>
						<span className="text-sm text-zinc-500 dark:text-zinc-400">{s.subtitle}</span>
					</button>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Unavailable notice (Chrome flags setup)
// ---------------------------------------------------------------------------

const SETUP_STEPS = [
	{
		number: 1,
		title: "Enable the Prompt API for Gemini Nano",
		description: "Open this flag and set it to Enabled.",
		code: "chrome://flags/#prompt-api-for-gemini-nano",
	},
	{
		number: 2,
		title: "Enable the on-device model",
		description: "Open this flag and set it to Enabled BypassPrefRequirement.",
		code: "chrome://flags/#optimization-guide-on-device-model",
	},
];

export function UnavailableNotice() {
	return (
		<div className="mx-auto w-full max-w-lg px-4 py-16">
			<div className="flex flex-col items-center text-center">
				<div className="flex size-12 items-center justify-center text-zinc-400 dark:text-zinc-500">
					<Icon name="exclamation-triangle" className="size-7" />
				</div>
				<h2 className="mt-4 text-lg font-semibold tracking-tight text-balance">Enable on-device AI in Chrome</h2>
				<p className="mt-2 text-sm text-pretty text-zinc-500 dark:text-zinc-400">
					This app needs Chrome's built-in Prompt API and Gemini Nano model. Follow these steps to turn on the
					necessary experimental flags.
				</p>
			</div>

			<ol className="mt-8 flex flex-col gap-3" role="list">
				{SETUP_STEPS.map((step) => (
					<li key={step.number} className="rounded-xl bg-zinc-50 p-4 dark:bg-white/5">
						<div className="flex gap-3">
							<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-950/10 text-xs font-semibold text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
								{step.number}
							</span>
							<div className="min-w-0 flex flex-1 flex-col gap-1.5">
								<p className="text-sm font-medium text-zinc-900 dark:text-white">{step.title}</p>
								<p className="text-sm text-pretty text-zinc-500 dark:text-zinc-400">{step.description}</p>
								<div className="rounded-lg bg-white px-3 py-2 text-sm dark:bg-zinc-950/50">
									<code className="block break-all font-mono text-zinc-600 dark:text-zinc-300">{step.code}</code>
								</div>
							</div>
						</div>
					</li>
				))}

				<li className="rounded-xl bg-zinc-50 p-4 dark:bg-white/5">
					<div className="flex gap-3">
						<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-950/10 text-xs font-semibold text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
							3
						</span>
						<div className="min-w-0 flex flex-1 flex-col gap-1.5">
							<p className="text-sm font-medium text-zinc-900 dark:text-white">Download the model</p>
							<p className="text-sm text-pretty text-zinc-500 dark:text-zinc-400">
								Open <span className="font-medium text-zinc-700 dark:text-zinc-300">chrome://components</span> and
								click <span className="font-medium text-zinc-700 dark:text-zinc-300">Check for Update</span> on
								Optimization Guide On Device Model.
							</p>
							<p className="text-sm text-pretty text-zinc-500 dark:text-zinc-400">
								If you don't see Optimization Guide, ensure the flags above are set correctly. If it's still
								missing, run this in your browser console, then refresh the page.
							</p>
							<div className="rounded-lg bg-white px-3 py-2 text-sm dark:bg-zinc-950/50">
								<code className="block break-all font-mono text-zinc-600 dark:text-zinc-300">
									await LanguageModel.create();
								</code>
							</div>
						</div>
					</div>
				</li>
			</ol>

			<p className="mt-6 text-center text-xs text-pretty text-zinc-400 dark:text-zinc-500">
				Once the flags are enabled, reload this page to start chatting.
			</p>
		</div>
	);
}
