import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

// Get version from environment, git tag, or package.json
function getVersion(): string {
  // 1. Environment variable (set by GitHub Actions)
  if (process.env.VERSION) {
    return process.env.VERSION;
  }

  // 2. Try the exact tag first, then the nearest tag.
  try {
    const gitTag = execSync('git describe --tags --exact-match', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (gitTag) {
      return gitTag;
    }
  } catch {
    try {
      const gitTag = execSync('git describe --tags', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (gitTag) {
        return gitTag;
      }
    } catch {
      // Git is unavailable or the repository has no tags.
    }
  }

  // 3. Fall back to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(projectDir, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== '0.0.0') {
      return pkg.version;
    }
  } catch {
    // package.json not readable
  }

  return 'dev';
}

const managementHtmlAlias = {
  name: 'management-html-alias',
  closeBundle() {
    const sourcePath = path.resolve(projectDir, 'dist/index.html');
    const targetPath = path.resolve(projectDir, 'dist/management.html');
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  },
};

const versionMetaPlugin = {
  name: 'management-version-meta',
  transformIndexHtml(html: string) {
    return html.replace('__CPA_VERSION__', getVersion());
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    versionMetaPlugin,
    viteSingleFile({
      removeViteModuleLoader: true,
    }),
    managementHtmlAlias,
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
  resolve: {
    alias: {
      '@': path.resolve(projectDir, './src'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`,
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
