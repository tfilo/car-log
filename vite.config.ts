import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3000
    },
    resolve: {
        tsconfigPaths: true
    },
    optimizeDeps: {
        include: ['react/compiler-runtime']
    },
    plugins: [
        tanstackStart(),
        tailwindcss(),
        // Include custom Sharp native builds, which use a computed addon path.
        nitro({ traceDeps: ['sharp*'] }),
        // react's vite plugin must come after start's vite plugin
        viteReact(),
        babel({
            presets: [reactCompilerPreset()]
        })
    ]
});
