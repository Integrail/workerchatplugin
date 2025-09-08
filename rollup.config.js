import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

const production = !process.env.ROLLUP_WATCH;

export default [
    // ESM build
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/everworker-voice.esm.js',
            format: 'esm',
            sourcemap: true
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            json(),
            typescript({
                tsconfig: './tsconfig.json',
                declaration: true,
                declarationDir: './dist',
                rootDir: './src'
            }),
            production && terser()
        ]
    },
    // UMD build for CDN
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/everworker-voice.umd.js',
            format: 'umd',
            name: 'EverworkerVoice',
            sourcemap: true,
            globals: {}
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            json(),
            typescript({
                tsconfig: './tsconfig.json'
            }),
            production && terser()
        ]
    },
    // Minified UMD build for CDN
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/everworker-voice.min.js',
            format: 'umd',
            name: 'EverworkerVoice',
            sourcemap: true,
            globals: {}
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            json(),
            typescript({
                tsconfig: './tsconfig.json'
            }),
            terser({
                compress: {
                    drop_console: true,
                    drop_debugger: true,
                    pure_funcs: ['console.log', 'console.info', 'console.debug']
                },
                mangle: true,
                format: {
                    comments: false
                }
            })
        ]
    },
    // CommonJS build
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/everworker-voice.cjs.js',
            format: 'cjs',
            sourcemap: true,
            exports: 'named'
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            json(),
            typescript({
                tsconfig: './tsconfig.json'
            }),
            production && terser()
        ]
    }
];