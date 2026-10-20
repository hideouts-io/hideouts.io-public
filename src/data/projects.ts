/**
 * The allowlist. These are the ONLY repositories the site may fetch or render.
 * A repository that is not listed here never appears on hideouts.io, including
 * repositories created later. `scripts/check-allowlist.ts` enforces this on
 * every build.
 *
 * Each entry doubles as the curation overlay: name, tagline, summary, and
 * highlights are written by hand; everything else (description, stars, license,
 * release, README) is pulled from GitHub at build time.
 */

export const GITHUB_OWNER = 'hideouts-io';

export type Kind = 'app' | 'research';
/**
 * Where a project runs (or, for iOS, which devices it works with).
 * Windows, Linux, and ChromeOS are host platforms for cross-platform tools.
 */
export type Platform = 'macOS' | 'iOS' | 'Windows' | 'Linux' | 'ChromeOS';
/** Hosts other than macOS; collapsed into one "Cross-platform" chip on cards. */
export const OTHER_HOSTS: Platform[] = ['Windows', 'Linux', 'ChromeOS'];

/** What a project is for. Only categories the repositories actually support. */
export const CATEGORIES = {
  security: { label: 'Security posture', blurb: 'Scan and harden a Mac, and see what software is signed to do.' },
  forensics: {
    label: 'Forensics & evidence',
    blurb: 'Collect, hash, and preserve evidence from Macs and iOS devices.',
  },
  networking: { label: 'Network analysis', blurb: 'Capture device traffic and control which interfaces can connect.' },
  diagnostics: { label: 'Diagnostics', blurb: 'Understand hardware, storage, and system state without changing it.' },
  developer: { label: 'Developer tools', blurb: 'Work with iPhone and iPad developer services from a Mac.' },
  utilities: { label: 'Utilities', blurb: 'Small native tools for everyday Mac work.' },
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Project {
  slug: string;
  repo: string;
  kind: Kind;
  platforms: Platform[];
  /** Apps only: used for filtering, grouping, and related projects. */
  categories?: Category[];
  name: string;
  tagline: string;
  summary: string;
  highlights?: string[];
  /** What the app needs to run, as the README states it (shown next to the download). */
  requires?: string[];
  /** Code-signing status, as the README states it. Shown next to downloads. */
  signing?: string;
  /** Releases carry GitHub build-provenance attestations (`gh attestation verify`). */
  attested?: boolean;
  /** Short trust signals shown as badges. Only claims the README states. */
  traits?: string[];
  featured?: boolean;
  order: number;
  /**
   * Repo-relative path to the project's logo, for when the README doesn't show one
   * (e.g. 'assets/logo.png'). Overrides any logo found in the README.
   */
  logo?: string;
  /** Site-local project icon used before repository branding is published. */
  siteLogo?: { src: string; shaped: boolean };
  /** Site-local Open Graph image for approved project artwork. */
  socialImage?: string;
  socialImageDimensions?: { width: number; height: number };
  /** Project-specific browser icons for an individual app page. */
  siteFavicon?: { ico: string; png32: string; appleTouch: string };
  /** Project-specific web icon manifest for an individual app page. */
  siteManifest?: string;
  /** Responsive site-local hero artwork for an individual project page. */
  heroImage?: {
    desktop: string;
    tablet: string;
    mobile: string;
    alt: string;
    dimensions?: { width: number; height: number };
    light?: { desktop: string; tablet: string; mobile: string };
  };
  /** Approved artwork displayed above an app's catalog card. */
  cardImage?: { dark: string; light: string; alt: string };
  /** Real app captures curated for an individual project page. */
  siteScreenshots?: { src: string; srcset?: string; alt: string; width: number; height: number }[];
  /** Explicit published release to feature, including a prerelease; otherwise use GitHub's latest stable. */
  releaseTag?: string;
  /** README sections (heading text) to leave off the site. The README itself is untouched. */
  stripSections?: string[];
  /**
   * Earlier names of the repository. GitHub redirects them, so README text that
   * still uses an old name refers to this project, not an unlisted repo.
   */
  formerNames?: string[];
  /** Other editions of the same tool (e.g. Python and Swift), by slug, with a one-line note. */
  editions?: { slug: string; note: string }[];
  /**
   * Research only: the "Key findings" box above the write-up. Each point must be
   * stated in the README; keep observation and interpretation as the README does.
   * `code` in backticks renders as code.
   */
  findings?: string[];
  /** Research only: one-sentence conclusion shown under the findings, as the README concludes. */
  bottomLine?: string;
  /** Research only: shortcuts to README sections, by heading id (the build fails if one doesn't exist). */
  jumpTo?: { label: string; id: string }[];
}

export const PROJECTS: Project[] = [
  // ─── Applications · iOS ────────────────────────────────────────────────
  {
    slug: 'ios-developer-toolkit',
    repo: 'iOS-Developer-Toolkit',
    kind: 'app',
    platforms: ['iOS', 'macOS'],
    categories: ['developer', 'forensics', 'diagnostics'],
    name: 'iOS Developer Toolkit',
    tagline: 'The all-in-one iPhone and iPad workbench for your Mac.',
    summary:
      'Mount Developer Disk Images, run guided pymobiledevice3 and DVT diagnostics, stream Unified Logs, capture packets, simulate locations, inspect IPAs, make encrypted backups, and build hashed evidence cases from one trusted connection.',
    highlights: [
      '12 focused workspaces, from Device & DDI to Evidence Capture',
      '49 guided commands with risk labels and exact argument previews',
      'Typed confirmation before any change to the device',
      'Evidence cases with coverage states and SHA-256 manifests',
    ],
    traits: ['Authorized use only', 'No shell passthrough', 'Checksummed releases'],
    featured: true,
    requires: ['macOS 13 or later', 'Apple silicon or Intel (separate downloads)'],
    signing: 'Ad-hoc signed · not notarized',
    attested: true,
    editions: [
      { slug: 'ios-developer-toolkit-swift', note: 'A native Swift rewrite that needs no Python or Homebrew.' },
    ],
    order: 1,
  },
  {
    slug: 'ios-developer-toolkit-swift',
    repo: 'iOS-Developer-Toolkit-Swift',
    kind: 'app',
    platforms: ['iOS', 'macOS'],
    categories: ['developer', 'forensics', 'diagnostics'],
    name: 'iOS Developer Toolkit (Swift)',
    tagline: 'The iPhone and iPad workbench, rebuilt as a native Mac app.',
    summary:
      'A native SwiftUI app and command-line tool for iPhones, iPads, and simulators: device details, readiness checks, live logs, location simulation, app installs, encrypted backups, packet capture, and hashed evidence cases, through macOS’s own device services.',
    highlights: [
      'No Python, no Homebrew packages, and no administrator rights',
      'A read-only Readiness Check with a next step for anything not ready',
      'Over 40 guided actions, each showing its risk and exactly how it runs',
      'Evidence Capture builds a case folder with a manifest and SHA-256 hashes',
    ],
    traits: ['Authorized use only', 'No shell', 'Physical-device testing in progress'],
    requires: ['macOS 14 or later', 'Apple silicon or Intel', 'Xcode for simulators and some developer features'],
    signing: 'Ad-hoc signed · not notarized',
    attested: true,
    editions: [{ slug: 'ios-developer-toolkit', note: 'The original Python app, built on pymobiledevice3.' }],
    order: 2,
  },
  {
    slug: 'rvi-sentinel',
    repo: 'RVI-Sentinel',
    kind: 'app',
    platforms: ['iOS', 'macOS', 'Windows', 'Linux', 'ChromeOS'],
    categories: ['networking', 'forensics'],
    name: 'RVI-Sentinel',
    tagline: 'iPhone packet capture with a memory for what changed.',
    summary:
      'Capture iPhone and iPad traffic on macOS through Apple’s Remote Virtual Interface, or on Windows, Linux, and ChromeOS through rvi_capture, then compare every session against a persistent network baseline with DNS entropy inspection.',
    highlights: [
      'Runs on macOS, Windows, Linux, and ChromeOS',
      'Works with any authorized .pcap or .pcapng file',
      'Persistent baseline shows new endpoints across sessions',
      'DNS entropy scoring for unusual domains',
    ],
    traits: ['Defensive'],
    requires: ['Python 3', 'tshark (Wireshark)'],
    siteLogo: { src: '/branding/rvi-sentinel/app-icon.png', shaped: true },
    socialImage: '/branding/rvi-sentinel/og-image.png',
    siteFavicon: {
      ico: '/branding/rvi-sentinel/favicon.ico',
      png32: '/branding/rvi-sentinel/favicon-32.png',
      appleTouch: '/branding/rvi-sentinel/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/rvi-sentinel/hero-desktop.webp',
      tablet: '/branding/rvi-sentinel/hero-tablet.webp',
      mobile: '/branding/rvi-sentinel/hero-mobile.webp',
      alt: 'RVI-Sentinel route monogram with abstract packet paths and endpoint nodes',
    },
    editions: [{ slug: 'rvi-sentinel-swift', note: 'A native macOS app with a guided capture workflow.' }],
    order: 3,
  },
  {
    slug: 'rvi-sentinel-swift',
    repo: 'RVI-Sentinel-Swift',
    kind: 'app',
    platforms: ['iOS', 'macOS'],
    categories: ['networking', 'forensics'],
    name: 'RVI-Sentinel for macOS',
    tagline: 'Guided iPhone and iPad packet capture, as a native Mac app.',
    summary:
      'A native SwiftUI edition of RVI-Sentinel. It walks you through Apple’s Remote Virtual Interface capture, validates and hashes the saved capture, explains the network metadata it can see, and keeps baselines that change only when you approve.',
    highlights: [
      'Guided capture that starts its timer only after live packets arrive',
      'Validates format, packet count, duration, and SHA-256 of every capture',
      'Endpoints, hostnames, protocols, and ports, with decoder coverage',
      'Baselines stay read-only until you add findings, with timestamped backups',
    ],
    traits: ['Defensive', 'Local-first'],
    requires: ['macOS 14 or later', 'Xcode', 'Wireshark (tshark and capinfos)', 'An iPhone or iPad for live capture'],
    siteLogo: { src: '/branding/rvi-sentinel-swift/app-icon.png', shaped: true },
    socialImage: '/branding/rvi-sentinel-swift/og-image.png',
    siteFavicon: {
      ico: '/branding/rvi-sentinel-swift/favicon.ico',
      png32: '/branding/rvi-sentinel-swift/favicon-32.png',
      appleTouch: '/branding/rvi-sentinel-swift/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/rvi-sentinel-swift/hero-desktop.webp',
      tablet: '/branding/rvi-sentinel-swift/hero-tablet.webp',
      mobile: '/branding/rvi-sentinel-swift/hero-mobile.webp',
      alt: 'RVI-Sentinel for macOS: the original route monogram with the Swift bird above the V, surrounded by abstract packet paths and local evidence cards',
    },
    editions: [
      { slug: 'rvi-sentinel', note: 'The cross-platform Python edition for macOS, Windows, Linux, and ChromeOS.' },
    ],
    order: 4,
  },
  {
    slug: 'rvi-correlator',
    repo: 'RVI-Correlator',
    kind: 'app',
    platforms: ['iOS', 'macOS'],
    categories: ['networking', 'forensics'],
    name: 'RVI + PKTAP Correlator',
    tagline: 'Put iPhone traffic, Mac packets, and Mac logs on one timeline.',
    summary:
      'A native Mac investigation companion to RVI-Sentinel. It captures or imports iPhone RVI packets, Mac PKTAP packets with process labels, and Unified Log events, then shows possible relationships between them with the evidence and uncertainty behind each one. Correlation is experimental: live capture has been exercised in one short session with a physical iPhone, and long-running capture is unverified.',
    highlights: [
      'One bounded session for iPhone RVI, Mac PKTAP, and a targeted Unified Log stream',
      'Imports existing captures, including RVI-Sentinel output',
      'Shared-service candidates and TCP peer review, each with competing explanations',
      'Original evidence saved locally with SHA-256 manifests',
    ],
    traits: ['Experimental', 'Local-first', 'Authorized use only'],
    siteLogo: { src: '/branding/rvi-correlator/app-icon.png', shaped: true },
    socialImage: '/branding/rvi-correlator/og-image.png',
    siteFavicon: {
      ico: '/branding/rvi-correlator/favicon.ico',
      png32: '/branding/rvi-correlator/favicon-32.png',
      appleTouch: '/branding/rvi-correlator/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/rvi-correlator/hero-desktop.webp',
      tablet: '/branding/rvi-correlator/hero-tablet.webp',
      mobile: '/branding/rvi-correlator/hero-mobile.webp',
      alt: 'RVI + PKTAP Correlator: three distinct evidence paths aligned by turquoise observation markers',
    },
    requires: [
      'macOS 14 or later',
      'a Swift 6 toolchain and Xcode with device support',
      'Wireshark (TShark)',
      'a paired iPhone on USB for live capture',
    ],
    order: 5,
  },

  // ─── Applications · macOS ──────────────────────────────────────────────
  {
    slug: 'macscope',
    repo: 'MacScope',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['security'],
    name: 'MacScope',
    tagline: 'Security posture and vulnerability scanning that changes nothing.',
    summary:
      'A read-only scanner for Apple Silicon Macs that correlates native macOS state, Apple security-release data, compliance checks, software inventory, and package vulnerabilities into evidence-preserving, SHA-256-verified reports.',
    highlights: [
      'SOFA, osquery, mSCP, Syft, and Grype in one scan',
      'XProtect and macOS patch-level assessment',
      'Offline HTML report with a findings library',
      'Separates direct observations from inference',
    ],
    traits: ['In development', 'Read-only', 'Apple silicon'],
    requires: ['Apple silicon Mac', 'Go, osquery, Syft, Grype (pinned versions)'],
    order: 5,
  },
  {
    slug: 'entitlementlens',
    repo: 'EntitlementLens',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['security', 'forensics'],
    name: 'EntitlementLens',
    siteLogo: { src: '/branding/entitlementlens/app-icon.png', shaped: true },
    socialImage: '/branding/entitlementlens/og-image.png',
    socialImageDimensions: { width: 1280, height: 640 },
    siteFavicon: {
      ico: '/branding/entitlementlens/favicon.ico',
      png32: '/branding/entitlementlens/favicon-32.png',
      appleTouch: '/branding/entitlementlens/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/entitlementlens/hero-desktop.webp',
      tablet: '/branding/entitlementlens/hero-tablet.webp',
      mobile: '/branding/entitlementlens/hero-mobile.webp',
      alt: 'EntitlementLens inspection lens with signed-code evidence cards for declared entitlements, code signatures, architecture slices, and coverage warnings',
      dimensions: { width: 1280, height: 640 },
    },
    tagline: 'See what signed code declares.',
    summary:
      'A native SwiftUI workbench for code-signature entitlements, per-architecture Mach-O evidence, embedded plists and strings, and build-scoped RunningBoard policy.',
    highlights: [
      'Per-architecture entitlements and CDHashes',
      'Optional deep carving of embedded plists and strings',
      'RunningBoard policy decoding',
      'Coverage view shows exactly what was and wasn’t scanned',
    ],
    traits: ['Early-stage', 'Static inspection', 'No third-party dependencies'],
    requires: ['macOS 14 or later', 'Xcode or Command Line Tools (Swift 6.2)'],
    signing: 'Builds with an ad-hoc signature · not notarized',
    order: 6,
  },
  {
    slug: 'interface-sentinel',
    repo: 'Interface-Sentinel',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['networking', 'security'],
    name: 'Interface Sentinel',
    tagline: 'Only the network interfaces you allow stay up.',
    summary:
      'A menu-bar app with a root LaunchDaemon that continuously enforces a network-interface allowlist, taking down any unexpected interface in real time.',
    highlights: [
      'Menu-bar control with a live status indicator',
      'Configurable enforcement interval',
      'Documented recovery and full uninstall',
      'Sends no telemetry',
    ],
    traits: ['Requires admin', 'No telemetry'],
    requires: ['macOS 13 or later', 'Administrator access'],
    signing: 'Builds with an ad-hoc signature · not notarized',
    order: 7,
  },
  {
    slug: 'system-profiler-explorer',
    repo: 'SystemProfilerExplorer',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['diagnostics'],
    name: 'System Profiler Explorer',
    tagline: 'Understand what your Mac reports about itself.',
    summary:
      'Turns Apple’s system_profiler output into organized, searchable findings with plain-language explanations, source provenance, and filters for privacy-sensitive values.',
    highlights: [
      'All supported system_profiler data types',
      'Eight subject tabs from Hardware to Security',
      'Flags values that may identify you',
      'Snapshots, comparison, and export',
    ],
    traits: ['Local-only', 'No account or analytics'],
    siteLogo: { src: '/branding/system-profiler-explorer/app-icon.png', shaped: true },
    socialImage: '/branding/system-profiler-explorer/og-image.png',
    siteFavicon: {
      ico: '/branding/system-profiler-explorer/favicon.ico',
      png32: '/branding/system-profiler-explorer/favicon-32.png',
      appleTouch: '/branding/system-profiler-explorer/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/system-profiler-explorer/hero-desktop.webp',
      tablet: '/branding/system-profiler-explorer/hero-tablet.webp',
      mobile: '/branding/system-profiler-explorer/hero-mobile.webp',
      alt: 'System Profiler Explorer Open Layers identity: organized information cards with clear findings',
    },
    requires: ['macOS 13 or later', 'Apple silicon or Intel'],
    signing: 'Ad-hoc signed · not notarized',
    order: 8,
  },
  {
    slug: 'volume-mount-troubleshooter',
    repo: 'VolumeMountTroubleshooter',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['diagnostics', 'utilities'],
    name: 'Volume Mount Troubleshooter',
    tagline: 'Diagnose and mount external drives without risking them.',
    summary:
      'A native utility for identifying external storage and explicitly inspecting, mounting read-only, or safely ejecting a volume, with APFS and FileVault detection and every command shown in a built-in console.',
    highlights: [
      'Read-only mounting for sensitive media',
      'APFS container and FileVault detection',
      'Disk Arbitration monitoring, SMART and USB evidence',
      'Redacted reports for sharing',
    ],
    traits: ['Non-destructive', 'No network access'],
    requires: ['macOS 13 or later', 'Apple silicon or Intel (universal)'],
    signing: 'Ad-hoc signed · not notarized',
    order: 9,
  },
  {
    slug: 'man-pages-catalog',
    repo: 'ManPagesCatalog',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['utilities', 'developer'],
    name: 'ManPagesCatalog',
    tagline: 'Your Mac’s manuals, within reach.',
    summary:
      'Discover installed manuals, search names and indexed full text, read native HTML documentation, and export individual PDFs. Standard and resumable Deep Scan report coverage and gaps; an optional terminal keeps reviewed command drafts beside the manual.',
    highlights: [
      'Standard and Deep Scan with pause, resume, and explicit coverage',
      'Global search, section/source filters, and separate in-page Find',
      'Readable manuals, source paths, aliases, versions, and PDF export',
      'Reviewed command drafts and an explicitly started embedded terminal',
    ],
    traits: ['Local search', 'No Python or Homebrew runtime'],
    requires: ['macOS 13 or later', 'Apple silicon or Intel (universal; Intel execution unverified)'],
    signing: 'Ad-hoc signed · not notarized',
    order: 10,
    logo: 'Branding/app/icon-dark-512.png',
    socialImage: '/branding/man-pages-catalog/og-image.png',
    releaseTag: 'v2.0.0-beta.1',
  },
  {
    slug: 'drivetrace',
    repo: 'DriveTrace',
    formerNames: ['drive-explorer-swift'],
    kind: 'app',
    platforms: ['macOS'],
    categories: ['forensics', 'utilities'],
    name: 'DriveTrace',
    tagline: 'See what’s in your Google Drive, and who changed it.',
    summary:
      'A native Mac explorer for Google Drive metadata: advanced search, the newest and largest files, storage charts, sharing details, and the actor and action evidence from the Drive Activity API, kept in a local index. Metadata access is the default; optional broader consent enables previews, downloads and confirmed Move to Trash.',
    highlights: [
      'Metadata and activity browsing, with optional downloads and confirmed Move to Trash',
      'Compound searches over a local index, including fields Google can’t query',
      'Activity evidence with source-labelled records and visible coverage gaps',
      'Browse the last observed folder hierarchy at any point in time',
    ],
    traits: ['Work in progress', 'Optional file management', 'No telemetry'],
    requires: ['macOS 14 or later', 'a Swift 6 toolchain to build', 'your own Google Cloud desktop OAuth client'],
    order: 11,
    logo: 'Sources/DriveTrace/Resources/drivetrace-icon.png',
  },

  {
    slug: 'sandbox-lens',
    repo: 'Sandbox-Lens',
    kind: 'app',
    platforms: ['macOS'],
    categories: ['developer', 'forensics'],
    name: 'Sandbox Lens',
    tagline: 'Inspect sandbox policy files and compare precise evidence.',
    summary:
      'A native, read-only macOS app that inventories readable sandbox profiles and compares their paths, SHA-256 hashes, metadata, and sourced provenance with build-specific references. Match, Different, Missing, and Additional groups keep file differences separate from claims about runtime behavior.',
    highlights: [
      'Inventory readable policy files, paths, and SHA-256 hashes',
      'Compare Match, Different, Missing, and Additional groups',
      'Inspect build-specific references and their provenance',
      'Read-only inspection without policy execution or enforcement',
    ],
    traits: ['Read-only', 'Static evidence', 'Local-only'],
    requires: ['macOS 13 or later', 'Apple silicon or Intel'],
    signing: 'Ad-hoc signed · not notarized',
    order: 13,
    logo: 'Assets/AppIcon.png',
    siteLogo: { src: '/branding/sandbox-lens/app-icon.png', shaped: true },
    socialImage: '/branding/sandbox-lens/open-graph-dark.png',
    socialImageDimensions: { width: 1200, height: 630 },
    siteManifest: '/branding/sandbox-lens/site.webmanifest',
    siteFavicon: {
      ico: '/branding/sandbox-lens/favicon.ico',
      png32: '/branding/sandbox-lens/favicon-32.png',
      appleTouch: '/branding/sandbox-lens/apple-touch-icon.png',
    },
    heroImage: {
      desktop: '/branding/sandbox-lens/hero-desktop-dark.webp',
      tablet: '/branding/sandbox-lens/hero-tablet-dark.webp',
      mobile: '/branding/sandbox-lens/hero-mobile-dark.webp',
      alt: 'Sandbox Lens logo with a real macOS 27.0 app capture and the four policy comparison groups',
      light: {
        desktop: '/branding/sandbox-lens/hero-desktop-light.webp',
        tablet: '/branding/sandbox-lens/hero-tablet-light.webp',
        mobile: '/branding/sandbox-lens/hero-mobile-light.webp',
      },
    },
    cardImage: {
      dark: '/branding/sandbox-lens/project-card-dark.webp',
      light: '/branding/sandbox-lens/project-card-light.webp',
      alt: 'Sandbox Lens logo with layered policy evidence',
    },
    siteScreenshots: [
      {
        src: '/branding/sandbox-lens/screenshot-overview.webp',
        alt: 'Real app capture: exact-build overview on macOS 27.0 (26A428)',
        width: 3248,
        height: 2120,
      },
      {
        src: '/branding/sandbox-lens/screenshot-profile-details.webp',
        alt: 'Real app capture: profile paths, hashes, and reference evidence',
        width: 2344,
        height: 1688,
      },
      {
        src: '/branding/sandbox-lens/screenshot-baseline-library.webp',
        alt: 'Real app capture: build-specific reference library and provenance',
        width: 2344,
        height: 1688,
      },
      {
        src: '/branding/sandbox-lens/screenshot-interpretation-guide.webp',
        alt: 'Real app capture: interpreting static file differences',
        width: 2344,
        height: 1688,
      },
    ],
  },
  // ─── Research ──────────────────────────────────────────────────────────
  {
    slug: 'suramdisk',
    repo: 'StarSecurity-SURamDisk',
    kind: 'research',
    platforms: ['macOS'],
    name: 'Inside Apple’s Software Update RAMDisk',
    tagline: 'T2 DFU restore, the ramrod pipeline, SSV sealing, and firmware Option ROMs.',
    summary:
      'Forensic and architectural study of the StarSecurityRome21G115 RAMDisk from macOS Monterey 12.6 (x86_64): boot and init, the ramrod restore engine, APFS Sealed System Volume Merkle sealing, Image4 and FDR trust, and controller firmware.',
    findings: [
      'The image is Apple’s restore RAMDisk for macOS Monterey 12.6 (build `21G115`) on Intel Macs with the T2 chip, and it runs entirely from memory.',
      'Apple’s `ramrod` restore engine builds and seals the system volume, and holds entitlements for direct access to the NVMe and SMC controllers.',
      '`PurpleReverseProxy` listens on localhost ports 1081, 1082, and 1084, consistent with talking to a host Mac over USB.',
      'It embeds firmware for SSD controllers, USB-C power controllers, DisplayPort bridges, and the Secure Enclave, consistent with re-flashing a Mac without a network connection.',
      'The image contains no user folders, credentials, or logs, and every executable is signed by Apple’s code-signing authority.',
    ],
    jumpTo: [
      { label: 'Executive summary', id: 'executive-summary' },
      { label: 'Reproduce it yourself', id: 'reproduction--inspection-guide' },
    ],
    order: 1,
  },
  {
    slug: 'ios-system-research',
    repo: 'iOS-System-Research',
    kind: 'research',
    platforms: ['iOS'],
    name: 'iOS System Research',
    tagline: 'Carrier profiles, OTAUpload, sysdiagnose, and unexplained MDM records.',
    summary:
      'Evidence-first investigations of iOS artifacts: T-Mobile and AT&T Passpoint profiles and evil-twin exposure, OTAUpload, LambdaTest references in a sysdiagnose, and Bushel / Jamf Now managed-configuration records on a personal phone.',
    findings: [
      'A personal iPhone’s managed-configuration history holds 10 removal records attributed to two Bushel (Jamf Now) sources, all at 2022-06-20 07:52 UTC.',
      'The removals support that those sources were once present, but the file has no matching install record and doesn’t show who enrolled the phone, or when.',
      'Of four carrier Wi-Fi profiles, two are valid unsigned XML and two are removal stubs that can’t be installed. None contains a certificate or proxy payload.',
      'EAP-AKA blocks the simple evil-twin attack on the T-Mobile profiles. The open `attwifi` profile maps most directly to the rogue access point threat.',
      'The carrier profiles, OTAUpload, and LambdaTest references are analyzed separately. None of them, on its own, shows unauthorized activity.',
    ],
    bottomLine:
      'If unauthorized MDM control existed, it could have been used to deliver a hostile network profile. The current artifacts establish neither that delivery nor an evil-twin connection.',
    jumpTo: [
      { label: 'Bushel / Jamf Now records', id: 'investigation-4--unexpected-bushel--jamf-now-records' },
      { label: 'What remains unproven', id: 'what-remains-unproven' },
      { label: 'Evil-twin exposure', id: 'investigation-5--carrier-wi-fi-profiles-and-evil-twin-exposure' },
      { label: 'Read-only audit code', id: 'read-only-audit-code' },
    ],
    order: 2,
  },
  {
    slug: 'apple-infrastructure',
    repo: 'Apple-Infrastructure-Research',
    kind: 'research',
    platforms: ['macOS'],
    name: 'Apple Networking & Cloud Infrastructure',
    tagline: 'What four minutes of Unified Logs reveal about Apple’s network.',
    summary:
      'Apple CDN and Akamai edges, iCloud Private Relay topology, QUIC and HTTP/3, Daiquiri backend metadata, and the hybrid cloud behind Apple services, reconstructed from a macOS log snapshot.',
    findings: [
      'Apple CDN and edge-delivery traffic in the December 2022 snapshot runs extensively through Akamai.',
      'The Private Relay configuration names Apple, Akamai, Cloudflare, and Fastly-related endpoints.',
      '`networkserviceproxy` logs Akamai token generation, activation, caching, and QUIC token handling.',
      'Backend responses identify `daiquiri/3.0.0`, and `x-daiquiri-instance` headers name both Kubernetes- and AWS-labelled service instances.',
    ],
    bottomLine:
      'Apple’s 2022 backend exposed a fairly detailed hybrid cloud architecture through HTTP response headers, while macOS maintained a multi-provider privacy-relay architecture.',
    jumpTo: [
      { label: 'Private Relay topology', id: 'private-relay-topology' },
      { label: 'Daiquiri backend', id: 'daiquiri-backend' },
      { label: 'Evidence handling', id: 'evidence-handling' },
    ],
    order: 3,
  },
  {
    slug: 'skywalkctl-guide',
    repo: 'skywalkctl-guide',
    kind: 'research',
    platforms: ['macOS'],
    name: 'The Unofficial skywalkctl Field Guide',
    tagline: 'Apple’s kernel networking subsystem, one command at a time.',
    summary:
      'A hands-on guide to macOS skywalkctl built from 175 sanitized, read-only invocations on macOS 26.4, with a safety map, full command reference, and expanded man page.',
    findings: [
      'Built from 175 elevated, read-only runs of Apple’s `/usr/sbin/skywalkctl` on macOS 26.4 (`25E246`), with identifying output sanitized.',
      'The Skywalk runtime held 37 providers, 31 nexus instances, and 25 channels.',
      'Retained flow rows are not the same as established sockets.',
      'Several commands misbehave on this build: JSON flow output has duplicate keys, `protons` rejects filters it advertises, and `status` reads a missing sysctl, so its “disabled” result is unreliable.',
      'Commands that change state were not run, and nothing in the results independently demonstrated compromise.',
    ],
    jumpTo: [
      { label: 'Safety map', id: 'safety-map' },
      { label: 'Ten-minute survey', id: 'start-here-a-ten-minute-read-only-survey' },
      { label: 'What the run found', id: 'what-the-complete-run-found' },
    ],
    order: 4,
  },
  {
    slug: 'optical-airgap-lab',
    repo: 'optical-airgap-lab',
    kind: 'research',
    platforms: ['macOS', 'iOS'],
    name: 'Optical Air-Gap Lab',
    tagline: 'Recovering near-invisible QR codes from an iPhone photo of a screen.',
    summary:
      'A closed-loop, offline reproduction of low-contrast optical signaling through an LCD, with a verified decode of a synthetic identifier from a real iPhone photograph.',
    order: 5,
    findings: [
      'A real, high-resolution iPhone photo of a MacBook display was reconstructed offline and decoded as the synthetic identifier `LAB-001`.',
      'The first physical capture didn’t decode automatically: the saved image was tightly cropped and had glare and debris on the display.',
      'A bounded binary format (at most 256 bytes, 14 per QR frame) passes an image-based multi-frame test with exact SHA-256 verification. A physical multi-frame camera trial is future work.',
      'At five decoded frames per second, 15 MiB would take about 1.12 million frames and 62 hours: a theoretical lower bound, not measured throughput.',
      'The lab collects no files, keystrokes, or credentials, and uses no network while rendering or recovering.',
    ],
    jumpTo: [
      { label: 'Scope and safety model', id: 'scope-and-safety-model' },
      { label: 'Quick start', id: 'quick-start' },
      { label: 'Feasibility model', id: 'fifteen-mib-feasibility-model' },
    ],
  },
  {
    slug: 'macos-install-security',
    repo: 'macos-install-security-research',
    kind: 'research',
    platforms: ['macOS'],
    name: 'macOS Install Security Research',
    tagline: 'Installer, recovery RAMDisk, firmware, and EFI forensics for macOS 26.6.2.',
    summary:
      'A partial research snapshot of macOS 26.6.2 (build 25G83): a retained install-data tree compared byte for byte with Apple’s distribution, then traced through ramrod, firmware helpers, EFI paths, NVRAM, and trust checks, with 100 finding records and their evidence limits.',
    findings: [
      'Of 1,191 original regular files in the retained staging tree, 1,187 match Apple’s official bytes exactly. Four presentation and index files have no exact counterpart.',
      'The RAMDisk has a configured ramrod launch path and a bounded sealing call chain. A `DoNotSeal` option can be serialized into `skip-sealing`, but the evidence doesn’t show that an unauthorized caller could set it, or that it was ever used.',
      'Firmware staging, `bless`, MultiUpdater, EFI path conversion, and NVRAM writes form a static request chain with separate authorization and firmware-acceptance boundaries.',
      'A proxy launch declaration names an executable that is absent from the examined RAMDisk. Neither it nor a control socket without an explicit loopback node shows an active listener or a compromise.',
      'OpenCore, a third-party bootloader, was used only as a format cross-check. Its installation or execution on the examined Mac is not established.',
    ],
    bottomLine:
      'This is a partial snapshot: 72 paths have bounded semantic review and 147,181 inventory objects remain pending. It does not certify the installed system or firmware as clean.',
    jumpTo: [
      { label: 'What the evidence establishes', id: 'what-the-evidence-establishes' },
      { label: 'How to read a finding', id: 'how-to-interpret-a-finding' },
      { label: 'Reproduce and review', id: 'reproduce-and-review' },
    ],
    order: 6,
  },
];

export const ALLOWED_REPOS = new Set(PROJECTS.map((p) => p.repo));

/** Earlier names of allowlisted repositories (renamed on GitHub, which redirects them). */
export const FORMER_REPO_NAMES = new Set(PROJECTS.flatMap((p) => p.formerNames ?? []));

/**
 * Account infrastructure, not projects: the shared community health files
 * (`.github`) and this website's own source. The site may link to them, but
 * they are never fetched or shown as projects.
 */
export const INFRA_REPOS = new Set(['.github', 'hideouts.io-public']);

export const apps = () => PROJECTS.filter((p) => p.kind === 'app').sort((a, b) => a.order - b.order);
export const research = () => PROJECTS.filter((p) => p.kind === 'research').sort((a, b) => a.order - b.order);
export const bySlug = (slug: string) => PROJECTS.find((p) => p.slug === slug);
export const byRepo = (repo: string) =>
  PROJECTS.find(
    (p) =>
      p.repo.toLowerCase() === repo.toLowerCase() || p.formerNames?.some((n) => n.toLowerCase() === repo.toLowerCase()),
  );
