/** Check the exact deployable tree against a private, digest-bound publication policy. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type RecordValue = Readonly<Record<string, Json>>;
type Term = Readonly<{ value: string; match: 'word' | 'substring' }>;
type Review = Readonly<{
  path: string;
  sha256: string;
  reviewer: string;
  purpose: string;
  scope: string;
  destination: string;
  valid_until_utc: string;
  visual_review: 'required' | 'not_applicable';
  visual_reason: string;
  metadata_review: 'required' | 'not_applicable';
}>;
type Policy = Readonly<{
  schema: 1;
  policy_id: string;
  owner: string;
  valid_until_utc: string;
  verifier_sha256: string;
  recipient_cert_sha256: string;
  inspector_image_ref: string;
  inspector_image_sha256: string;
  forbidden_terms: readonly Term[];
  binary_reviews: readonly Review[];
}>;
type Fingerprint = Readonly<{ path: string; bytes: number; sha256: string }>;
type Findings = { forbidden: number; unsupported: number; unreviewed: number; malformed: number };

const TEXT_EXTENSIONS = new Set([
  '.astro',
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.map',
  '.md',
  '.mjs',
  '.pem',
  '.py',
  '.dockerfile',
  '.svg',
  '.ts',
  '.txt',
  '.webmanifest',
  '.xml',
  '.yaml',
  '.yml',
]);
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.webp']);
const ARCHIVE_EXTENSIONS = new Set(['.tar', '.tgz', '.zip']);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TREE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 20_000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const UTC_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
type ExtractedImage = Readonly<{
  path: string;
  sha256: string;
  ocr: string;
  metadata: string;
  ocr_status: 'checked' | 'manual';
}>;
type ExtractedSearchFile = Readonly<{
  path: string;
  sha256: string;
  decoded_text: string;
  status: 'text' | 'binary';
}>;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

function verifierDigest(parts: readonly Readonly<{ name: string; bytes: Buffer }>[]): string {
  const digest = createHash('sha256').update('site-verifier-v1\0');
  for (const part of parts) {
    digest
      .update(part.name)
      .update('\0')
      .update(String(part.bytes.length))
      .update('\0')
      .update(part.bytes)
      .update('\0');
  }
  return digest.digest('hex');
}

function object(value: Json | undefined, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label}: object required`);
  return value;
}

function string(record: RecordValue, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label}: ${field} must be nonempty`);
  return value;
}

function futureDate(value: string, label: string): string {
  if (!UTC_RE.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) {
    throw new TypeError(`${label}: future UTC time required`);
  }
  return value;
}

function safeRelativePath(value: string, label: string): string {
  if (
    !value ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label}: safe relative path required`);
  }
  return value;
}

function readPolicy(value: Json, verifierSha256: string): Policy {
  const policy = object(value, 'private policy');
  if (policy.schema !== 1) throw new TypeError('private policy: unsupported schema');
  const id = string(policy, 'policy_id', 'private policy');
  const owner = string(policy, 'owner', 'private policy');
  const expiry = futureDate(string(policy, 'valid_until_utc', 'private policy'), 'private policy');
  if (policy.verifier_sha256 !== verifierSha256) throw new Error('private policy: verifier digest mismatch');
  for (const field of ['recipient_cert_sha256', 'inspector_image_sha256']) {
    const value = policy[field];
    if (typeof value !== 'string' || !SHA256_RE.test(value))
      throw new TypeError(`private policy: ${field} must be lowercase SHA-256`);
  }
  if (
    typeof policy.inspector_image_ref !== 'string' ||
    !/^ghcr\.io\/hideouts-io\/site-artifact-inspector@sha256:[a-f0-9]{64}$/.test(policy.inspector_image_ref)
  )
    throw new TypeError('private policy: immutable inspector image reference required');
  if (!Array.isArray(policy.forbidden_terms) || policy.forbidden_terms.length === 0) {
    throw new TypeError('private policy: nonempty forbidden_terms required');
  }
  const terms = policy.forbidden_terms.map((entry, index): Term => {
    const term = object(entry, `forbidden_terms[${index}]`);
    const word = string(term, 'value', `forbidden_terms[${index}]`);
    if (word.length > 256 || (term.match !== 'word' && term.match !== 'substring')) {
      throw new TypeError(`forbidden_terms[${index}]: invalid term or match mode`);
    }
    return { value: word, match: term.match };
  });
  if (!Array.isArray(policy.binary_reviews)) throw new TypeError('private policy: binary_reviews array required');
  const reviews = policy.binary_reviews.map((entry, index): Review => {
    const review = object(entry, `binary_reviews[${index}]`);
    const path = safeRelativePath(string(review, 'path', 'binary review'), 'binary review path');
    const digest = string(review, 'sha256', 'binary review');
    if (!SHA256_RE.test(digest)) throw new TypeError('binary review: lowercase SHA-256 required');
    const visual = review.visual_review;
    if (visual !== 'required' && visual !== 'not_applicable')
      throw new TypeError('binary review: visual_review required');
    const metadata = review.metadata_review;
    if (metadata !== 'required' && metadata !== 'not_applicable')
      throw new TypeError('binary review: metadata_review required');
    const reason = string(review, 'visual_reason', 'binary review');
    return {
      path,
      sha256: digest,
      reviewer: string(review, 'reviewer', 'binary review'),
      purpose: string(review, 'purpose', 'binary review'),
      scope: string(review, 'scope', 'binary review'),
      destination: string(review, 'destination', 'binary review'),
      valid_until_utc: futureDate(string(review, 'valid_until_utc', 'binary review'), 'binary review'),
      visual_review: visual,
      visual_reason: reason,
      metadata_review: metadata,
    };
  });
  if (new Set(reviews.map((review) => review.path)).size !== reviews.length) {
    throw new TypeError('private policy: duplicate binary review path');
  }
  return {
    schema: 1,
    policy_id: id,
    owner,
    valid_until_utc: expiry,
    verifier_sha256: verifierSha256,
    recipient_cert_sha256: string(policy, 'recipient_cert_sha256', 'private policy'),
    inspector_image_ref: string(policy, 'inspector_image_ref', 'private policy'),
    inspector_image_sha256: string(policy, 'inspector_image_sha256', 'private policy'),
    forbidden_terms: terms,
    binary_reviews: reviews,
  };
}

function normalizedVariants(value: string): readonly string[] {
  const common = (text: string): string => text.normalize('NFKC').toLocaleLowerCase('en-US');
  const entities = value
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (match, digits: string) => {
      const point =
        digits[0].toLowerCase() === 'x' ? Number.parseInt(digits.slice(1), 16) : Number.parseInt(digits, 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      return named[entity.toLowerCase()];
    });
  const escaped = entities.replace(
    /\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
    (match, braced: string | undefined, wide: string | undefined, narrow: string | undefined) => {
      const point = Number.parseInt(braced ?? wide ?? narrow ?? '', 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : match;
    },
  );
  const percent = escaped.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
  return [common(value), common(entities), common(escaped), common(percent)];
}

function prohibited(value: string, terms: readonly Term[]): boolean {
  const variants = normalizedVariants(value);
  for (const term of terms) {
    const needle = term.value.normalize('NFKC').toLocaleLowerCase('en-US');
    const expression =
      term.match === 'word'
        ? new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u')
        : null;
    if (variants.some((variant) => (expression ? expression.test(variant) : variant.includes(needle)))) return true;
  }
  return false;
}

function containsEmbeddedBase64(value: string): boolean {
  return normalizedVariants(value).some((variant) => /data:[^,\s"'<>]*;base64,[a-z0-9+/=]+/i.test(variant));
}

function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le', { fatal: true }).decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be', { fatal: true }).decode(data.subarray(2));
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

async function walk(root: string, excludedTopLevel: readonly string[]): Promise<readonly string[]> {
  const files: string[] = [];
  let totalBytes = 0;
  async function descend(folder: string, topLevel: boolean): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (topLevel && excludedTopLevel.includes(entry.name)) continue;
      const path = join(folder, entry.name);
      const info = await lstat(path);
      if (info.isDirectory()) await descend(path, false);
      else if (info.isFile()) {
        if (info.size > MAX_FILE_BYTES) throw new Error('artifact inspection: individual file size limit exceeded');
        totalBytes += info.size;
        if (totalBytes > MAX_TREE_BYTES || files.length >= MAX_FILES)
          throw new Error('artifact inspection: total size or file count limit exceeded');
        files.push(path);
      } else throw new Error('artifact inspection: symlink or non-regular entry rejected');
    }
  }
  await descend(root, true);
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

type Context = Readonly<{
  policy: Policy;
  reviews: ReadonlyMap<string, Review>;
  images: ReadonlyMap<string, ExtractedImage>;
  searchFiles: ReadonlyMap<string, ExtractedSearchFile>;
  findings: Findings;
}>;

async function inspectFile(file: string, displayPath: string, context: Context, output: boolean): Promise<Fingerprint> {
  const data = await readFile(file);
  const digest = sha256(data);
  const extension = extname(file).toLowerCase();
  const extractionPath = output ? `dist/${displayPath}` : displayPath;
  const extractedImage = context.images.get(extractionPath);
  const structuredRaster =
    (extension === '.png' || extension === '.webp') &&
    !extractionPath.startsWith('.cache/github/') &&
    extractedImage?.sha256 === digest &&
    extractedImage.ocr_status === 'checked';
  if (
    prohibited(displayPath, context.policy.forbidden_terms) ||
    (!structuredRaster &&
      (prohibited(data.toString('latin1'), context.policy.forbidden_terms) ||
        prohibited(data.toString('utf16le'), context.policy.forbidden_terms)))
  ) {
    context.findings.forbidden++;
  }
  let needsReview = IMAGE_EXTENSIONS.has(extension) || extension === '.pdf' || ARCHIVE_EXTENSIONS.has(extension);
  try {
    if (TEXT_EXTENSIONS.has(extension) || !extension) {
      const decoded = decodeText(data);
      if (prohibited(decoded, context.policy.forbidden_terms)) context.findings.forbidden++;
      if (containsEmbeddedBase64(decoded)) context.findings.unsupported++;
    } else if (extension.startsWith('.pf_') || extension === '.pagefind') {
      const extracted = context.searchFiles.get(extractionPath);
      if (!extracted || extracted.sha256 !== digest) context.findings.unsupported++;
      else {
        if (prohibited(extracted.decoded_text, context.policy.forbidden_terms)) context.findings.forbidden++;
        if (containsEmbeddedBase64(extracted.decoded_text)) context.findings.unsupported++;
        if (extracted.status === 'binary') {
          if (output) needsReview = true;
          else context.findings.unsupported++;
        }
      }
    } else if (IMAGE_EXTENSIONS.has(extension)) {
      if (!extractionPath.startsWith('.cache/github/')) {
        if (
          !extractedImage ||
          extractedImage.sha256 !== digest ||
          (extension !== '.ico' && extractedImage.ocr_status !== 'checked')
        ) {
          context.findings.unsupported++;
        } else if (
          prohibited(extractedImage.ocr, context.policy.forbidden_terms) ||
          prohibited(extractedImage.metadata, context.policy.forbidden_terms)
        ) {
          context.findings.forbidden++;
        }
        if (
          extractedImage &&
          (containsEmbeddedBase64(extractedImage.ocr) || containsEmbeddedBase64(extractedImage.metadata))
        )
          context.findings.unsupported++;
      }
    } else if (extension === '.pdf' || ARCHIVE_EXTENSIONS.has(extension)) {
      // These formats are denied until extraction can be isolated and complete.
      context.findings.unsupported++;
    } else context.findings.unsupported++;
  } catch {
    context.findings.unsupported++;
  }
  if (output && needsReview) {
    const review = context.reviews.get(displayPath);
    const image = IMAGE_EXTENSIONS.has(extension);
    if (
      !review ||
      review.sha256 !== digest ||
      review.destination !== 'hideouts.io' ||
      (image && (review.visual_review !== 'required' || review.metadata_review !== 'required'))
    ) {
      context.findings.unreviewed++;
    }
  }
  return { path: displayPath, bytes: data.length, sha256: digest };
}

async function main(): Promise<void> {
  const [
    buildRootArg,
    artifactRootArg,
    extractionArg,
    policyArg,
    extractorArg,
    dockerfileArg,
    workflowArg,
    certArg,
    imageRefArg,
    imageIdArg,
    imageTarShaArg,
    sourceArchiveArg,
    manifestArg,
    receiptArg,
    sourceCommit,
    runAttempt,
  ] = process.argv.slice(2);
  if (
    process.argv.length !== 18 ||
    !buildRootArg ||
    !artifactRootArg ||
    !extractionArg ||
    !policyArg ||
    !extractorArg ||
    !dockerfileArg ||
    !workflowArg ||
    !certArg ||
    !imageRefArg ||
    !imageIdArg ||
    !imageTarShaArg ||
    !sourceArchiveArg ||
    !manifestArg ||
    !receiptArg ||
    !sourceCommit ||
    !runAttempt
  ) {
    throw new TypeError(
      'Usage: node check-private-artifact.ts BUILD_ROOT ARTIFACT_ROOT EXTRACTIONS POLICY EXTRACTOR DOCKERFILE WORKFLOW CERT IMAGE_REF IMAGE_ID IMAGE_TAR_SHA SOURCE_ARCHIVE MANIFEST RECEIPT SOURCE_COMMIT RUN_ATTEMPT',
    );
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || !/^[1-9]\d*-[1-9]\d*$/.test(runAttempt))
    throw new TypeError('source commit or run attempt identity invalid');
  const buildRoot = resolve(buildRootArg);
  const artifactRoot = resolve(artifactRootArg);
  const policyBytes = await readFile(policyArg);
  const verifierBytes = await readFile(fileURLToPath(import.meta.url));
  const extractorBytes = await readFile(extractorArg);
  const dockerfileBytes = await readFile(dockerfileArg);
  const workflowBytes = await readFile(workflowArg);
  const certBytes = await readFile(certArg);
  const imageRef = (await readFile(imageRefArg, 'utf8')).trim();
  const imageId = (await readFile(imageIdArg, 'utf8')).trim();
  const imageTarSha256 = (await readFile(imageTarShaArg, 'utf8')).trim();
  if (!/^ghcr\.io\/hideouts-io\/site-artifact-inspector@sha256:[a-f0-9]{64}$/.test(imageRef))
    throw new TypeError('inspector image reference invalid');
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new TypeError('inspector image identity invalid');
  if (!SHA256_RE.test(imageTarSha256)) throw new TypeError('inspector tar identity invalid');
  const bundleSha256 = verifierDigest([
    { name: 'checker', bytes: verifierBytes },
    { name: 'extractor', bytes: extractorBytes },
    { name: 'dockerfile', bytes: dockerfileBytes },
    { name: 'workflow', bytes: workflowBytes },
    { name: 'recipient-cert', bytes: certBytes },
  ]);
  let parsed: Json;
  try {
    parsed = JSON.parse(decodeText(policyBytes));
  } catch {
    throw new TypeError('private policy: invalid JSON or text encoding');
  }
  const policy = readPolicy(parsed, bundleSha256);
  if (
    policy.recipient_cert_sha256 !== sha256(certBytes) ||
    policy.inspector_image_ref !== imageRef ||
    policy.inspector_image_sha256 !== imageId.slice('sha256:'.length)
  )
    throw new Error('private policy: release dependency identity mismatch');
  const sourceArchiveSha256 = await sha256File(sourceArchiveArg);
  let extracted: Json;
  try {
    const extractionInfo = await lstat(extractionArg);
    if (!extractionInfo.isFile() || extractionInfo.size > MAX_TREE_BYTES)
      throw new TypeError('artifact extraction: invalid size or file type');
    extracted = JSON.parse(decodeText(await readFile(extractionArg)));
  } catch {
    throw new TypeError('artifact extraction: invalid JSON or text encoding');
  }
  const extraction = object(extracted, 'artifact extraction');
  if (
    extraction.schema !== 1 ||
    !Array.isArray(extraction.images) ||
    !Array.isArray(extraction.search_files) ||
    extraction.images.length + extraction.search_files.length > MAX_FILES
  )
    throw new TypeError('artifact extraction: invalid schema or file count');
  const images = new Map<string, ExtractedImage>();
  for (const item of extraction.images) {
    const image = object(item, 'artifact image extraction');
    const path = safeRelativePath(string(image, 'path', 'artifact image extraction'), 'artifact image path');
    const digest = string(image, 'sha256', 'artifact image extraction');
    if (
      images.has(path) ||
      !SHA256_RE.test(digest) ||
      typeof image.ocr !== 'string' ||
      typeof image.metadata !== 'string' ||
      image.ocr.length > MAX_FILE_BYTES ||
      image.metadata.length > MAX_FILE_BYTES ||
      (image.ocr_status !== 'checked' && image.ocr_status !== 'manual')
    ) {
      throw new TypeError('artifact extraction: invalid image record');
    }
    images.set(path, { path, sha256: digest, ocr: image.ocr, metadata: image.metadata, ocr_status: image.ocr_status });
  }
  const searchFiles = new Map<string, ExtractedSearchFile>();
  for (const item of extraction.search_files) {
    const entry = object(item, 'artifact search extraction');
    const path = safeRelativePath(string(entry, 'path', 'artifact search extraction'), 'artifact search path');
    const digest = string(entry, 'sha256', 'artifact search extraction');
    const decoded = entry.decoded_text;
    const status = entry.status;
    if (
      searchFiles.has(path) ||
      !SHA256_RE.test(digest) ||
      (status !== 'text' && status !== 'binary') ||
      typeof decoded !== 'string' ||
      decoded.length > MAX_FILE_BYTES
    ) {
      throw new TypeError('artifact extraction: invalid search record');
    }
    searchFiles.set(path, { path, sha256: digest, decoded_text: decoded, status });
  }
  const reviews = new Map(policy.binary_reviews.map((review) => [review.path, review]));
  const findings: Findings = { forbidden: 0, unsupported: 0, unreviewed: 0, malformed: 0 };
  const context: Context = { policy, reviews, images, searchFiles, findings };
  const sourceFiles = await walk(buildRoot, ['dist']);
  const inspectedPaths = new Set<string>();
  for (const file of sourceFiles) {
    const path = relative(buildRoot, file).split(sep).join('/');
    inspectedPaths.add(path);
    await inspectFile(file, path, context, false);
  }
  const outputFiles = await walk(artifactRoot, []);
  if (!outputFiles.length) throw new Error('artifact inspection: empty output');
  const manifest: Fingerprint[] = [];
  for (const file of outputFiles) {
    const path = relative(artifactRoot, file).split(sep).join('/');
    inspectedPaths.add(`dist/${path}`);
    manifest.push(await inspectFile(file, path, context, true));
  }
  const outputByPath = new Map(manifest.map((file) => [file.path, file]));
  for (const file of sourceFiles) {
    const path = relative(buildRoot, file).split(sep).join('/');
    if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    if (path.startsWith('public/')) {
      const output = outputByPath.get(path.slice('public/'.length));
      if (!output || output.sha256 !== (await sha256File(file))) findings.unreviewed++;
    } else if (!path.startsWith('.cache/github/')) findings.unsupported++;
  }
  for (const review of reviews.values()) {
    if (!manifest.some((file) => file.path === review.path && file.sha256 === review.sha256)) findings.unreviewed++;
  }
  for (const extractionPath of [...images.keys(), ...searchFiles.keys()]) {
    if (!inspectedPaths.has(extractionPath)) findings.unsupported++;
  }
  if (Object.values(findings).some((count) => count)) {
    throw new Error(
      `Private artifact gate failed: prohibited=${findings.forbidden}, unsupported=${findings.unsupported}, unreviewed=${findings.unreviewed}, malformed=${findings.malformed}`,
    );
  }
  const manifestBytes = Buffer.from(`${JSON.stringify({ schema: 1, files: manifest })}\n`);
  const manifestSha256 = sha256(manifestBytes);
  await writeFile(manifestArg, manifestBytes, { flag: 'wx', mode: 0o600 });
  const receipt = {
    schema: 1,
    policy_id: policy.policy_id,
    policy_sha256: sha256(policyBytes),
    verifier_sha256: bundleSha256,
    inspector_image_sha256: imageId,
    inspector_image_ref: imageRef,
    inspector_tar_sha256: imageTarSha256,
    recipient_cert_sha256: sha256(certBytes),
    source_archive_sha256: sourceArchiveSha256,
    source_commit: sourceCommit,
    run_attempt: runAttempt,
    tree_manifest_sha256: manifestSha256,
    file_count: manifest.length,
    reviewed_binary_count: reviews.size,
  };
  await writeFile(receiptArg, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(
    `Private artifact gate passed: ${manifest.length} regular files; policy, verifier, source and tree digests bound.`,
  );
}

await main();
