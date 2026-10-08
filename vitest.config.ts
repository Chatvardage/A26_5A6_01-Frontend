import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // RealGatewayRuntime.js est le vrai client réseau (processus main) :
      // mesuré lui aussi, même s'il n'est pas en TypeScript.
      include: [
        'src/**/*.ts',
        'src/infrastructure/gateways/RealGatewayRuntime.js',
        'src/infrastructure/gateways/runtime/*.js',
        // Logique pure des pages de chat (voir son en-tête).
        'src/presentation/pages/javascript/logique-interface.js',
        // Provenance des URL et des appels IPC du processus main.
        'src/main/securite.js',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/infrastructure/gateways/AuthGateway.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
