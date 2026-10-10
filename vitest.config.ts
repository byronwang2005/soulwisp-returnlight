import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.ts'],exclude:['tests/**/*.e2e.ts'],fileParallelism:false,testTimeout:20000,hookTimeout:25000}});
