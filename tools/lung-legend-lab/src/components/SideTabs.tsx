import type { ReactNode } from 'react';

type Props = {
	/** e.g. "Tier 1 Review" */
	title: string;
	/** Scrollable review body. */
	children: ReactNode;
	/** Sticky footer (Generate Feedback Prompt, Tier Complete). */
	footer: ReactNode;
};

/**
 * Right-hand refine rail: titled review body with a pinned action footer.
 */
export function SideTabs({ title, children, footer }: Props) {
	return (
		<div className="side-tabs refine-side-layout">
			<header className="refine-side-header">
				<h2 className="refine-side-title">{title}</h2>
			</header>
			<div className="refine-side-scroll tab-body">{children}</div>
			<footer className="refine-side-footer">{footer}</footer>
		</div>
	);
}
