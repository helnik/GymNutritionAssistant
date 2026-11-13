import { defineConfig } from 'vite';

export default defineConfig({
  base: '/GymNutritionAssistant/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'local'),
  },
});
