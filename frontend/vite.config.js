// import { defineConfig } from 'vite';

// export default defineConfig({
//     // root: 'src', // Uncomment and set if your source files are in a subdirectory
//     server: {
//         port: 3000,
//         open: true,
//     },
//     build: {
//         outDir: 'dist',
//         sourcemap: true,
//     },
//     // plugins: [], // Add Vite plugins here
// });


import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3000,
        open: true,
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        target: 'esnext'
    },
});