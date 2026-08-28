/**
 * Wire project figure triggers to accessible full-image overlay dialogs.
 */
function bindFigureLightbox(trigger: HTMLButtonElement): void {
	if (trigger.dataset.figureLightboxBound === 'true') return;
	trigger.dataset.figureLightboxBound = 'true';

	const dialogId = trigger.getAttribute('aria-controls');
	if (!dialogId) return;

	const dialog = document.getElementById(dialogId);
	if (!(dialog instanceof HTMLDialogElement)) return;

	const closeButton = dialog.querySelector<HTMLButtonElement>('[data-figure-lightbox-close]');
	const image = dialog.querySelector<HTMLImageElement>('[data-figure-lightbox-image]');

	/** Restore page scroll and focus after the overlay closes. */
	const unlockScroll = (): void => {
		document.body.classList.remove('figure-lightbox-open');
	};

	/** Open the overlay with the trigger's full-resolution figure. */
	const openLightbox = (): void => {
		const src = trigger.dataset.figureSrc;
		const alt = trigger.dataset.figureAlt ?? '';

		if (!src || !image) return;

		image.src = src;
		image.alt = alt;
		dialog.showModal();
		document.body.classList.add('figure-lightbox-open');
		closeButton?.focus();
	};

	/** Close the overlay and return focus to the figure trigger. */
	const closeLightbox = (): void => {
		if (!dialog.open) return;
		dialog.close();
		unlockScroll();
		trigger.focus();
	};

	trigger.addEventListener('click', openLightbox);
	closeButton?.addEventListener('click', closeLightbox);

	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) closeLightbox();
	});

	dialog.addEventListener('close', unlockScroll);

	dialog.addEventListener('cancel', (event) => {
		event.preventDefault();
		closeLightbox();
	});
}

/**
 * Attach lightbox handlers to all project figure triggers on the page.
 */
export function initFigureLightboxes(): void {
	document
		.querySelectorAll<HTMLButtonElement>('[data-figure-lightbox-trigger]')
		.forEach(bindFigureLightbox);
}

initFigureLightboxes();
document.addEventListener('astro:page-load', initFigureLightboxes);
