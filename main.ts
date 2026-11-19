import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const outputDirectory = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

async function requireDirectory(path) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new Error(`Required directory is missing: ${path}`);
  }
  if (!details.isDirectory()) throw new Error(`Expected a directory: ${path}`);
}

async function assembleEntry() {
  const sourceApp = join(projectDirectory, 'app');
  const sourceScreenshots = join(projectDirectory, 'screenshots');
  await Promise.all([requireDirectory(sourceApp), requireDirectory(sourceScreenshots)]);
  const page = await stat(join(sourceApp, 'index.html')).catch(() => null);
  if (!page?.isFile()) throw new Error('The application needs app/index.html before it can be packaged.');

  for (const source of [projectDirectory, sourceApp, sourceScreenshots]) {
    const inside = relative(source, outputDirectory);
    if (inside === '' || (source !== projectDirectory && !inside.startsWith('..'))) {
      throw new Error('Choose an output directory separate from the application and screenshot sources.');
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  console.log(`Preparing VicePrint entry in ${outputDirectory}`);
  for (const name of ['app', 'screenshots']) {
    await cp(join(projectDirectory, name), join(outputDirectory, name), { recursive: true, force: true });
    console.log(`Copied ${name}/`);
  }

  const dossier = buildDossier(outputDirectory, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  });
  const dossierPath = join(outputDirectory, 'dossier.json');
  await writeFile(dossierPath, dossier);
  console.log(`Wrote dossier.json (${dossier.byteLength} bytes)`);
  console.log('VicePrint package complete.');
}

assembleEntry().catch((error) => {
  console.error(`VicePrint packaging failed: ${error.message}`);
  process.exitCode = 1;
});
