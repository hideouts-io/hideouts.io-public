import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { crc32, gzipSync } from 'node:zlib';

const checker = fileURLToPath(new URL('./check-private-artifact.ts', import.meta.url));
const extractor = fileURLToPath(new URL('./extract-artifact-text.py', import.meta.url));
const dockerfile = fileURLToPath(new URL('../.github/docker/artifact-inspector.Dockerfile', import.meta.url));
const workflow = fileURLToPath(new URL('../.github/workflows/deploy.yml', import.meta.url));
const cert = fileURLToPath(new URL('../.github/release/site-artifact-recipient.pem', import.meta.url));
const imageId = `sha256:${'f'.repeat(64)}`;
const imageRef = `ghcr.io/hideouts-io/site-artifact-inspector@sha256:${'d'.repeat(64)}`;
const imageTarSha256 = 'e'.repeat(64);
const marker = 'FixtureAlpha123';
const retainedLogos = ['logo-on-dark.png', 'logo-on-light.png'] as const;

function parsePng(root: string, png: string): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const script = String.raw`
import pathlib, runpy, sys
module = runpy.run_path(sys.argv[1])
print(module['png_metadata'](pathlib.Path(sys.argv[2]).read_bytes()))
`;
  const result = spawnSync('python3', ['-I', '-c', script, join(root, 'extractor.py'), png], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function changeManifestPng(source: string, destination: string, replacement: string): void {
  const script = String.raw`
import pathlib, sys, zlib
data = bytearray(pathlib.Path(sys.argv[1]).read_bytes())
offset = 8
while offset + 12 <= len(data):
    size = int.from_bytes(data[offset:offset + 4], 'big')
    kind = data[offset + 4:offset + 8]
    end = offset + 12 + size
    if kind == b'caBX':
        start = offset + 8
        before = b'fill="none"'
        after = b'fill="' + sys.argv[3].encode('ascii') + b'"'
        if len(after) != len(before):
            raise ValueError('replacement must preserve length')
        location = data.find(before, start, start + size)
        if location < 0:
            raise ValueError('expected embedded SVG attribute missing')
        data[location:location + len(before)] = after
        data[end - 4:end] = zlib.crc32(data[offset + 4:end - 4]).to_bytes(4, 'big')
        pathlib.Path(sys.argv[2]).write_bytes(data)
        break
    offset = end
else:
    raise ValueError('manifest chunk missing')
`;
  const changed = spawnSync('python3', ['-I', '-c', script, source, destination, replacement], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(changed.status, 0, changed.stderr);
}

function verifierSha256(root: string): string {
  const parts = [
    ['checker', readFileSync(checker)],
    ['extractor', readFileSync(join(root, 'extractor.py'))],
    ['dockerfile', readFileSync(join(root, 'inspector.Dockerfile'))],
    ['workflow', readFileSync(join(root, 'deploy.yml'))],
    ['recipient-cert', readFileSync(join(root, 'recipient.pem'))],
  ] as const;
  const digest = createHash('sha256').update('site-verifier-v1\0');
  for (const [name, bytes] of parts) {
    digest.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return digest.digest('hex');
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hideouts-private-gate-test-'));
  for (const directory of ['build/src', 'build/public', 'build/.cache/github', 'build/dist'])
    mkdirSync(join(root, directory), { recursive: true });
  copyFileSync(extractor, join(root, 'extractor.py'));
  copyFileSync(dockerfile, join(root, 'inspector.Dockerfile'));
  copyFileSync(workflow, join(root, 'deploy.yml'));
  copyFileSync(cert, join(root, 'recipient.pem'));
  writeFileSync(join(root, 'image-id'), `${imageId}\n`);
  writeFileSync(join(root, 'image-ref'), `${imageRef}\n`);
  writeFileSync(join(root, 'image-tar-sha256'), `${imageTarSha256}\n`);
  writeFileSync(join(root, 'source.tar'), 'synthetic source archive');
  writeFileSync(join(root, 'extractions.json'), JSON.stringify({ schema: 1, images: [], search_files: [] }));
  writeFileSync(join(root, 'build', 'src', 'input.md'), 'Ordinary source content.\n');
  writeFileSync(join(root, 'build', 'dist', 'index.html'), '<html><body>Ordinary output.</body></html>\n');
  writeFileSync(
    join(root, 'policy.json'),
    JSON.stringify({
      schema: 1,
      policy_id: 'synthetic-local-test',
      owner: 'Synthetic reviewer',
      valid_until_utc: '2099-01-01T00:00:00Z',
      verifier_sha256: verifierSha256(root),
      recipient_cert_sha256: createHash('sha256')
        .update(readFileSync(join(root, 'recipient.pem')))
        .digest('hex'),
      inspector_image_ref: imageRef,
      inspector_image_sha256: imageId.slice('sha256:'.length),
      forbidden_terms: [{ value: marker, match: 'word' }],
      binary_reviews: [],
    }),
  );
  return root;
}

function checkAt(
  root: string,
  artifactRoot: string,
  manifestName: string,
  receiptName: string,
): Readonly<{ status: number | null; stderr: string }> {
  const result = spawnSync(
    process.execPath,
    [
      checker,
      join(root, 'build'),
      artifactRoot,
      join(root, 'extractions.json'),
      join(root, 'policy.json'),
      join(root, 'extractor.py'),
      join(root, 'inspector.Dockerfile'),
      join(root, 'deploy.yml'),
      join(root, 'recipient.pem'),
      join(root, 'image-ref'),
      join(root, 'image-id'),
      join(root, 'image-tar-sha256'),
      join(root, 'source.tar'),
      join(root, manifestName),
      join(root, receiptName),
      'a'.repeat(40),
      '123-1',
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  return { status: result.status, stderr: result.stderr.toString() };
}

function check(root: string): Readonly<{ status: number | null; stderr: string }> {
  return checkAt(root, join(root, 'build', 'dist'), 'manifest.json', 'receipt.json');
}

test('clean output records a deterministic complete tree manifest', () => {
  const root = fixture();
  try {
    const result = check(root);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    assert.deepEqual(
      manifest.files.map((file: { path: string }) => file.path),
      ['index.html'],
    );
    const receipt = JSON.parse(readFileSync(join(root, 'receipt.json'), 'utf8'));
    assert.equal(receipt.file_count, 1);
    assert.equal(receipt.verifier_sha256, verifierSha256(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('committed snapshot source passes without a content refresh cache', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'build', '.cache'), { recursive: true });
    const result = check(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private marker in Markdown and encoded output fails without logging the marker', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', 'src', 'input.md'), `Hidden ${marker} in Markdown.\n`);
    writeFileSync(join(root, 'build', 'dist', 'index.html'), '<html>Fixture%41lpha123</html>\n');
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing policy and changed verifier identity stop publication', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'policy.json'));
    assert.notEqual(check(root).status, 0);
    writeFileSync(
      join(root, 'policy.json'),
      JSON.stringify({
        schema: 1,
        policy_id: 'synthetic-local-test',
        owner: 'Synthetic reviewer',
        valid_until_utc: '2099-01-01T00:00:00Z',
        verifier_sha256: '0'.repeat(64),
        recipient_cert_sha256: createHash('sha256')
          .update(readFileSync(join(root, 'recipient.pem')))
          .digest('hex'),
        inspector_image_ref: imageRef,
        inspector_image_sha256: imageId.slice('sha256:'.length),
        forbidden_terms: [{ value: marker, match: 'word' }],
        binary_reviews: [],
      }),
    );
    assert.match(check(root).stderr, /verifier digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed private policy never appears in diagnostics', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'policy.json'), `{"private_value":"${marker}",broken}`);
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /private policy: invalid JSON or text encoding/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changing the policy-free extractor invalidates the verifier bundle', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'extractor.py'), `${readFileSync(join(root, 'extractor.py'), 'utf8')}\n# altered\n`);
    assert.match(check(root).stderr, /verifier digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compressed PNG metadata reaches the private term check', () => {
  const root = fixture();
  try {
    const png = join(root, 'build', 'dist', 'logo.png');
    const makePng = String.raw`
import pathlib, struct, sys, zlib
def chunk(kind, content):
    return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content))
header = struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)
hidden = b'Description\0\x01\x00\0\0' + zlib.compress(sys.argv[2].encode())
pixels = zlib.compress(b'\x00\xff\xff\xff\xff')
pathlib.Path(sys.argv[1]).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'iTXt', hidden) + chunk(b'IDAT', pixels) + chunk(b'IEND', b''))
`;
    const created = spawnSync('python3', ['-c', makePng, png, marker], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const bytes = readFileSync(png);
    assert.ok(!bytes.includes(marker));
    const parse = String.raw`
import pathlib, runpy, sys
module = runpy.run_path(sys.argv[1])
print(module['png_metadata'](pathlib.Path(sys.argv[2]).read_bytes()))
`;
    const parsed = spawnSync('python3', ['-c', parse, join(root, 'extractor.py'), png], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.ok(parsed.stdout.includes(marker));
    const digest = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(
      join(root, 'extractions.json'),
      JSON.stringify({
        schema: 1,
        images: [{ path: 'dist/logo.png', sha256: digest, ocr: '', metadata: parsed.stdout, ocr_status: 'checked' }],
        search_files: [],
      }),
    );
    const policy = JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
    policy.binary_reviews = [
      {
        path: 'logo.png',
        sha256: digest,
        reviewer: 'Synthetic reviewer',
        purpose: 'Fixture',
        scope: 'Synthetic image and metadata',
        destination: 'hideouts.io',
        valid_until_utc: '2099-01-01T00:00:00Z',
        visual_review: 'required',
        visual_reason: 'Synthetic fixture',
        metadata_review: 'required',
      },
    ];
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    const result = check(root);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained PNG manifests are parsed and screened at their exact reviewed digests', () => {
  const root = fixture();
  try {
    const destination = join(root, 'build', 'dist', 'branding', 'rvi-sentinel');
    mkdirSync(destination, { recursive: true });
    const images = retainedLogos.map((name) => {
      const source = fileURLToPath(new URL(`../public/branding/rvi-sentinel/${name}`, import.meta.url));
      const png = join(destination, name);
      copyFileSync(source, png);
      const parsed = parsePng(root, png);
      assert.equal(parsed.status, 0, parsed.stderr);
      assert.ok(parsed.stdout.includes('image/svg+xml'));
      assert.ok(parsed.stdout.includes('<svg'));
      return {
        path: `dist/branding/rvi-sentinel/${name}`,
        sha256: createHash('sha256').update(readFileSync(png)).digest('hex'),
        ocr: '',
        metadata: parsed.stdout,
        ocr_status: 'checked',
      };
    });
    assert.deepEqual(
      images.map((image) => image.sha256),
      [
        'ebedb1d4840bcb1ab95602310e18421da22d658aaff04248598bccf7034d12bd',
        'b6bed143b70c8a0f3406a556edf2f1a832bf97627651d3559998f6f09ac917e5',
      ],
    );
    writeFileSync(join(root, 'extractions.json'), JSON.stringify({ schema: 1, images, search_files: [] }));
    const policy = JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
    policy.binary_reviews = images.map((image) => ({
      path: image.path.slice('dist/'.length),
      sha256: image.sha256,
      reviewer: 'Synthetic reviewer',
      purpose: 'Retained publication fixture',
      scope: 'Exact image and inspected metadata',
      destination: 'hideouts.io',
      valid_until_utc: '2099-01-01T00:00:00Z',
      visual_review: 'required',
      visual_reason: 'Synthetic fixture',
      metadata_review: 'required',
    }));
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    assert.equal(check(root).status, 0);

    policy.forbidden_terms = [{ value: 'none', match: 'word' }];
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    assert.match(check(root).stderr, /Private artifact gate failed: prohibited=/);

    policy.forbidden_terms = [{ value: marker, match: 'word' }];
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    const changed = join(destination, retainedLogos[0]);
    changeManifestPng(changed, changed, 'lime');
    const changedParsed = parsePng(root, changed);
    assert.equal(changedParsed.status, 0, changedParsed.stderr);
    images[0] = {
      ...images[0],
      sha256: createHash('sha256').update(readFileSync(changed)).digest('hex'),
      metadata: changedParsed.stdout,
    };
    writeFileSync(join(root, 'extractions.json'), JSON.stringify({ schema: 1, images, search_files: [] }));
    assert.match(check(root).stderr, /Private artifact gate failed: .*unreviewed=/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manifest PNG inspection rejects broken checksums, box lengths, and embedded references', () => {
  const root = fixture();
  try {
    const source = fileURLToPath(new URL('../public/branding/rvi-sentinel/logo-on-dark.png', import.meta.url));
    const png = join(root, 'manifest.png');
    const original = readFileSync(source);
    const chunk = original.indexOf('caBX');
    assert.ok(chunk > 8);
    const size = original.readUInt32BE(chunk - 4);

    const checksum = Buffer.from(original);
    checksum[chunk + 4] ^= 1;
    writeFileSync(png, checksum);
    assert.notEqual(parsePng(root, png).status, 0);

    const malformed = Buffer.from(original);
    malformed.writeUInt32BE(7, chunk + 4);
    malformed.writeUInt32BE(crc32(malformed.subarray(chunk, chunk + 4 + size)), chunk + 4 + size);
    writeFileSync(png, malformed);
    assert.notEqual(parsePng(root, png).status, 0);

    changeManifestPng(source, png, 'url(');
    assert.notEqual(parsePng(root, png).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reviewed PNG pixel bytes do not count as text', () => {
  const root = fixture();
  try {
    const png = join(root, 'build', 'dist', 'pixel.png');
    const makePng = String.raw`
import pathlib, struct, sys, zlib
def chunk(kind, content):
    return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content))
header = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
pixels = zlib.compress(b'\x00Qx7', level=0)
pathlib.Path(sys.argv[1]).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', pixels) + chunk(b'IEND', b''))
`;
    const created = spawnSync('python3', ['-c', makePng, png], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const bytes = readFileSync(png);
    assert.ok(bytes.includes('Qx7'));
    const parse = String.raw`
import pathlib, runpy, sys
module = runpy.run_path(sys.argv[1])
print(module['png_metadata'](pathlib.Path(sys.argv[2]).read_bytes()))
`;
    const parsed = spawnSync('python3', ['-c', parse, join(root, 'extractor.py'), png], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    const digest = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(
      join(root, 'extractions.json'),
      JSON.stringify({
        schema: 1,
        images: [{ path: 'dist/pixel.png', sha256: digest, ocr: '', metadata: '', ocr_status: 'checked' }],
        search_files: [],
      }),
    );
    const policy = JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
    policy.forbidden_terms = [{ value: 'Qx7', match: 'substring' }];
    policy.binary_reviews = [
      {
        path: 'pixel.png',
        sha256: digest,
        reviewer: 'Synthetic reviewer',
        purpose: 'Fixture',
        scope: 'Synthetic pixel bytes',
        destination: 'hideouts.io',
        valid_until_utc: '2099-01-01T00:00:00Z',
        visual_review: 'required',
        visual_reason: 'Synthetic fixture',
        metadata_review: 'required',
      },
    ];
    writeFileSync(join(root, 'policy.json'), JSON.stringify(policy));
    const result = check(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('oversized compressed search payload fails in the policy-free extractor', () => {
  const root = fixture();
  try {
    const search = join(root, 'build', 'dist', 'large.pf_index');
    writeFileSync(search, gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1, 65)));
    const parse = String.raw`
import pathlib, runpy, sys
module = runpy.run_path(sys.argv[1])
module['search_record'](pathlib.Path(sys.argv[2]), 'large.pf_index', '0' * 64)
`;
    const result = spawnSync('python3', ['-c', parse, join(root, 'extractor.py'), search], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /search payload invalid or oversized/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('symlink and unsupported output stop publication', () => {
  const root = fixture();
  try {
    symlinkSync(join(root, 'build', 'src', 'input.md'), join(root, 'build', 'dist', 'linked.md'));
    assert.match(check(root).stderr, /symlink or non-regular entry rejected/);
    rmSync(join(root, 'build', 'dist', 'linked.md'));
    writeFileSync(join(root, 'build', 'dist', 'opaque.bin'), Buffer.from([0, 1, 2]));
    assert.match(check(root).stderr, /unsupported=1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source maps, SVG metadata, and retained content cache are inspected', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', 'dist', 'site.js.map'), JSON.stringify({ source: `Old ${marker} reference` }));
    writeFileSync(join(root, 'build', 'dist', 'badge.svg'), `<svg><metadata>${marker}</metadata></svg>`);
    writeFileSync(join(root, 'build', '.cache/github', 'stale.md'), `Cached ${marker} content`);
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=[1-9]/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public source outside the site directories is inspected', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', 'README.md'), `Public repository source with ${marker}.\n`);
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=[1-9]/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compressed public source is decoded before policy matching', () => {
  const root = fixture();
  try {
    const path = join(root, 'build', 'src', 'example.pf_fragment');
    const bytes = gzipSync(Buffer.from(marker));
    writeFileSync(path, bytes);
    writeFileSync(
      join(root, 'extractions.json'),
      JSON.stringify({
        schema: 1,
        images: [],
        search_files: [
          {
            path: 'src/example.pf_fragment',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            decoded_text: marker,
            status: 'text',
          },
        ],
      }),
    );
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=[1-9]/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compressed search payload cannot hide an embedded base64 URL', () => {
  const root = fixture();
  try {
    const decoded = `data:text/plain;base64,${Buffer.from(marker).toString('base64')}`;
    const bytes = gzipSync(Buffer.from(decoded));
    writeFileSync(join(root, 'build', 'dist', 'search.pf_fragment'), bytes);
    writeFileSync(
      join(root, 'extractions.json'),
      JSON.stringify({
        schema: 1,
        images: [],
        search_files: [
          {
            path: 'dist/search.pf_fragment',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            decoded_text: decoded,
            status: 'text',
          },
        ],
      }),
    );
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=0, unsupported=[1-9]/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('embedded base64 payloads are rejected in source and output', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', 'src', 'template.ts'), 'const image = `data:image/svg+xml;base64,${logo}`;\n');
    assert.equal(check(root).status, 0);
    rmSync(join(root, 'manifest.json'));
    rmSync(join(root, 'receipt.json'));
    const encoded = Buffer.from(marker).toString('base64');
    writeFileSync(
      join(root, 'build', 'dist', 'index.html'),
      `<a href="data:text/plain;name=${'a'.repeat(160)};base64,${encoded}">Download</a>`,
    );
    const result = check(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private artifact gate failed: prohibited=0, unsupported=[1-9]/);
    assert.ok(!result.stderr.includes(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fresh generated image inputs do not waive final image extraction', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', '.cache/github', 'input.png'), Buffer.from('unrelated fetched bytes'));
    assert.equal(check(root).status, 0);
    rmSync(join(root, 'manifest.json'));
    rmSync(join(root, 'receipt.json'));
    writeFileSync(join(root, 'build', 'dist', 'input.png'), Buffer.from('unrelated fetched bytes'));
    assert.match(check(root).stderr, /Private artifact gate failed: .*unsupported=[1-9]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PDF and archive output remain denied until supported extraction exists', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'build', 'dist', 'document.pdf'), Buffer.from('%PDF-1.4\n'));
    writeFileSync(join(root, 'build', 'dist', 'bundle.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    assert.match(check(root).stderr, /unsupported=2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file added after the first scan changes the unpacked manifest', () => {
  const root = fixture();
  try {
    assert.equal(check(root).status, 0);
    const unpacked = join(root, 'unpacked');
    mkdirSync(unpacked);
    copyFileSync(join(root, 'build', 'dist', 'index.html'), join(unpacked, 'index.html'));
    writeFileSync(join(unpacked, 'later.txt'), 'Unexpected post-package file');
    const result = checkAt(root, unpacked, 'unpacked-manifest.json', 'unpacked-receipt.json');
    assert.equal(result.status, 0, result.stderr);
    assert.notDeepEqual(readFileSync(join(root, 'manifest.json')), readFileSync(join(root, 'unpacked-manifest.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
