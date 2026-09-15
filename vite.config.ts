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

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '');
  const isBuild = command === 'build';
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      ...(isBuild ? [viteSingleFile()] : []),
      ...(isBuild ? [VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: '圖面公差解析系統',
          short_name: '公差解析',
          description: 'AI 驅動的工程圖面公差解析工具',
          theme_color: '#e2e8f0',
          background_color: '#f8fafc',
          display: 'standalone',
          icons: [
            {
              src: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📐</text></svg>',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            },
            {
              src: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📐</text></svg>',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })] : []),
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
