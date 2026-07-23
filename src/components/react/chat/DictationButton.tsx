import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { CheckIcon, ChevronDownIcon, MicIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../../lib/utils";
import {
	SPEECH_LANGUAGES,
	getDictationLanguage,
	setDictationLanguage,
} from "../../../lib/speechLanguages";

import { LiveWaveform } from "./LiveWaveform";

type TSpeechRecognition = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	spokenPunctuation?: boolean;
	unspokenPunctuation?: boolean;
	start(): void;
	stop(): void;
	abort?(): void;
	onstart: ((this: TSpeechRecognition, ev: Event) => unknown) | null;
	onend: ((this: TSpeechRecognition, ev: Event) => unknown) | null;
	onresult: ((this: TSpeechRecognition, ev: TSpeechRecognitionEvent) => unknown) | null;
	onerror: ((this: TSpeechRecognition, ev: TSpeechRecognitionErrorEvent) => unknown) | null;
} & EventTarget;

type TSpeechRecognitionEvent = {
	results: TSpeechRecognitionResultList;
} & Event;

type TSpeechRecognitionResultList = {
	readonly length: number;
	item(index: number): TSpeechRecognitionResult;
	[index: number]: TSpeechRecognitionResult;
};

type TSpeechRecognitionResult = {
	readonly length: number;
	item(index: number): TSpeechRecognitionAlternative;
	[index: number]: TSpeechRecognitionAlternative;
	isFinal: boolean;
};

type TSpeechRecognitionAlternative = {
	transcript: string;
	confidence: number;
};

type TSpeechRecognitionErrorEvent = {
	error: string;
} & Event;

declare global {
	interface Window {
		SpeechRecognition: {
			new (): TSpeechRecognition;
		};
		webkitSpeechRecognition: {
			new (): TSpeechRecognition;
		};
	}
}

type TVoiceStatus = "idle" | "starting" | "recording";

export type TDictationButtonProps = {
	/** True while the assistant is generating — aborts any active dictation. */
	isGenerating: boolean;
	/** Append a finalized chunk of transcript to the composer input. */
	onFinalText: (text: string) => void;
	/** Notifies the parent of the dictating state (drives layout + the bubble). */
	onStatusChange?: (isDictating: boolean) => void;
	/** Notifies the parent of the latest interim (non-final) transcript. */
	onInterimChange?: (interim: string) => void;
};

// Avoids the SSR warning while still running before paint on the client.
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

// Turns spoken "period"/"comma" into symbols; off so real words aren't rewritten.
const ENABLE_SPOKEN_PUNCTUATION: boolean = false;

export function DictationButton({
	isGenerating,
	onFinalText,
	onStatusChange,
	onInterimChange,
}: TDictationButtonProps) {
	const [status, setStatus] = useState<TVoiceStatus>("idle");
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [recognition, setRecognition] = useState<TSpeechRecognition | null>(null);
	const [isMicBlocked, setIsMicBlocked] = useState(false);
	const [language, setLanguage] = useState(getDictationLanguage);
	const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

	const recognitionRef = useRef<TSpeechRecognition | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const isStartingRef = useRef(false);
	// Set when the language changes mid-dictation: `onend` restarts the
	// recognizer with this lang instead of tearing the session down.
	const restartLanguageRef = useRef<string | null>(null);
	const processedResultsRef = useRef<number>(0);
	// Mirror of the interim transcript for synchronous reads on language swap.
	const interimRef = useRef("");

	// Stable callback refs so the recognition effect never re-runs.
	const onFinalTextRef = useRef(onFinalText);
	onFinalTextRef.current = onFinalText;
	const onInterimChangeRef = useRef(onInterimChange);
	onInterimChangeRef.current = onInterimChange;

	const updateInterim = useCallback((text: string) => {
		interimRef.current = text;
		onInterimChangeRef.current?.(text);
	}, []);

	const stopStream = useCallback(() => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
			setStream(null);
		}
	}, []);

	// isDictating drives the footer layout; derive it from status so the
	// waveform can't render in the collapsed row next to the other controls.
	useIsomorphicLayoutEffect(() => {
		onStatusChange?.(status === "recording" || status === "starting");
	}, [status, onStatusChange]);

	useEffect(() => {
		if (
			typeof window !== "undefined" &&
			("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
		) {
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
			const speechRecognition = new SpeechRecognition();

			speechRecognition.continuous = true;
			speechRecognition.interimResults = true;
			speechRecognition.lang = getDictationLanguage();

			// Chrome 151+: infer punctuation from pauses/prosody; no-op elsewhere.
			if ("unspokenPunctuation" in speechRecognition) {
				speechRecognition.unspokenPunctuation = true;
			}
			if (ENABLE_SPOKEN_PUNCTUATION && "spokenPunctuation" in speechRecognition) {
				speechRecognition.spokenPunctuation = true;
			}

			speechRecognition.onstart = () => {
				isStartingRef.current = false;
				setStatus("recording");
				processedResultsRef.current = 0;
				updateInterim("");
			};

			speechRecognition.onend = () => {
				isStartingRef.current = false;
				updateInterim("");

				const restartLanguage = restartLanguageRef.current;
				if (restartLanguage) {
					restartLanguageRef.current = null;
					speechRecognition.lang = restartLanguage;
					processedResultsRef.current = 0;
					try {
						speechRecognition.start();
						return;
					} catch {
						// start() throws InvalidStateError if the recognizer is in a bad state;
						// catching ensures the teardown below always runs
					}
				}

				setStatus("idle");
				stopStream();
			};

			speechRecognition.onresult = (event) => {
				let finalTranscript = "";
				let interimTranscript = "";

				for (let i = processedResultsRef.current; i < event.results.length; i++) {
					const result = event.results[i];
					const transcript = result?.[0]?.transcript ?? "";
					if (result?.isFinal) {
						finalTranscript += transcript;
						processedResultsRef.current = i + 1;
					} else {
						interimTranscript += transcript;
					}
				}

				// Interim goes to the bubble, not the editor, so user edits can't collide.
				if (finalTranscript) {
					onFinalTextRef.current(finalTranscript.trim() + " ");
				}

				updateInterim(interimTranscript.trim());
			};

			speechRecognition.onerror = (event) => {
				// Abort triggered by a language switch: `onend` handles the restart.
				if (restartLanguageRef.current && event.error === "aborted") return;
				// no-speech / aborted are benign (silence timeout, manual stop)
				if (event.error !== "no-speech" && event.error !== "aborted") {
					console.error("Speech recognition error:", event.error);
				}
				isStartingRef.current = false;
				setStatus("idle");
				stopStream();
				updateInterim("");
			};

			recognitionRef.current = speechRecognition;
			setRecognition(speechRecognition);
		}

		return () => {
			if (recognitionRef.current) {
				recognitionRef.current.stop();
			}
			stopStream();
			onStatusChange?.(false);
			updateInterim("");
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const startListening = useCallback(async () => {
		if (!recognition || isStartingRef.current) return;

		isStartingRef.current = true;
		restartLanguageRef.current = null;
		recognition.lang = getDictationLanguage();

		try {
			// Prompt for the mic before showing the recording UI so a decline
			// doesn't flash the waveform.
			const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			setIsMicBlocked(false);
			streamRef.current = micStream;
			setStream(micStream);
			setStatus("starting");
			recognition.start();
		} catch (error) {
			isStartingRef.current = false;
			console.error("Microphone access error:", error);
			if (error instanceof DOMException && error.name === "NotAllowedError") {
				setIsMicBlocked(true);
			}
			setStatus("idle");
			stopStream();
		}
	}, [recognition, stopStream]);

	const handleLanguageChange = useCallback(
		(code: string) => {
			setLanguage(code);
			setDictationLanguage(code);

			if (!recognition) return;
			if (status === "recording" || status === "starting") {
				// abort() drops in-flight audio without a final result; flush interim first.
				if (interimRef.current) {
					onFinalTextRef.current(interimRef.current.trim() + " ");
					updateInterim("");
				}

				// Restart via onend so the mic stream and waveform stay live through the swap.
				restartLanguageRef.current = code;
				if (recognition.abort) {
					recognition.abort();
				} else {
					recognition.stop();
				}
			}
		},
		[recognition, status, updateInterim],
	);

	const stopListening = useCallback(() => {
		if (!recognition) return;
		// Optimistically return to idle so the button doesn't lag behind the
		// async `onend`; recognition still finalizes any pending transcript.
		restartLanguageRef.current = null;
		setStatus("idle");
		stopStream();
		recognition.stop();
	}, [recognition, stopStream]);

	// Stop dictation when a message starts sending; abort so no trailing
	// transcript lands in the freshly cleared prompt.
	useEffect(() => {
		if (!isGenerating) return;
		if (status !== "recording" && status !== "starting") return;

		restartLanguageRef.current = null;
		setStatus("idle");
		stopStream();
		updateInterim("");
		recognitionRef.current?.abort?.();
	}, [isGenerating, status, stopStream, updateInterim]);

	if (!recognition) return null;

	if (status === "recording" || status === "starting") {
		return (
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<Popover
					open={isLanguagePickerOpen}
					onOpenChange={setIsLanguagePickerOpen}
				>
					<PopoverTrigger asChild>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							className="w-14 shrink-0 justify-center gap-1 rounded-full px-0 text-xs font-medium uppercase"
							aria-label="Dictation language"
							aria-expanded={isLanguagePickerOpen}
							role="combobox"
						>
							{language.split("-")[0]}
							<ChevronDownIcon
								className={cn(
									"size-3.5 opacity-70 transition-transform duration-200",
									isLanguagePickerOpen && "rotate-180",
								)}
							/>
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="w-60 p-0"
					>
						<Command>
							<CommandInput placeholder="Search languages..." />
							<CommandList>
								<CommandEmpty>No language found.</CommandEmpty>
								<CommandGroup>
									{SPEECH_LANGUAGES.map((speechLanguage) => (
										<CommandItem
											key={speechLanguage.code}
											value={`${speechLanguage.label} ${speechLanguage.englishLabel} ${speechLanguage.code}`}
											onSelect={() => {
												handleLanguageChange(speechLanguage.code);
												setIsLanguagePickerOpen(false);
											}}
										>
											<span className="truncate">{speechLanguage.label}</span>
											{speechLanguage.englishLabel !==
												speechLanguage.label && (
												<span className="ml-2 truncate text-xs text-muted-foreground">
													{speechLanguage.englishLabel}
												</span>
											)}
											<CheckIcon
												className={cn(
													"ml-auto size-4 shrink-0",
													language === speechLanguage.code
														? "opacity-100"
														: "opacity-0",
												)}
											/>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
				<LiveWaveform
					active={status === "recording"}
					processing={status === "starting"}
					stream={stream}
					mode="static"
					barWidth={2}
					barGap={2}
					barRadius={1}
					height={28}
					fadeEdges
					fadeWidth={32}
					className="min-w-0 flex-1 text-foreground/70"
				/>
				<Button
					type="button"
					size="icon"
					variant="secondary"
					className="group size-9 shrink-0 rounded-full bg-red-600 text-white transition-all duration-300 hover:bg-red-700"
					onClick={stopListening}
					aria-label="Stop recording"
				>
					<span className="size-2.5 rounded-[3px] bg-current" />
				</Button>
			</div>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant="secondary"
					className="group size-9 shrink-0 rounded-full transition-all duration-300"
					onClick={startListening}
					aria-label={
						isMicBlocked ? "Allow mic access to dictate" : "Start voice dictation"
					}
				>
					<MicIcon className="size-5" />
				</Button>
			</TooltipTrigger>
			<TooltipPortal>
				<TooltipContent>
					{isMicBlocked ? "Allow mic access to dictate" : "Dictate"}
				</TooltipContent>
			</TooltipPortal>
		</Tooltip>
	);
}
