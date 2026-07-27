import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Static Markdown pages (e.g. join / prospective researchers copy).
 * Publications and projects are generated into src/data/*.json via npm run sync:research.
 */
const pages = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './content/pages' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
	}),
});

export const collections = { pages };
