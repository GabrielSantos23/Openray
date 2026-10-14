// Builds the FlowKey extension bundle: single self-contained main.js. The shims (aliased at
// build time) read the sidecar globals at runtime, so no react/@flowkey-mini code ships here.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const flowkeyRoot = path.resolve('..', '..', 'flowkey');
const vendorRequire = createRequire(pathToFileURL(path.join(flowkeyRoot, 'vendor', 'package.json')));
const { build } = vendorRequire('esbuild');

await build({
  entryPoints: ['./src/index.tsx'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: './main.js',
  alias: {
    react: path.join(flowkeyRoot, 'cli', 'shims', 'react.ts'),
    'react/jsx-runtime': path.join(flowkeyRoot, 'cli', 'shims', 'react-jsx-runtime.ts'),
    'react/jsx-dev-runtime': path.join(flowkeyRoot, 'cli', 'shims', 'react-jsx-runtime.ts'),
    '@flowkey-mini/react-ui': path.join(flowkeyRoot, 'cli', 'shims', 'flowkey-react-ui.ts'),
    '@flowkey-mini/native-sdk': path.join(flowkeyRoot, 'cli', 'shims', 'flowkey-native-sdk.ts'),
  },
  logLevel: 'info',
});
