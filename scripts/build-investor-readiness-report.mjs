/**
 * Builds and verifies the investor-readiness portable report.
 *
 * The packaged Data Analytics reader uses a 100vw top bar, which overflows by
 * the native scrollbar width on long Windows documents. This wrapper keeps the
 * canonical artifact, packaged reader, chart extraction, and verifier, while
 * adding one narrowly scoped CSS correction to the packaged runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const pluginRoot = join(
  process.env.USERPROFILE || '',
  '.codex',
  'plugins',
  'cache',
  'openai-curated-remote',
  'data-analytics',
  '0.2.8-13ceeea1f599'
);
const scriptsRoot = join(pluginRoot, 'skills', 'build-report', 'scripts');
const { buildPortableArtifact } = await import(
  pathToFileURL(join(scriptsRoot, 'build_portable_artifact.mjs')).href
);
const { extractPortableChartSvgs } = await import(
  pathToFileURL(join(scriptsRoot, 'extract_portable_chart_svgs.mjs')).href
);
const { verifyPortableArtifact, verifyPortableArtifactStructure } = await import(
  pathToFileURL(join(scriptsRoot, 'verify_portable_artifact.mjs')).href
);

const inputPath = resolve(
  process.argv[2] || 'reports/investor-readiness-review-2026-08-22.artifact.json'
);
const outputPath = resolve(
  process.argv[3] || 'reports/investor-readiness-review-2026-08-22.html'
);
const artifact = JSON.parse(readFileSync(inputPath, 'utf8'));

function decodeRuntime(html) {
  const match = /<template id="data-analytics-portable-reader-runtime-source"[^>]*>([\s\S]*?)<\/template>/.exec(
    html
  );
  if (!match) throw new Error('Packaged reader runtime template not found.');
  return gunzipSync(Buffer.from(match[1].replace(/\s/g, ''), 'base64')).toString('utf8');
}

function patchWindowsScrollbarOverflow(runtimeHtml) {
  const correction = `
<style id="local-budget-portable-overflow-fix">
html,body,#data-analytics-portable-reader,#data-analytics-portable-reader-root{
  max-width:100%;
  overflow-x:clip;
}
.analytics-top-bar{
  left:0!important;
  right:0!important;
  width:auto!important;
  max-width:100%!important;
  margin-left:0!important;
  margin-right:0!important;
  transform:none!important;
  box-sizing:border-box!important;
}
</style>`;
  const headEnd = runtimeHtml.lastIndexOf('</head>');
  if (headEnd < 0) throw new Error('Packaged reader head not found.');
  return `${runtimeHtml.slice(0, headEnd)}${correction}${runtimeHtml.slice(headEnd)}`;
}

const packagedHtml = buildPortableArtifact(artifact);
const runtimeHtml = patchWindowsScrollbarOverflow(decodeRuntime(packagedHtml));

let html = buildPortableArtifact(artifact, { runtimeHtml });
writeFileSync(outputPath, html, 'utf8');

const staticCharts = await extractPortableChartSvgs({ htmlPath: outputPath });
html = buildPortableArtifact(artifact, { runtimeHtml, staticCharts });
writeFileSync(outputPath, html, 'utf8');

const structure = verifyPortableArtifactStructure({ artifactPath: inputPath, htmlPath: outputPath });
const verification = await verifyPortableArtifact({
  artifactPath: inputPath,
  htmlPath: outputPath,
  timeoutMs: 20_000,
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputPath,
      staticChartCount: staticCharts.size,
      structure,
      verification,
    },
    null,
    2
  )}\n`
);
