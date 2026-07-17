import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

// Module-level so the plugin config keeps a stable identity across renders
// (Streamdown is memoized internally). Single-dollar inline math is opt-in.
export const STREAMDOWN_PLUGINS = {
	cjk,
	code,
	math: createMathPlugin({ singleDollarTextMath: true }),
	mermaid,
};

export function MarkdownOutput({
	content,
	animating,
	className = "text-base/7 text-zinc-900 dark:text-zinc-100",
}: {
	content: string;
	animating?: boolean;
	className?: string;
}) {
	return (
		<Streamdown className={className} plugins={STREAMDOWN_PLUGINS} isAnimating={!!animating}>
			{content}
		</Streamdown>
	);
}
