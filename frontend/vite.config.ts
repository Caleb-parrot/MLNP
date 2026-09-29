import { defineConfig } from 'vite';

// Relative asset URLs so the built page loads inside the Wails asset server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
