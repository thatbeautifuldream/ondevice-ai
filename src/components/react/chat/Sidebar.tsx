import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Icon } from "../Icon";
import type { TAvailability } from "../../../lib/chat/agent";
import type { TConversation } from "../../../lib/chat/types";

type TSidebarProps = {
	conversations: TConversation[];
	currentId: string | null;
	availability: TAvailability | null;
	open: boolean;
	collapsed: boolean;
	onClose: () => void;
	onNewChat: () => void;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onOpenSettings: () => void;
};

const STATUS: Record<TAvailability, { dot: string; text: string }> = {
	available: { dot: "bg-accent", text: "Ready · Gemini Nano" },
	downloadable: { dot: "bg-zinc-400", text: "Model ready to download" },
	downloading: { dot: "bg-zinc-400 animate-pulse", text: "Downloading model…" },
	unavailable: { dot: "bg-zinc-300 dark:bg-zinc-600", text: "Unavailable in this browser" },
};

export function Sidebar({
	conversations,
	currentId,
	availability,
	open,
	collapsed,
	onClose,
	onNewChat,
	onSelect,
	onDelete,
	onOpenSettings,
}: TSidebarProps) {
	const status = availability ? STATUS[availability] : { dot: "bg-zinc-400", text: "Checking model…" };

	return (
		<>
			<aside
				className="bg-zinc-50 dark:bg-zinc-900 flex w-72 shrink-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:-translate-x-full max-lg:transition-transform max-lg:duration-200 max-lg:data-[open]:translate-x-0 lg:static lg:transition-[width] lg:duration-[var(--resize-dur)] lg:ease-[var(--resize-ease)] lg:[will-change:width] lg:data-[collapsed]:w-0 motion-reduce:transition-none"
				aria-label="Conversations"
				{...(open ? { "data-open": "" } : {})}
				{...(collapsed ? { "data-collapsed": "" } : {})}
			>
				<div className="flex min-h-0 w-72 flex-1 flex-col">
					<div className="flex h-14 items-center gap-2 px-4">
						<span className="text-accent">
							<Icon name="sparkles" className="size-4" />
						</span>
						<span className="text-sm font-semibold tracking-tight">ApnaAI</span>
						<button
							type="button"
							onClick={onClose}
							className="relative ml-auto flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-700 lg:hidden dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
							aria-label="Close conversations"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 lg:hidden" aria-hidden="true"></span>
							<Icon name="x-mark" />
						</button>
					</div>

					<div className="px-3">
						<button
							type="button"
							onClick={onNewChat}
							className="relative flex w-full items-center gap-2 rounded-lg bg-zinc-950/5 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-950/10 hover:text-zinc-900 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15 dark:hover:text-white"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
							<Icon name="plus" />
							New chat
						</button>
					</div>

					<nav className="mt-3 px-3" aria-label="Playgrounds">
						<a
							href="/writing-tools"
							className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
							<Icon name="pencil-square" />
							Writing Tools
						</a>
						<a
							href="/translate"
							className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
							<Icon name="language" />
							Translate
						</a>
						<a
							href="/structured-output"
							className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
							<Icon name="code-bracket" />
							Structured Output
						</a>
					</nav>

					<nav className="scrollbar-thin mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversation list">
						<p className="px-2 py-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">Conversations</p>
						<ul role="list" className="flex flex-col">
							<MotionConfig reducedMotion="user">
								<AnimatePresence initial={false}>
								{conversations.map((conv) => {
									const active = conv.id === currentId;
									return (
										<motion.li
											key={conv.id}
											layout
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											exit={{ opacity: 0, height: 0 }}
											transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
											className="group relative overflow-hidden py-px"
										>
											<button
												type="button"
												onClick={() => onSelect(conv.id)}
												className={
													"relative flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
													(active
														? "bg-zinc-950/5 text-zinc-900 dark:bg-white/10 dark:text-white"
														: "text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white")
												}
											>
												<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
												<span className="truncate pr-7">{conv.title || "New chat"}</span>
											</button>
											<button
												type="button"
												onClick={() => onDelete(conv.id)}
												className="absolute top-1/2 right-1.5 -translate-y-1/2 flex size-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-950/10 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-300"
												aria-label="Delete conversation"
											>
												<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
												<Icon name="trash" />
											</button>
										</motion.li>
									);
								})}
								</AnimatePresence>
							</MotionConfig>
						</ul>
						{conversations.length === 0 && (
							<p className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500">No conversations yet.</p>
						)}
					</nav>

					<div className="relative p-3 pt-0">
						<div
							className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-linear-to-t from-zinc-50 to-transparent dark:from-zinc-900"
							aria-hidden="true"
						></div>
						<button
							type="button"
							onClick={onOpenSettings}
							className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
						>
							<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
							<Icon name="cog-6-tooth" />
							Settings
						</button>
						<div className="mt-2 flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
							<span className={`size-2 shrink-0 rounded-full ${status.dot}`}></span>
							<span className="truncate">{status.text}</span>
						</div>
					</div>
				</div>
			</aside>

			{open && (
				<div className="fixed inset-0 z-40 bg-zinc-950/40 lg:hidden" aria-hidden="true" onClick={onClose}></div>
			)}
		</>
	);
}
