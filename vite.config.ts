import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/.tmp/**', '**/dist/**', '**/*.tmpdir/**', '**/.*.tmpdir/**'],
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Qardho Attendance Portal',
        short_name: 'Qardho QR',
        description: 'Qardho Branch QR employee attendance',
        theme_color: '#160709',
        background_color: '#fdf6f6',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/pwa.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          xlsx: ['xlsx'],
          qrcode: ['html5-qrcode', 'qrcode.react'],
        },
      },
    },
  },
});
