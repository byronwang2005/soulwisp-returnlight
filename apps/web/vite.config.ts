import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const proxy={'/api':{target:`http://127.0.0.1:${process.env.API_PORT||'3000'}`,changeOrigin:true}};
export default defineConfig({ envDir:'../..', plugins: [react()], server: { port: 5180, proxy,hmr:process.env.BROWSER_TEST==='1'?false:undefined }, preview:{port:5180,proxy}, build: { target: 'es2022', chunkSizeWarningLimit: 1300,rollupOptions:{output:{manualChunks:{three:['three'],react:['react','react-dom'],realtime:['@colyseus/sdk']}}} } });
