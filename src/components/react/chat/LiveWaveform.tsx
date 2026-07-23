import { useEffect, useRef, type HTMLAttributes } from "react";

import { cn } from "../../../lib/utils";

export type TLiveWaveformProps = HTMLAttributes<HTMLDivElement> & {
	active?: boolean;
	processing?: boolean;
	/** The mic stream to visualise; owned and released by the caller. */
	stream?: MediaStream | null;
	barWidth?: number;
	barHeight?: number;
	barGap?: number;
	barRadius?: number;
	barColor?: string;
	fadeEdges?: boolean;
	fadeWidth?: number;
	height?: string | number;
	sensitivity?: number;
	smoothingTimeConstant?: number;
	fftSize?: number;
	historySize?: number;
	updateRate?: number;
	mode?: "scrolling" | "static";
	onError?: (error: Error) => void;
};

export function LiveWaveform({
	active = false,
	processing = false,
	stream: externalStream,
	barWidth = 3,
	barGap = 1,
	barRadius = 1.5,
	barColor,
	fadeEdges = true,
	fadeWidth = 24,
	barHeight: baseBarHeight = 4,
	height = 64,
	sensitivity = 1,
	smoothingTimeConstant = 0.8,
	fftSize = 256,
	historySize = 60,
	updateRate = 30,
	mode = "static",
	onError,
	className,
	...props
}: TLiveWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const historyRef = useRef<number[]>([]);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const animationRef = useRef<number>(0);
	const lastUpdateRef = useRef<number>(0);
	const processingAnimationRef = useRef<number | null>(null);
	const lastActiveDataRef = useRef<number[]>([]);
	const transitionProgressRef = useRef(0);
	const staticBarsRef = useRef<number[]>([]);
	const needsRedrawRef = useRef(true);
	const gradientCacheRef = useRef<CanvasGradient | null>(null);
	const lastWidthRef = useRef(0);
	const sizeRef = useRef({ width: 0, height: 0 });

	const heightStyle = typeof height === "number" ? `${height}px` : height;

	// Handle canvas resizing
	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;

		const resizeObserver = new ResizeObserver(() => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;

			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;

			const ctx = canvas.getContext("2d");
			if (ctx) {
				ctx.scale(dpr, dpr);
			}

			gradientCacheRef.current = null;
			lastWidthRef.current = rect.width;
			sizeRef.current = { width: rect.width, height: rect.height };
			needsRedrawRef.current = true;
		});

		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, []);

	useEffect(() => {
		if (processing && !active) {
			let time = 0;
			transitionProgressRef.current = 0;

			const animateProcessing = () => {
				time += 0.03;
				transitionProgressRef.current = Math.min(1, transitionProgressRef.current + 0.02);

				const isStatic = mode === "static";
				const processingData = [];
				const barCount = Math.floor((sizeRef.current.width || 200) / (barWidth + barGap));
				const halfCount = isStatic ? Math.floor(barCount / 2) : barCount / 2;
				const lastData = lastActiveDataRef.current;

				for (let i = 0; i < barCount; i++) {
					const normalizedPosition = (i - halfCount) / halfCount;
					const centerWeight = 1 - Math.abs(normalizedPosition) * 0.4;

					// Static mode phases by position so the wave is symmetric;
					// scrolling mode phases by bar index.
					const p = isStatic ? normalizedPosition : i * 0.05;
					const wave1 = Math.sin(time * 1.5 + p * 3) * 0.25;
					const wave2 = Math.sin(time * 0.8 - p * 2) * 0.2;
					const wave3 = Math.cos(time * 2 + p) * 0.15;
					const processingValue = (0.2 + wave1 + wave2 + wave3) * centerWeight;

					let finalValue = processingValue;
					if (lastData.length > 0 && transitionProgressRef.current < 1) {
						const lastDataIndex = isStatic
							? Math.min(i, lastData.length - 1)
							: Math.floor((i / barCount) * lastData.length);
						const lastValue = lastData[lastDataIndex] || 0;
						finalValue =
							lastValue * (1 - transitionProgressRef.current) +
							processingValue * transitionProgressRef.current;
					}

					processingData.push(Math.max(0.05, Math.min(1, finalValue)));
				}

				if (isStatic) {
					staticBarsRef.current = processingData;
				} else {
					historyRef.current = processingData;
				}

				needsRedrawRef.current = true;
				processingAnimationRef.current = requestAnimationFrame(animateProcessing);
			};

			animateProcessing();

			return () => {
				if (processingAnimationRef.current) {
					cancelAnimationFrame(processingAnimationRef.current);
				}
			};
		} else if (!active && !processing) {
			const barsRef = mode === "static" ? staticBarsRef : historyRef;

			if (barsRef.current.length > 0) {
				let fadeProgress = 0;
				const fadeToIdle = () => {
					fadeProgress += 0.03;
					if (fadeProgress < 1) {
						barsRef.current = barsRef.current.map(
							(value) => value * (1 - fadeProgress),
						);
						needsRedrawRef.current = true;
						requestAnimationFrame(fadeToIdle);
					} else {
						barsRef.current = [];
					}
				};
				fadeToIdle();
			}
		}

		return undefined;
	}, [processing, active, barWidth, barGap, mode]);

	// Attach the analyser to the caller's mic stream. The component never
	// opens its own microphone — the stream's owner is the only one holding
	// mic tracks, so stopping there always releases the mic. While `stream`
	// is still null (mic warming up) we just wait; the effect re-runs once
	// the prop arrives.
	useEffect(() => {
		if (!active || !externalStream) return;

		try {
			const audioContext = new AudioContext();
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = fftSize;
			analyser.smoothingTimeConstant = smoothingTimeConstant;

			const source = audioContext.createMediaStreamSource(externalStream);
			source.connect(analyser);

			audioContextRef.current = audioContext;
			analyserRef.current = analyser;

			// Clear history when starting
			historyRef.current = [];
		} catch (error) {
			onError?.(error as Error);
		}

		return () => {
			analyserRef.current = null;
			if (audioContextRef.current && audioContextRef.current.state !== "closed") {
				audioContextRef.current.close();
				audioContextRef.current = null;
			}
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current);
				animationRef.current = 0;
			}
		};
	}, [active, externalStream, fftSize, smoothingTimeConstant, onError]);

	// Animation loop
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let rafId: number;
		let computedBarColor = barColor || "";

		const animate = (currentTime: number) => {
			// Render waveform
			const rect = sizeRef.current;

			// Update audio data if active
			if (active && currentTime - lastUpdateRef.current > updateRate) {
				lastUpdateRef.current = currentTime;

				if (analyserRef.current) {
					const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
					analyserRef.current.getByteFrequencyData(dataArray);

					if (mode === "static") {
						// For static mode, update bars in place
						const startFreq = Math.floor(dataArray.length * 0.05);
						const endFreq = Math.floor(dataArray.length * 0.4);
						const relevantData = dataArray.slice(startFreq, endFreq);

						const barCount = Math.floor(rect.width / (barWidth + barGap));
						const halfCount = Math.floor(barCount / 2);
						const half = Array.from({ length: halfCount }, (_, i) => {
							const dataIndex = Math.floor((i / halfCount) * relevantData.length);
							const value = Math.min(
								1,
								((relevantData[dataIndex] ?? 0) / 255) * sensitivity,
							);
							return Math.max(0.05, value);
						});

						// Mirror the data for symmetric display
						const newBars = [...half].reverse().concat(half);
						staticBarsRef.current = newBars;
						lastActiveDataRef.current = newBars;
					} else {
						// Scrolling mode - original behavior
						let sum = 0;
						const startFreq = Math.floor(dataArray.length * 0.05);
						const endFreq = Math.floor(dataArray.length * 0.4);
						const relevantData = dataArray.slice(startFreq, endFreq);

						for (const value of relevantData) {
							sum += value;
						}
						const average = (sum / relevantData.length / 255) * sensitivity;

						// Add to history
						historyRef.current.push(Math.min(1, Math.max(0.05, average)));
						lastActiveDataRef.current = [...historyRef.current];

						// Maintain history size
						if (historyRef.current.length > historySize) {
							historyRef.current.shift();
						}
					}
					needsRedrawRef.current = true;
				}
			}

			// Only redraw if needed
			if (!needsRedrawRef.current && !active) {
				rafId = requestAnimationFrame(animate);
				return;
			}

			needsRedrawRef.current = active;
			ctx.clearRect(0, 0, rect.width, rect.height);

			if (!computedBarColor) {
				computedBarColor = getComputedStyle(canvas).color || "#000";
			}

			const step = barWidth + barGap;
			const barCount = Math.floor(rect.width / step);
			const centerY = rect.height / 2;
			const isStatic = mode === "static";
			const data = isStatic ? staticBarsRef.current : historyRef.current;

			// Static mode draws left-to-right; scrolling mode draws newest-first
			// from the right edge.
			for (let i = 0; i < barCount && i < data.length; i++) {
				const value = (isStatic ? data[i] : data[data.length - 1 - i]) || 0.1;
				const x = isStatic ? i * step : rect.width - (i + 1) * step;
				const barHeight = Math.max(baseBarHeight, value * rect.height * 0.8);
				const y = centerY - barHeight / 2;

				ctx.fillStyle = computedBarColor;
				ctx.globalAlpha = 0.4 + value * 0.6;

				if (barRadius > 0) {
					ctx.beginPath();
					ctx.roundRect(x, y, barWidth, barHeight, barRadius);
					ctx.fill();
				} else {
					ctx.fillRect(x, y, barWidth, barHeight);
				}
			}

			// Apply edge fading
			if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
				if (!gradientCacheRef.current || lastWidthRef.current !== rect.width) {
					const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
					const fadePercent = Math.min(0.3, fadeWidth / rect.width);

					gradient.addColorStop(0, "rgba(255,255,255,1)");
					gradient.addColorStop(fadePercent, "rgba(255,255,255,0)");
					gradient.addColorStop(1 - fadePercent, "rgba(255,255,255,0)");
					gradient.addColorStop(1, "rgba(255,255,255,1)");

					gradientCacheRef.current = gradient;
					lastWidthRef.current = rect.width;
				}

				ctx.globalCompositeOperation = "destination-out";
				ctx.fillStyle = gradientCacheRef.current;
				ctx.fillRect(0, 0, rect.width, rect.height);
				ctx.globalCompositeOperation = "source-over";
			}

			ctx.globalAlpha = 1;

			rafId = requestAnimationFrame(animate);
		};

		rafId = requestAnimationFrame(animate);

		return () => {
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
		};
	}, [
		active,
		processing,
		sensitivity,
		updateRate,
		historySize,
		barWidth,
		baseBarHeight,
		barGap,
		barRadius,
		barColor,
		fadeEdges,
		fadeWidth,
		mode,
	]);

	return (
		<div
			className={cn("relative h-full w-full", className)}
			ref={containerRef}
			style={{ height: heightStyle }}
			aria-label={
				active
					? "Live audio waveform"
					: processing
						? "Processing audio"
						: "Audio waveform idle"
			}
			role="img"
			{...props}
		>
			{!active && !processing && (
				<div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t-2 border-dotted border-muted-foreground/20" />
			)}
			<canvas
				className="block h-full w-full"
				ref={canvasRef}
				aria-hidden="true"
			/>
		</div>
	);
}
