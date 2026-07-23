import { AnimatePresence, motion } from "motion/react";

export type TDictationInterimBubbleProps = {
	isDictating: boolean;
	interimTranscript: string;
};

export function DictationInterimBubble({
	isDictating,
	interimTranscript,
}: TDictationInterimBubbleProps) {
	return (
		<AnimatePresence>
			{isDictating && interimTranscript ? (
				<motion.div
					initial={{ opacity: 0, y: 6, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 6, scale: 0.98 }}
					transition={{ duration: 0.15, ease: "easeOut" }}
					className="pointer-events-none absolute inset-x-3 bottom-full z-30 mb-2 flex justify-end sm:inset-x-4"
				>
					<div className="max-w-full rounded-2xl rounded-br-md border bg-popover px-4 py-2.5 shadow dark:shadow-none">
						<p
							aria-live="polite"
							className="line-clamp-3 text-sm text-foreground/80"
						>
							{interimTranscript}
						</p>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
