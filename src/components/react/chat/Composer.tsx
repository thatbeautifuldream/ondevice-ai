import { useRef, useState } from "react";
import { Icon } from "../Icon";

type TComposerProps = {
	// Stop is only offered for the conversation that is actually generating.
	showStop: boolean;
	isGenerating: boolean;
	blocked: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
};

export function Composer({ showStop, isGenerating, blocked, onSend, onStop }: TComposerProps) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const autoResize = () => {
		const ta = inputRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
	};

	const submit = () => {
		if (showStop) {
			onStop();
			return;
		}
		if (blocked || isGenerating || !text.trim()) return;
		setText("");
		requestAnimationFrame(autoResize);
		onSend(text);
	};

	const disabled = showStop ? false : blocked || isGenerating || !text.trim();

	return (
		<div className="relative shrink-0 px-3 pb-3 pt-4 sm:px-4 sm:pb-4 sm:pt-6">
			<div className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-linear-to-b from-transparent to-white dark:to-zinc-950"></div>
			<form
				className="relative mx-auto w-full max-w-3xl"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div className="flex items-end gap-2 rounded-3xl bg-zinc-50 p-2 transition-shadow focus-within:ring-2 focus-within:ring-accent/40 dark:bg-white/5">
					<label htmlFor="composer-input" className="sr-only">
						Message
					</label>
					<textarea
						id="composer-input"
						ref={inputRef}
						name="message"
						rows={1}
						value={text}
						placeholder="Message the on-device model…"
						className="scrollbar-thin max-h-48 min-h-[1.75rem] flex-1 resize-none bg-transparent px-2.5 py-1.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none sm:text-sm dark:text-zinc-100 dark:placeholder:text-zinc-500"
						onChange={(e) => {
							setText(e.target.value);
							autoResize();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								if (!isGenerating) submit();
							}
						}}
					></textarea>

					<button
						type="submit"
						disabled={disabled}
						className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:shadow-none dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
						aria-label={showStop ? "Stop generating" : "Send message"}
					>
						<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
						<span className="flex">
							<Icon name={showStop ? "stop" : "arrow-up"} className="size-4" />
						</span>
					</button>
				</div>
			</form>
		</div>
	);
}
