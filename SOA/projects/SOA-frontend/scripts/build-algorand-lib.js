import { build } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildAlgorandLib() {
  try {
    await build({
      configFile: false,
      root: resolve(__dirname, '..'),
      build: {
        lib: {
          entry: resolve(__dirname, '../src/services/algorand/index.ts'),
          name: 'AlgorandAPI',
          fileName: 'algorand-api',
          formats: ['es']
        },
        outDir: resolve(__dirname, '../public'),
        emptyOutDir: false,
        rollupOptions: {
          external: [],
          output: {
            globals: {}
          }
        }
      },
      resolve: {
        alias: {
          '@': resolve(__dirname, '../src')
        }
      }
    });
    console.log('✅ AlgorandAPI library built successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildAlgorandLib();
