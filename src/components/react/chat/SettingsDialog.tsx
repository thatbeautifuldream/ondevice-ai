import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import type { TModelParams } from "../../../lib/chat/agent";
import type { TSettings } from "../../../lib/chat/types";

type TSettingsDialogProps = {
	open: boolean;
	settings: TSettings;
	modelParams: TModelParams | null;
	onClose: () => void;
	onChange: (patch: Partial<TSettings>) => void;
	onClearAll: () => void;
};

export function SettingsDialog({ open, settings, modelParams, onClose, onChange, onClearAll }: TSettingsDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	}, [open]);

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialogRef.current) onClose();
			}}
			className="m-auto w-[min(100vw,32rem)] rounded-2xl border-0 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/50 dark:bg-zinc-900 dark:text-zinc-100"
		>
			<div className="flex items-center justify-between px-5 py-4">
				<h2 className="text-base font-semibold tracking-tight">Settings</h2>
				<button
					type="button"
					onClick={onClose}
					className="relative flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
					aria-label="Close settings"
				>
					<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
					<Icon name="x-mark" />
				</button>
			</div>

			<div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto px-5 py-5 scrollbar-thin">
				<div className="flex flex-col gap-2">
					<label htmlFor="setting-system" className="text-sm font-medium text-zinc-900 dark:text-white">
						System prompt
					</label>
					<p className="text-sm text-zinc-500 dark:text-zinc-400">Sets the model's behavior for every new conversation.</p>
					<textarea
						id="setting-system"
						name="system"
						rows={3}
						value={settings.systemPrompt}
						onChange={(e) => onChange({ systemPrompt: e.target.value })}
						className="scrollbar-thin w-full resize-none rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-900 transition-shadow placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent/40 max-sm:text-base dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500"
						placeholder="You are a helpful, friendly assistant."
					></textarea>
				</div>

				{modelParams && (
					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<div className="flex items-baseline justify-between">
								<label htmlFor="setting-temperature" className="text-sm font-medium text-zinc-900 dark:text-white">
									Temperature
								</label>
								<span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
									{settings.temperature.toFixed(1)}
								</span>
							</div>
							<input
								type="range"
								id="setting-temperature"
								name="temperature"
								min={0}
								max={modelParams.maxTemperature}
								step={0.1}
								value={settings.temperature}
								onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
								className="w-full accent-accent"
							/>
							<p className="text-sm text-zinc-500 dark:text-zinc-400">Higher values produce more creative, varied responses.</p>
						</div>

						<div className="flex flex-col gap-2">
							<div className="flex items-baseline justify-between">
								<label htmlFor="setting-topk" className="text-sm font-medium text-zinc-900 dark:text-white">
									Top-K
								</label>
								<span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">{settings.topK}</span>
							</div>
							<input
								type="range"
								id="setting-topk"
								name="topk"
								min={1}
								max={modelParams.maxTopK}
								step={1}
								value={settings.topK}
								onChange={(e) => onChange({ topK: parseInt(e.target.value, 10) })}
								className="w-full accent-accent"
							/>
							<p className="text-sm text-zinc-500 dark:text-zinc-400">Limits the model to the top-K likely next tokens.</p>
						</div>
						<p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
							Parameter tuning is available via the Prompt API Origin Trial or Chrome Extensions. These apply to new
							conversations only.
						</p>
					</div>
				)}

				<div className="pt-5">
					<button
						type="button"
						onClick={onClearAll}
						className="relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
					>
						<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
						<Icon name="trash" />
						Delete all conversations
					</button>
				</div>
			</div>
		</dialog>
	);
}
