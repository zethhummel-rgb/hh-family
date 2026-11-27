import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  server: {host: '0.0.0.0', allowedHosts: ['terminal.local']},
  plugins: [react()],
  build: {rollupOptions: {input: {app: 'index.html', admin: 'admin.html'}}},
});
