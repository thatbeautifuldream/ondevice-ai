import { useEffect, useRef, useState } from "react";
import { TARGET_LANGUAGES, TranslateEngine, languageName } from "../../../lib/translate";
import type { TDetection } from "../../../lib/translate";
import { SpeechEngine } from "../../../lib/speech";
import type { TSpeechVoice } from "../../../lib/speech";
import { Icon } from "../Icon";
import { MarkdownOutput } from "../MarkdownOutput";

type TRunStatus = "idle" | "detecting" | "translating" | "done" | "error";

// Why the translation isn't running, when it isn't.
type TBlocker = "none" | "undetected" | "same-language" | "needs-download" | "unsupported-pair";

type TSample = {
	id: string;
	label: string;
	text: string;
};

const SAMPLES: TSample[] = [
	{
		id: "es",
		label: "Español",
		text: "El pulpo tiene tres corazones y su sangre es azul. Dos corazones bombean sangre a las branquias y el tercero al resto del cuerpo.",
	},
	{
		id: "fr",
		label: "Français",
		text: "La Tour Eiffel grandit d'environ quinze centimètres en été, car la chaleur dilate le fer dont elle est faite.",
	},
	{
		id: "de",
		label: "Deutsch",
		text: "Die Deutsche Bahn entschuldigt sich für die Verspätung. Der Zug nach Berlin fährt heute ausnahmsweise pünktlich ab.",
	},
	{
		id: "ja",
		label: "日本語",
		text: "桜の花は一週間ほどで散ってしまいますが、その儚さこそが美しさの理由だと言われています。",
	},
	{
		id: "en",
		label: "English",
		text: "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over three thousand years old and still perfectly edible.",
	},
];

const DEBOUNCE_MS = 400;

const SNIPPET = [
	"```js",
	"// Chrome 138+ · both APIs are stable, no flags needed",
	"const [{ detectedLanguage }] = await detector.detect(text);",
	"const translator = await Translator.create({",
	'  sourceLanguage: detectedLanguage, // e.g. "es"',
	'  targetLanguage: "en",',
	"});",
	"for await (const chunk of translator.translateStreaming(text)) {",
	"  output += chunk;",
	"}",
	"```",
].join("\n");

export default function TranslateApp() {
	const [supported, setSupported] = useState<boolean | null>(null);
	const [inputText, setInputText] = useState("");
	const [targetLang, setTargetLang] = useState("en");
	const [detection, setDetection] = useState<TDetection | null>(null);
	const [status, setStatus] = useState<TRunStatus>("idle");
	const [blocker, setBlocker] = useState<TBlocker>("none");
	const [output, setOutput] = useState("");
	const [error, setError] = useState("");
	const [latencyMs, setLatencyMs] = useState<number | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [copied, setCopied] = useState(false);
	const [speechSupported, setSpeechSupported] = useState(false);
	const [speaking, setSpeaking] = useState<"source" | "output" | null>(null);
	const [speechVoice, setSpeechVoice] = useState<TSpeechVoice | null>(null);

	const runIdRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const engineRef = useRef<TranslateEngine | null>(null);
	if (!engineRef.current) {
		engineRef.current = new TranslateEngine({
			onDownloadStart: () => {
				setDownloadProgress(0);
				setDownloading(true);
			},
			onDownloadProgress: (fraction) => setDownloadProgress(Math.max(0, Math.min(1, fraction))),
			onDownloadEnd: () => setDownloading(false),
		});
	}
	const engine = engineRef.current;

	const speechRef = useRef<SpeechEngine | null>(null);
	if (!speechRef.current) speechRef.current = new SpeechEngine();
	const speech = speechRef.current;

	useEffect(() => {
		setSupported(TranslateEngine.supported());
		setSpeechSupported(SpeechEngine.supported());
		// Default to translating into the user's own language, unless that's
		// English already — then Spanish makes the demo more interesting.
		const base = navigator.language.split("-")[0];
		if (base && base !== "en" && TARGET_LANGUAGES.some((l) => l === base)) setTargetLang(base);
		return () => {
			engine.destroy();
			speech.stop();
		};
	}, [engine, speech]);

	// The core loop: detect the source language, then stream the translation.
	// Every (text, target) change starts a fresh run and cancels the previous
	// one; stale runs check their id before touching state.
	const runTranslation = async (text: string, target: string) => {
		const runId = ++runIdRef.current;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const fresh = () => runIdRef.current === runId;

		const trimmed = text.trim();
		if (!trimmed) {
			setDetection(null);
			setOutput("");
			setError("");
			setBlocker("none");
			setStatus("idle");
			setLatencyMs(null);
			return;
		}

		setStatus("detecting");
		const detected = await engine.detect(trimmed);
		if (!fresh()) return;
		setDetection(detected);

		if (!detected.language) {
			setOutput("");
			setBlocker("undetected");
			setStatus("idle");
			return;
		}
		if (detected.language === target || detected.language.split("-")[0] === target.split("-")[0]) {
			setOutput("");
			setBlocker("same-language");
			setStatus("idle");
			return;
		}

		const availability = await engine.pairAvailability(detected.language, target);
		if (!fresh()) return;
		if (availability === "unavailable") {
			setOutput("");
			setBlocker("unsupported-pair");
			setStatus("idle");
			return;
		}
		// Downloads need a user gesture; surface a button instead of auto-fetching.
		if (availability === "downloadable") {
			setOutput("");
			setBlocker("needs-download");
			setStatus("idle");
			return;
		}

		setBlocker("none");
		setStatus("translating");
		setError("");
		for await (const event of engine.translateStream({
			text: trimmed,
			sourceLanguage: detected.language,
			targetLanguage: target,
			signal: controller.signal,
		})) {
			if (!fresh()) return;
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
					break;
				case "error":
					setError(event.message);
					setStatus("error");
					break;
			}
		}
	};

	const scheduleRun = (text: string, target: string) => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => void runTranslation(text, target), DEBOUNCE_MS);
	};

	const onInputChange = (text: string) => {
		setInputText(text);
		setCopied(false);
		scheduleRun(text, targetLang);
	};

	const onTargetChange = (target: string) => {
		setTargetLang(target);
		setCopied(false);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		void runTranslation(inputText, target);
	};

	const applySample = (sample: TSample) => {
		setInputText(sample.text);
		setCopied(false);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		void runTranslation(sample.text, targetLang);
	};

	// Download the language pack from a click (user gesture), then translate.
	const downloadPack = async () => {
		if (!detection?.language) return;
		const source = detection.language;
		try {
			await engine.ensureTranslator(source, targetLang);
		} catch (e) {
			setError((e as Error).message || "Couldn't download the language pack.");
			setStatus("error");
			return;
		}
		void runTranslation(inputText, targetLang);
	};

	const swap = () => {
		if (!detection?.language || !output) return;
		const newTarget = detection.language;
		setInputText(output);
		setTargetLang(newTarget);
		setCopied(false);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		void runTranslation(output, newTarget);
	};

	const copyOutput = async () => {
		if (!output) return;
		try {
			await navigator.clipboard.writeText(output);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	};

	// speak() needs a user gesture, so this only ever runs from a click.
	const toggleSpeak = (which: "source" | "output") => {
		if (speaking === which) {
			speech.stop();
			setSpeaking(null);
			setSpeechVoice(null);
			return;
		}
		const text = which === "source" ? inputText.trim() : output;
		const lang = which === "source" ? detection?.language : targetLang;
		if (!text || !lang) return;
		const clear = () => {
			setSpeaking((s) => (s === which ? null : s));
			setSpeechVoice(null);
		};
		setSpeaking(which);
		void speech.speak({ text, lang, onVoice: setSpeechVoice, onEnd: clear, onError: clear });
	};

	const readAloudLabel = speechVoice
		? speechVoice.local
			? "Reading aloud · on-device voice"
			: "Reading aloud · network voice, text leaves your device for speech only"
		: "Reading aloud…";

	const speakBtnClass = (active: boolean) =>
		`relative flex size-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
			active
				? "text-accent hover:bg-zinc-950/5 hover:text-accent-hover dark:hover:bg-white/10"
				: "text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
		}`;

	const downloadPct = Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100);
	const canSwap = Boolean(detection?.language && output && status === "done");

	// Target options: the curated list, plus the current target if a swap set
	// it to a language outside the list.
	const targetOptions: string[] = TARGET_LANGUAGES.some((l) => l === targetLang)
		? [...TARGET_LANGUAGES]
		: [targetLang, ...TARGET_LANGUAGES];

	const sampleBtnClass = (active: boolean) => {
		const base = "relative rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors sm:text-sm";
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
						<Icon name="language" className="size-4" />
					</span>
					<span className="min-w-0 truncate text-sm font-semibold tracking-tight">Translate</span>
					<div className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
						<span
							className={`size-2 shrink-0 rounded-full ${
								supported === null ? "bg-zinc-400" : supported ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-600"
							}`}
						></span>
						<span className="truncate sm:hidden">
							{supported === null ? "Checking…" : supported ? "Ready" : "Unavailable"}
						</span>
						<span className="hidden truncate sm:inline">
							{supported === null ? "Checking…" : supported ? "Ready · On-device translation" : "Unavailable in this browser"}
						</span>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
				<p className="font-mono text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
					Chrome Translator API · Language Detector API · Web Speech API
				</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
					Translate without leaving your device
				</h1>
				<p className="mt-3 max-w-2xl text-base text-pretty text-zinc-600 sm:text-lg dark:text-zinc-400">
					Start typing and the{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://developer.chrome.com/docs/ai/language-detection"
						rel="noopener"
						target="_blank"
					>
						Language Detector API
					</a>{" "}
					identifies the source language while the{" "}
					<a
						className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
						href="https://developer.chrome.com/docs/ai/translator-api"
						rel="noopener"
						target="_blank"
					>
						Translator API
					</a>{" "}
					streams the translation. Both are stable in Chrome 138+, and no text ever leaves your machine.
				</p>

				<section className="mt-8" aria-label="Sample texts">
					<h2 className="sr-only">Samples</h2>
					<div className="flex flex-wrap gap-2">
						{SAMPLES.map((s) => (
							<button
								key={s.id}
								type="button"
								aria-pressed={inputText === s.text}
								onClick={() => applySample(s)}
								className={sampleBtnClass(inputText === s.text)}
							>
								<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
								{s.label}
							</button>
						))}
					</div>
				</section>

				{supported === false && (
					<div className="mt-8">
						<div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5">
							<span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
								<Icon name="exclamation-triangle" className="size-5" />
							</span>
							<div>
								<p className="font-semibold text-zinc-900 dark:text-white">On-device translation isn't available here.</p>
								<p className="mt-1 text-pretty text-zinc-500 dark:text-zinc-400">
									The Translator and Language Detector APIs shipped in Chrome 138. Open this page in a recent Chrome
									desktop build to translate locally.
								</p>
							</div>
						</div>
					</div>
				)}

				<div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
					<section
						className="flex flex-col rounded-2xl border border-zinc-950/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"
						aria-label="Source text"
					>
						<div className="flex min-h-8 flex-wrap items-center gap-2">
							<Icon name="code-bracket" className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Source</h2>
							<span className="ml-auto text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
								{status === "detecting"
									? "Detecting language…"
									: detection?.language
										? `Detected: ${languageName(detection.language)}${
												detection.confidence > 0 ? ` · ${Math.round(detection.confidence * 100)}%` : ""
											}`
										: inputText.trim() && detection
											? "Language not recognized"
											: ""}
							</span>
							{speechSupported && (
								<button
									type="button"
									onClick={() => toggleSpeak("source")}
									disabled={!inputText.trim() || !detection?.language}
									aria-label={speaking === "source" ? "Stop reading" : "Read source text aloud"}
									className={speakBtnClass(speaking === "source")}
								>
									<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
									<Icon name={speaking === "source" ? "stop" : "speaker-wave"} className="size-4 shrink-0" />
								</button>
							)}
						</div>

						<label htmlFor="tr-input" className="sr-only">
							Text to translate
						</label>
						<textarea
							id="tr-input"
							name="input"
							rows={9}
							placeholder="Type or paste text in any language…"
							value={inputText}
							onChange={(e) => onInputChange(e.target.value)}
							disabled={supported === false}
							className="scrollbar-thin mt-3 w-full flex-1 resize-y rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-950/10 placeholder:text-zinc-400 focus:ring-2 focus:ring-accent/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-base dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10 dark:placeholder:text-zinc-500"
						></textarea>
						<p className="mt-1.5 text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
							{speaking === "source"
								? readAloudLabel
								: inputText.length > 0
									? `${inputText.length} characters`
									: "Translation runs automatically as you type."}
						</p>
					</section>

					<section
						className="flex flex-col rounded-2xl border border-zinc-950/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"
						aria-label="Translation"
					>
						<div className="flex min-h-8 flex-wrap items-center gap-2">
							<Icon name="language" className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
							<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Translation</h2>

							<div className="ml-auto flex items-center gap-1.5">
								<label htmlFor="tr-target" className="sr-only">
									Target language
								</label>
								<span className="inline-grid grid-cols-[1fr_--spacing(8)]">
									<select
										id="tr-target"
										name="target"
										value={targetLang}
										onChange={(e) => onTargetChange(e.target.value)}
										disabled={supported === false}
										className="col-span-full row-start-1 appearance-none rounded-lg bg-zinc-50 py-1.5 pr-8 pl-2.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/10 focus:ring-2 focus:ring-accent/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
									>
										{targetOptions.map((code) => (
											<option key={code} value={code}>
												{languageName(code)}
											</option>
										))}
									</select>
									<svg
										viewBox="0 0 8 5"
										width="8"
										height="5"
										fill="none"
										aria-hidden="true"
										className="pointer-events-none col-start-2 row-start-1 place-self-center text-zinc-500 dark:text-zinc-400"
									>
										<path d="M.5.5 4 4 7.5.5" stroke="currentcolor" />
									</svg>
								</span>
								{speechSupported && (
									<button
										type="button"
										onClick={() => toggleSpeak("output")}
										disabled={!output}
										aria-label={speaking === "output" ? "Stop reading" : "Read translation aloud"}
										className={speakBtnClass(speaking === "output")}
									>
										<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
										<Icon name={speaking === "output" ? "stop" : "speaker-wave"} className="size-4 shrink-0" />
									</button>
								)}
								<button
									type="button"
									onClick={swap}
									disabled={!canSwap}
									aria-label="Swap languages: translate the result back"
									className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
								>
									<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
									<Icon name="arrows-right-left" className="size-4 shrink-0" />
								</button>
								<button
									type="button"
									onClick={() => void copyOutput()}
									disabled={!output}
									aria-label="Copy translation"
									className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
								>
									<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
									<Icon name={copied ? "check" : "clipboard"} className="size-4 shrink-0" />
								</button>
							</div>
						</div>

						<div className="mt-3 flex-1">
							{downloading && (
								<div className="mb-3 flex items-center gap-3 rounded-xl border border-zinc-950/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
									<span className="shrink-0 text-accent">
										<Icon name="language" className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-zinc-900 dark:text-white">Downloading language pack</p>
										<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10">
											<div className="h-full rounded-full bg-accent transition-all" style={{ width: `${downloadPct}%` }}></div>
										</div>
									</div>
								</div>
							)}

							{blocker === "needs-download" && !downloading && detection?.language && (
								<div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-950/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
									<p className="min-w-0 flex-1 text-sm text-pretty text-zinc-600 dark:text-zinc-400">
										The {languageName(detection.language)} → {languageName(targetLang)} pack isn't downloaded yet. It's
										fetched once, then translation works offline.
									</p>
									<button
										type="button"
										onClick={() => void downloadPack()}
										className="relative inline-flex shrink-0 items-center rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/10 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white"
									>
										<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden" aria-hidden="true"></span>
										Download pack
									</button>
								</div>
							)}

							{blocker === "unsupported-pair" && detection?.language && (
								<p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
									{languageName(detection.language)} → {languageName(targetLang)} isn't a supported language pair on this
									device.
								</p>
							)}

							{blocker === "same-language" && (
								<p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
									The text already appears to be {languageName(targetLang)}. Pick a different target language.
								</p>
							)}

							{blocker === "undetected" && (
								<p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
									Couldn't recognize the language yet. Keep typing, detection improves with more text.
								</p>
							)}

							{status === "error" && (
								<p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
									{error}
								</p>
							)}

							{(status === "translating" || status === "done") && (
								<div className="scrollbar-thin max-h-[28rem] overflow-y-auto">
									<MarkdownOutput
										content={output}
										animating={status === "translating"}
										className="text-base/7 text-zinc-900 sm:text-lg/8 dark:text-zinc-100"
									/>
								</div>
							)}

							{status === "idle" && blocker === "none" && !downloading && (
								<p className="py-6 text-sm text-zinc-400 dark:text-zinc-500">
									The translation appears here, streamed as it's produced.
								</p>
							)}
						</div>

						<p className="mt-1.5 text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
							{speaking === "output" ? readAloudLabel : status === "translating" ? "Translating…" : status === "done" && latencyMs !== null ? `Done in ${latencyMs} ms` : " "}
						</p>
					</section>
				</div>

				<section className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="How it works">
					<div className="lg:col-span-1">
						<h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">How it works</h2>
						<p className="mt-2 text-sm text-pretty text-zinc-600 dark:text-zinc-400">
							The Language Detector API returns ranked candidates with confidence scores, and the Translator API
							downloads a small language pack per pair, then translates entirely on-device:{" "}
							<code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125em] text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
								translateStreaming
							</code>{" "}
							emits the result as it's produced.
						</p>
					</div>
					<div className="lg:col-span-2">
						<MarkdownOutput content={SNIPPET} className="text-[0.8125rem]" />
					</div>
				</section>

				<p className="mt-10 text-center text-xs text-zinc-400 dark:text-zinc-500">
					Built on the{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://developer.chrome.com/docs/ai/translator-api"
						rel="noopener"
						target="_blank"
					>
						Translator
					</a>{" "}
					and{" "}
					<a
						className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
						href="https://developer.chrome.com/docs/ai/language-detection"
						rel="noopener"
						target="_blank"
					>
						Language Detector
					</a>{" "}
					APIs, stable in Chrome 138+.
				</p>
			</main>
		</div>
	);
}
