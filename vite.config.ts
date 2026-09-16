import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

const downloadPlugin = () => ({
  name: 'download-plugin',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url === '/download-offline-app') {
        const file = path.resolve(__dirname, 'dist/index.html');
        if (fs.existsSync(file)) {
          res.setHeader('Content-disposition', 'attachment; filename=DrawingAnalyzer-Offline.html');
          res.setHeader('Content-type', 'text/html');
          fs.createReadStream(file).pipe(res);
        } else {
          res.statusCode = 404;
          res.end('Offline file not found. Please wait for the system to finish building.');
        }
      } else {
        next();
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  // Trigger GitHub Actions redeploy
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      downloadPlugin()
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
