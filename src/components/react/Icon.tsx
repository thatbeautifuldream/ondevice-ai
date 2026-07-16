import { ICONS } from "../../lib/icons";

type TIconProps = {
	name: string;
	className?: string;
};

export function Icon({ name, className = "size-4" }: TIconProps) {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			className={className}
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
		/>
	);
}
