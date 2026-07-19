// Shared read-aloud engine built on the Web Speech API's SpeechSynthesis
// (Baseline since 2018). Follows the TranslateEngine pattern: no React,
// per-call callbacks, all synthesis happens on-device when a local voice
// exists.

export type TSpeechVoice = {
	name: string;
	local: boolean; // true = synthesized on-device, false = network voice
};

export type TSpeakOptions = {
	text: string;
	lang?: string; // BCP 47, e.g. "es" or "es-ES"; omitted = detect from the text
	onVoice?: (voice: TSpeechVoice | null) => void; // which voice is speaking; re-fires on fallback
	onEnd?: () => void;
	onError?: (message: string) => void;
};

// Flatten markdown to something worth hearing: drop code blocks and syntax,
// keep link labels and the prose.
export function speakableText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/(\*\*|__)(.*?)\1/g, "$2")
		.replace(/(\*|_)([^*_\n]+)\1/g, "$2")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*>\s?/gm, "")
		.replace(/\|/g, " ")
		.trim();
}

// Known low-quality synthesizers: the macOS novelty voices plus the Eloquence
// set (Eddy, Flo, Grandma…) sound robotic; never pick them over alternatives.
const ROBOTIC_VOICE =
	/^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

const NATURAL_VOICE = /natural|neural|premium|enhanced|siri/i;

// Sentence-ish chunks for network voices, which Chrome silently cuts off
// after ~15s on a single utterance. Local voices speak the text in one go.
function splitChunks(text: string, max = 200): string[] {
	const sentences = text.match(/[^.!?…。！？]+[.!?…。！？]*\s*/g) ?? [text];
	const chunks: string[] = [];
	let current = "";
	for (const sentence of sentences) {
		if (current && current.length + sentence.length > max) {
			chunks.push(current);
			current = "";
		}
		current += sentence;
		while (current.length > max) {
			chunks.push(current.slice(0, max));
			current = current.slice(max);
		}
	}
	if (current.trim()) chunks.push(current);
	return chunks.length > 0 ? chunks : [text];
}

export class SpeechEngine {
	private voices: SpeechSynthesisVoice[] = [];
	private voicesReady: Promise<void> | null = null;
	// Chrome drops events on GC'd utterances, so hold the active ones.
	private active: SpeechSynthesisUtterance[] = [];
	private session = 0;
	private detector: LanguageDetector | null = null;

	static supported(): boolean {
		return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
	}

	// Chrome populates getVoices() asynchronously: wait for voiceschanged, with
	// a timeout fallback for engines that never fire it.
	private ensureVoices(): Promise<void> {
		if (this.voicesReady) return this.voicesReady;
		this.voicesReady = new Promise((resolve) => {
			this.voices = speechSynthesis.getVoices();
			if (this.voices.length > 0) return resolve();
			const finish = () => {
				clearTimeout(timer);
				this.voices = speechSynthesis.getVoices();
				resolve();
			};
			const timer = setTimeout(finish, 2000);
			speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
		});
		return this.voicesReady;
	}

	// Rank the voices matching the language and pick the most natural one,
	// network or not: Edge's "Online (Natural)" and Chrome's "Google" voices
	// beat the plain OS voices, and the remote-cutoff bug is handled by
	// chunking. localService only breaks ties. Some platforms report tags
	// with underscores ("es_ES"), so normalize first.
	private pickVoice(lang: string, localOnly = false): SpeechSynthesisVoice | null {
		const base = lang.split("-")[0];
		let best: SpeechSynthesisVoice | null = null;
		let bestScore = -Infinity;
		for (const voice of this.voices) {
			if (localOnly && !voice.localService) continue;
			const tag = voice.lang.replace("_", "-");
			if (tag !== lang && tag !== base && !tag.startsWith(`${base}-`)) continue;
			let score = tag === lang ? 2 : 1;
			if (NATURAL_VOICE.test(voice.name)) score += 8;
			if (!voice.localService && /^(Google|Microsoft)/i.test(voice.name)) score += 4;
			if (voice.localService) score += 1;
			if (voice.default) score += 1;
			if (ROBOTIC_VOICE.test(voice.name)) score -= 12;
			if (score > bestScore) {
				bestScore = score;
				best = voice;
			}
		}
		return best;
	}

	// When no language is given (e.g. chat replies), detect it on-device so
	// voice picking still works; fall back to the browser's own language.
	private async resolveLang(text: string, lang?: string): Promise<string> {
		if (lang) return lang;
		try {
			if (typeof LanguageDetector !== "undefined") {
				this.detector ??= await LanguageDetector.create();
				const [top] = await this.detector.detect(text);
				if (top?.detectedLanguage && top.detectedLanguage !== "und") return top.detectedLanguage;
			}
		} catch {
			/* fall through */
		}
		return typeof navigator !== "undefined" ? navigator.language : "en";
	}

	// Must be called from a user gesture: Chrome rejects speak() with
	// "not-allowed" before the page has ever been activated.
	async speak(options: TSpeakOptions): Promise<void> {
		if (!SpeechEngine.supported()) return;
		this.stop();
		const [lang] = await Promise.all([this.resolveLang(options.text, options.lang), this.ensureVoices()]);

		// Offline: network voices produce silence or errors, go straight local.
		const offline = typeof navigator !== "undefined" && navigator.onLine === false;
		const voice = this.pickVoice(lang, offline);
		options.onVoice?.(voice ? { name: voice.name, local: voice.localService } : null);
		this.start(options, lang, voice, false);
	}

	private start(options: TSpeakOptions, lang: string, voice: SpeechSynthesisVoice | null, isRetry: boolean): void {
		const { text, onVoice, onEnd, onError } = options;
		const session = ++this.session;
		this.active = [];
		const chunks = !voice || voice.localService ? [text] : splitChunks(text);

		chunks.forEach((chunk, i) => {
			const utterance = new SpeechSynthesisUtterance(chunk);
			utterance.lang = lang;
			if (voice) utterance.voice = voice;
			const last = i === chunks.length - 1;

			// Stale events (from a cancelled session) are dropped: stop() and a
			// newer speak() both bump this.session first.
			utterance.onend = () => {
				if (this.session !== session || !last) return;
				this.active = [];
				onEnd?.();
			};
			utterance.onerror = (event) => {
				if (this.session !== session) return;
				this.session++;
				this.active = [];
				speechSynthesis.cancel();
				if (event.error === "interrupted" || event.error === "canceled") {
					onEnd?.();
					return;
				}
				// A network voice failing (dropped connection, service error)
				// falls back to the best on-device voice once.
				if (!isRetry && voice && !voice.localService) {
					const local = this.pickVoice(lang, true);
					if (local) {
						onVoice?.({ name: local.name, local: true });
						this.start(options, lang, local, true);
						return;
					}
				}
				onError?.(
					event.error === "not-allowed"
						? "The browser blocked speech before any interaction. Click the page, then try again."
						: `Couldn't read this aloud (${event.error}).`,
				);
			};

			this.active.push(utterance);
			speechSynthesis.speak(utterance);
		});
	}

	stop(): void {
		if (!SpeechEngine.supported()) return;
		this.session++;
		this.active = [];
		speechSynthesis.cancel();
	}
}
