import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the maintainer lung-legend lab UI.
 * Proxies /api to the local Node lab server.
 */
export default defineConfig({
	plugins: [react()],
	server: {
		host: '127.0.0.1',
		port: 5179,
		strictPort: true,
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:8789',
				changeOrigin: true,
			},
		},
	},
});
