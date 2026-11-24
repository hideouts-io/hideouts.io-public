/** Local-only catalog controller; complete source wire/tours are fetched on demand. */
import {LAYERS,allowedPath,validateManifest,validateRegistry,validateLayer,compileQuery,recordMatches,postingMatches,radioMatches,validatePciIndex,validatePciPostings,validateRadioPostings,validateCoverageChunk,coveragePostings,validateTour,validateLand,field,rawRecord,mercator} from './catalog-model.js';

/** @typedef {import('../preview/preview-types.js').JsonValue} JsonValue */
/** @typedef {import('../preview/preview-types.js').JsonObject} JsonObject */
/** @typedef {import('./catalog-model.js').CatalogRecord} CatalogRecord */
/** @typedef {import('./catalog-model.js').Manifest} Manifest */
/** @typedef {import('./catalog-model.js').Registry} Registry */
/** @typedef {import('./catalog-model.js').Query} Query */
/** @typedef {import('./catalog-model.js').Radio} Radio */
/** @typedef {import('./catalog-model.js').PciIndex} PciIndex */
/** @typedef {import('./catalog-model.js').Land} Land */
/** @typedef {import('./catalog-model.js').CameraFrame} CameraFrame */
/** @typedef {{x:number,y:number,span:number}} Viewport */
/** @typedef {{record:CatalogRecord,x:number,y:number}} MapPoint */

/** @param {string} id @returns {HTMLElement} */
function node(id) { const found = document.getElementById(id); if (!(found instanceof HTMLElement)) throw new Error(`The local catalog interface is missing #${id}. Restore the complete review bundle.`); return found; }
/** @param {string} id @returns {HTMLButtonElement} */
function button(id) { const found = node(id); if (!(found instanceof HTMLButtonElement)) throw new Error(`Catalog control #${id} must be a button.`); return found; }
/** @param {string} id @returns {HTMLSelectElement} */
function select(id) { const found = node(id); if (!(found instanceof HTMLSelectElement)) throw new Error(`Catalog control #${id} must be a selection.`); return found; }
/** @param {string} id @returns {HTMLInputElement} */
function input(id) { const found = node(id); if (!(found instanceof HTMLInputElement)) throw new Error(`Catalog control #${id} must be an input.`); return found; }
/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} className @param {string} text @returns {HTMLElementTagNameMap[K]} */
function make(tag,className,text) { const item = document.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; }
/** @param {string} text @param {() => void} action @param {string} testId @returns {HTMLButtonElement} */
function action(text,action,testId) { const item = make('button','secondary',text); item.type = 'button'; item.dataset.testid = testId; item.addEventListener('click',action); return item; }
/** @param {string} text @param {string} url @returns {HTMLAnchorElement} */
function link(text,url) { const item = make('a','',text); item.href = url; item.target = '_blank'; item.rel = 'noopener noreferrer'; item.referrerPolicy = 'no-referrer'; return item; }
/** @param {JsonValue|undefined} value @returns {string} */
function display(value) { return value === null || value === undefined ? 'Not supplied' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value); }
/** @param {string} label @param {string} value @returns {HTMLDivElement} */
function datum(label,value) { const item = make('div','',''); item.append(make('dt','',label),make('dd','',value)); return item; }
/** @param {string} title @param {JsonValue} value @returns {HTMLDetailsElement} */
function rawDetails(title,value) { const details = make('details','',''); details.append(make('summary','',title)); details.addEventListener('toggle',() => { if (details.open && !details.querySelector('pre')) details.append(make('pre','',JSON.stringify(value,null,2))); }); return details; }
/** @param {string} filename @param {JsonValue} value @returns {void} */
function download(filename,value) { const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2) + '\n'],{type:'application/json;charset=utf-8'})); const item = make('a','',''); item.href = url; item.download = filename; document.body.append(item); item.click(); item.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); }
/** @param {string} path @param {AbortSignal} signal @returns {Promise<JsonValue>} */
async function localJson(path,signal) {
  const filename = allowedPath(path);
  const response = await fetch(`../data/catalog/${filename}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit',cache:'no-store',redirect:'error'});
  if (!response.ok) throw new Error(`Local catalog file ${filename} returned HTTP ${response.status}. Restore that file from the review bundle; no substitute data is used.`);
  const length = Number(response.headers.get('content-length')); if (Number.isFinite(length) && length > 50000000) throw new Error(`Local catalog file ${filename} exceeds the 50 MB per-file limit.`);
  const text = await response.text(); if (text.length > 50000000) throw new Error(`Local catalog file ${filename} exceeds the 50 MB per-file limit.`);
  try { return JSON.parse(text); } catch { throw new Error(`Local catalog file ${filename} is not valid JSON. Restore the complete review bundle.`); }
}
/** @param {HTMLCanvasElement} canvas @returns {CanvasRenderingContext2D} */
function canvasContext(canvas) { const context = canvas.getContext('2d'); if (!context) throw new Error('The browser could not create the local 2D map. Use a browser with Canvas 2D support.'); return context; }
/** @param {CatalogRecord} record @returns {string} */
function identity(record) { if (field(record,'sentinel') === true) return `Unknown cell · raw sentinel ${display(field(record,'cellId'))}`; return record.nci !== null ? `NCI ${record.nci}` : record.eci !== null ? `ECI ${record.eci}` : record.name; }
/** @param {CatalogRecord} record @param {Registry} registry @returns {string} */
function carrierLabel(record,registry) { if (!record.carriers.length) return record.layer === 'documentedPlans' ? `Document label ${display(field(record,'plannedCarrierName'))}; no broadcast identity` : 'No cell-network identity supplied'; if (record.carriers.length > 1) return `${record.carriers.length} network codes · source context`; const code = record.carriers[0]; const carrier = registry.carriers.find(item => item.code === code); return `${carrier ? carrier.name : 'Assignment unresolved'} · ${code}`; }
/** @param {CatalogRecord[]} records @param {number} aspect @returns {Viewport|null} */
function fitViewport(records,aspect) {
  const positions = records.flatMap(record => record.lat !== null && record.lon !== null ? [mercator(record.lat,record.lon)] : []); if (!positions.length) return null;
  let lowX = Infinity; let highX = -Infinity; let lowY = Infinity; let highY = -Infinity;
  for (const position of positions) { lowX = Math.min(lowX,position.x); highX = Math.max(highX,position.x); lowY = Math.min(lowY,position.y); highY = Math.max(highY,position.y); }
  return {x:(lowX + highX) / 2,y:(lowY + highY) / 2,span:Math.max(.002,(highX - lowX) * 1.2,(highY - lowY) * aspect * 1.2)};
}
/** @param {string} value @returns {Radio} */
function asRadio(value) { if (value !== 'lte' && value !== 'nr') throw new Error('Invalid radio index request.'); return value; }

/** @param {Manifest} manifest @param {Registry} registry @param {PciIndex} pciIndex @param {CatalogRecord[]} records @param {Land} land @returns {void} */
function start(manifest,registry,pciIndex,records,land) {
  const canvasNode = node('map'); if (!(canvasNode instanceof HTMLCanvasElement)) throw new Error('The local geographic canvas is missing.'); const canvas = canvasNode; const context = canvasContext(canvas);
  const queryInput = input('query'); const layerSelect = select('layer'); const carrierSelect = select('carrier'); const radioSelect = select('radio');
  const specByLayer = new Map(manifest.layers.map(layer => [layer.id,layer]));
  const pageSize = 50;
  /** @type {CatalogRecord[]} */ let filtered = records;
  /** @type {CatalogRecord|null} */ let selected = null;
  /** @type {MapPoint[]} */ let visiblePoints = [];
  /** @type {CameraFrame[]} */ let cameraFrames = [];
  /** @type {Viewport} */ let view = {x:0,y:15,span:420};
  /** @type {AbortController|null} */ let currentSearch = null;
  /** @type {AbortController|null} */ let currentDetail = null;
  let searchSequence = 0;
  let page = 0;
  let framePending = false;
  let appliedText = '';
  let appliedQuery = compileQuery('','','','',registry);
  /** @type {{startX:number,startY:number,view:Viewport,moved:boolean}|null} */ let drag = null;
  /** @type {Readonly<Record<import('./catalog-model.js').LayerId,number>>} */
  const order = {coverage:0,lte:3,nr:4,outliers:8,flyover:6,flyoverCatalog:5,wifi:2,smallCells:1,registeredSites:1,independentLte:7,independentNr:7,documentedPlans:9};
  let drawRecords = [...filtered].sort((a,b) => order[a.layer] - order[b.layer]);

  /** @returns {void} */
  function drawLater() { if (framePending) return; framePending = true; requestAnimationFrame(() => { framePending = false; draw(); }); }
  /** @returns {void} */
  function draw() {
    const box = canvas.getBoundingClientRect(); const width = Math.max(1,box.width); const height = Math.max(1,box.height); canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2); context.setTransform(2,0,0,2,0,0);
    const styles = getComputedStyle(document.documentElement);
    /** @param {string} key @returns {string} */ const color = key => styles.getPropertyValue(key).trim();
    const scale = width / view.span;
    /** @param {number} x @returns {number} */ const toX = x => width / 2 + (x - view.x) * scale;
    /** @param {number} y @returns {number} */ const toY = y => height / 2 - (y - view.y) * scale;
    context.fillStyle = color('--ocean'); context.fillRect(0,0,width,height);
    context.beginPath();
    for (const ring of land) {
      let started = false; let lastX = 0;
      for (const point of ring) { const position = mercator(point.lat,point.lon); const x = toX(position.x); const y = toY(position.y); if (!started || Math.abs(position.x - lastX) > 180) { context.moveTo(x,y); started = true; } else context.lineTo(x,y); lastX = position.x; }
      context.closePath();
    }
    context.fillStyle = color('--land'); context.fill('evenodd'); context.strokeStyle = color('--line'); context.lineWidth = .5; context.stroke();
    const grid = view.span > 200 ? 60 : view.span > 40 ? 15 : view.span > 5 ? 2 : view.span > .5 ? .2 : view.span > .05 ? .02 : .002;
    context.strokeStyle = color('--line'); context.globalAlpha = .35; context.lineWidth = .7;
    for (let lon = Math.ceil((view.x - view.span / 2) / grid) * grid; lon <= view.x + view.span / 2; lon += grid) { const x = toX(lon); context.beginPath(); context.moveTo(x,0); context.lineTo(x,height); context.stroke(); }
    context.globalAlpha = 1;
    visiblePoints = [];
    for (const record of drawRecords) {
      if (record.lat === null || record.lon === null) continue;
      const position = mercator(record.lat,record.lon); const x = toX(position.x); const y = toY(position.y);
      if (x < -6 || x > width + 6 || y < -6 || y > height + 6) continue;
      visiblePoints.push({record,x,y});
      const resource = record.layer === 'flyover' || record.layer === 'flyoverCatalog'; const coverage = record.layer === 'coverage'; const infrastructure = record.layer === 'smallCells' || record.layer === 'registeredSites';
      context.fillStyle = resource ? color('--purple') : coverage || record.layer === 'outliers' ? color('--gold') : infrastructure ? color('--accent') : color('--blue');
      context.strokeStyle = context.fillStyle; context.globalAlpha = coverage ? .28 : record.layer === 'lte' ? .45 : .85;
      const size = resource ? record.layer === 'flyover' ? 4 : 2.8 : view.span < .2 ? 3 : 1.8;
      context.beginPath();
      if (coverage) context.rect(x - size,y - size,size * 2,size * 2);
      else if (resource) { context.moveTo(x,y - size * 1.4); context.lineTo(x + size,y); context.lineTo(x,y + size * 1.4); context.lineTo(x - size,y); context.closePath(); }
      else if (infrastructure) { context.moveTo(x,y - size * 1.4); context.lineTo(x + size * 1.2,y + size); context.lineTo(x - size * 1.2,y + size); context.closePath(); }
      else context.arc(x,y,size,0,Math.PI * 2);
      if (record.layer === 'independentLte' || record.layer === 'independentNr') { context.lineWidth = 2; context.stroke(); } else context.fill();
    }
    context.globalAlpha = 1;
    if (cameraFrames.length) {
      context.strokeStyle = color('--purple'); context.lineWidth = 2; context.beginPath();
      cameraFrames.forEach((frame,index) => { const position = mercator(frame.lat,frame.lon); if (index === 0) context.moveTo(toX(position.x),toY(position.y)); else context.lineTo(toX(position.x),toY(position.y)); }); context.stroke();
      for (const frame of cameraFrames) { const position = mercator(frame.lat,frame.lon); context.fillStyle = color('--purple'); context.beginPath(); context.arc(toX(position.x),toY(position.y),3,0,Math.PI * 2); context.fill(); }
    }
    const selectedKey = selected === null ? null : selected.key; const point = visiblePoints.find(item => item.record.key === selectedKey);
    if (point) { context.strokeStyle = color('--text'); context.lineWidth = 2; context.beginPath(); context.arc(point.x,point.y,9,0,Math.PI * 2); context.stroke(); }
    context.fillStyle = color('--text'); context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; context.fillText('↑ N',width - 40,23);
    const centerLatitude = Math.atan(Math.sinh(view.y * Math.PI / 180)) * 180 / Math.PI;
    const metresPerPixel = Math.cos(centerLatitude * Math.PI / 180) * 111195 * view.span / width;
    const target = metresPerPixel * Math.min(100,width / 3); const base = 10 ** Math.floor(Math.log10(target)); const metres = [1,2,5].map(multiplier => multiplier * base).filter(value => value <= target).pop() || base;
    const pixels = metres / metresPerPixel; context.strokeStyle = color('--text'); context.lineWidth = 2; context.beginPath(); context.moveTo(18,height - 20); context.lineTo(18 + pixels,height - 20); context.stroke(); context.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`,18,height - 30);
    const unmapped = filtered.filter(record => record.lat === null).length;
    node('map-caption').textContent = `${visiblePoints.length.toLocaleString('en-US')} source points in view · ${filtered.length.toLocaleString('en-US')} matching rows${unmapped ? ` · ${unmapped} unplotted` : ''}. Mercator display; source coordinates unchanged.${cameraFrames.length ? ` ${cameraFrames.length} virtual camera frames shown; not a movement track.` : ''}`;
    canvas.setAttribute('aria-label',`Geographic map with ${visiblePoints.length} visible source points and ${filtered.length} matching records. ${unmapped} unplotted documentary records. Every row is accessible in the record list. Arrow keys pan; plus and minus zoom.`);
  }
  /** @returns {void} */
  function list() {
    const container = node('list'); container.replaceChildren(); const rows = filtered.slice(page * pageSize,(page + 1) * pageSize);
    if (!rows.length) container.append(make('p','','No records match the applied search. Try a different full identity, carrier, place, or source layer. No full identity-to-PCI association is inferred from nearby grids.'));
    for (const record of rows) {
      const item = action('',() => openRecord(record),'catalog-record'); item.className = 'record'; item.dataset.recordKey = record.key; item.setAttribute('aria-pressed',String(selected !== null && selected.key === record.key));
      item.append(make('strong','',identity(record)),make('span','',specByLayer.get(record.layer)?.label || record.layer),make('span','',carrierLabel(record,registry)));
      const places = field(record,'derivedPlaceNames');
      const placeLabel = Array.isArray(places) ? places.filter(value => typeof value === 'string').join(', ') : '';
      const contextLabel = [record.tac === null ? '' : `TAC ${record.tac}`,placeLabel].filter(Boolean).join(' · ');
      if (contextLabel) item.append(make('span','',contextLabel));
      if (record.lat === null) item.append(make('span','','Unplotted · source coordinate role retained'));
      container.append(item);
    }
    node('count').textContent = `${filtered.length.toLocaleString('en-US')} / ${manifest.totalRecords.toLocaleString('en-US')} records · ${filtered.filter(record => record.lat === null).length} unplotted`;
    const pages = Math.max(1,Math.ceil(filtered.length / pageSize)); node('page').textContent = `${page + 1} / ${pages}`; button('previous').disabled = page === 0; button('next').disabled = page + 1 >= pages; button('download').disabled = filtered.length === 0;
  }
  /** @returns {void} */
  function emptyDetail() { const detail = node('detail'); const title = make('h3','','Choose a matching record to follow its evidence.'); title.id = 'detail-title'; detail.replaceChildren(title,make('p','','Full identities, coordinate meaning, source dates, and retained fields appear here. Coverage wire and virtual camera paths load only on request.')); delete detail.dataset.recordKey; }
  /** @param {CatalogRecord} record @returns {void} */
  function openRecord(record) { selected = record; cameraFrames = []; currentDetail?.abort(); currentDetail = new AbortController(); list(); detail(record,currentDetail.signal); drawLater(); node('detail').focus(); }
  /** @param {CatalogRecord} record @param {AbortSignal} signal @returns {void} */
  function detail(record,signal) {
    const panel = node('detail'); panel.replaceChildren(); panel.dataset.recordKey = record.key;
    const title = make('h3','',identity(record)); title.id = 'detail-title'; title.dataset.testid = 'catalog-detail-title';
    panel.append(title,make('p','',record.role),make('p','','Observation time: unknown / not supplied. A returned estimate, a resource anchor, and an administrative location are different claims. No independently verified full-identity-to-physical-site link is established.'));
    const fields = make('dl','',''); fields.append(datum('Source layer',specByLayer.get(record.layer)?.label || record.layer),datum('Latitude / longitude',record.lat === null || record.lon === null ? 'Unplotted; original source coordinate system retained' : `${record.lat}, ${record.lon}`),datum('Network label',carrierLabel(record,registry)),datum('Full NR NCI',record.nci || 'Not supplied'),datum('Full LTE ECI',record.eci || (field(record,'sentinel') === true ? 'Unknown-cell sentinel; not a valid ECI' : 'Not supplied')),datum('TAC',record.tac || 'Not supplied'),datum('Radio / channel',`${record.radio ? record.radio.toUpperCase() : 'Not supplied'} / ${record.channel || 'Not supplied'}`),datum('PCI assignment / raw value',record.pci === null ? 'Not supplied / unassigned' : `${record.pci}${record.layer === 'outliers' ? ' · raw outlier' : ''}`),datum('Source horizontal accuracy',field(record,'hAccMetres') === null ? 'Not supplied' : `${display(field(record,'hAccMetres'))} m; source field, not surveyed-site proof`),datum('Provider coverage range',field(record,'providerRangeMetres') === null ? 'Not supplied' : `${display(field(record,'providerRangeMetres'))} m; not horizontal accuracy`),datum('Provider first / last dates',`${display(field(record,'firstSeen'))} / ${display(field(record,'lastSeen'))}`),datum('Source administrative date',display(field(record,'sourceDate')))); panel.append(fields);
    if (field(record,'sentinel') === true) panel.append(make('p','','The preserved raw LTE cell value is the unknown-cell sentinel 4294967295 (0xFFFFFFFF), outside the 28-bit ECI domain. It is not normalized into a full LTE identity.'));
    if (record.layer === 'flyover' || record.layer === 'flyoverCatalog') panel.append(make('p','','This is a virtual map resource. Radian-to-degree interpretation produces the displayed anchor; the source’s original angular values remain in the retained fields. Presence does not establish a visit or a device position.'));
    if (record.layer === 'registeredSites') panel.append(make('p','','Permit addresses can describe proposed work, distributed antenna systems, alterations, removals, or expired work. The date/status fields do not prove a currently operating antenna.'));
    if (record.layer === 'documentedPlans') panel.append(make('p','','Original NAD83 planned coordinates are documentary and remain unplotted. The original drawing could not be directly retrieved or visually verified; no WGS84 transformation or broadcast identity is asserted.'));
    const actions = make('div','actions',''); actions.append(action('Download retained record ↓',() => download(`atlas-record-${record.layer}-${record.id.replace(/[^a-z0-9_-]/gi,'-')}.json`,{layer:record.layer,coordinateRole:record.role,record:rawRecord(record)}),'catalog-download-record'));
    const sourceUrl = field(record,'sourceUrl'); if (typeof sourceUrl === 'string') { const parsed = new URL(sourceUrl); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) actions.append(link('Open published source ↗',sourceUrl)); }
    actions.append(link('Read source interpretation ↗','../index.html'));
    panel.append(actions,rawDetails('Complete retained source fields',rawRecord(record)));
    const networkCards = registry.carriers.filter(carrier => record.carriers.includes(carrier.code));
    if (networkCards.length) {
      const labels = make('details','',''); labels.append(make('summary','','Network names, assignment dates, and sources'));
      for (const carrier of networkCards) { labels.append(make('h4','',`${carrier.name} · ${carrier.code}`),make('p','',`${carrier.status} · evidence date ${carrier.asOf || 'not supplied'}. ${carrier.note}`)); for (const source of registry.sources.filter(source => carrier.sourceIds.includes(source.id))) labels.append(link(source.title + ' ↗',source.url),' '); }
      panel.append(labels);
    }
    if (record.layer === 'independentLte' || record.layer === 'independentNr') panel.append(make('p','','Cell measurements: OpenCellID via mcc-mnc.org mirror, CC BY-SA 4.0. Database first/last dates describe the provider’s record, not an observation by this Mac. The provider’s range is not horizontal accuracy. Source-specific reuse questions remain unresolved; no vendor license grant or endorsement is asserted. See the source and data notices for each source family.'));
    if (record.layer === 'coverage' || record.layer === 'outliers') {
      const load = action('Load native coverage wire and qualified postings',() => { loadCoverage(record,load,panel,signal); },'catalog-load-wire'); actions.append(load);
      panel.append(rawDetails('Native coverage schema · LTE tag 5 / NR tag 6',manifest.coverageSchema));
    }
    if (record.layer === 'flyover' && record.detailPath) { const load = action('Load virtual camera sequence',() => { loadTour(record,load,panel,signal); },'catalog-load-tour'); actions.append(load); }
  }
  /** @param {CatalogRecord} record @param {HTMLButtonElement} load @param {HTMLElement} panel @param {AbortSignal} signal @returns {Promise<void>} */
  async function loadCoverage(record,load,panel,signal) {
    load.disabled = true; const progress = make('p','','Loading the selected native coverage payload…'); progress.setAttribute('role','status'); panel.append(progress);
    try {
      if (!record.detailPath) throw new Error('This record has no source coverage detail file.');
      const chunk = validateCoverageChunk(await localJson(record.detailPath,signal));
      const expectedId = record.layer === 'coverage' ? record.id : `C${display(field(record,'sourceOrdinal'))}`;
      const source = chunk.find(item => item.id === expectedId); if (!source) throw new Error(`Native coverage detail ${expectedId} was not found in ${record.detailPath}.`);
      if (signal.aborted || selected?.key !== record.key) return;
      const postings = coveragePostings(source); progress.textContent = `${postings.length} native LTE/NR postings. These bind network/radio/channel context, not a full cell identity or antenna.`;
      const wrap = make('div','table-wrap',''); const table = make('table','',''); table.dataset.testid = 'catalog-postings'; const caption = make('caption','',`Qualified source postings for ${source.id}`); const head = make('thead','',''); const header = make('tr','','');
      for (const label of ['Radio','Network / carrier','Channel','Context PCIs','Band','Count','RSRP raw']) { const th = make('th','',label); th.scope = 'col'; header.append(th); } head.append(header); const body = make('tbody','','');
      for (const posting of postings) { const row = make('tr','',''); const carrier = registry.carriers.find(item => item.code === posting.carrier); for (const value of [posting.radio.toUpperCase(),`${posting.carrier || 'Not supplied'} · ${carrier ? carrier.name : 'Assignment unresolved'}`,posting.channel || 'Not supplied',posting.pcis.join(', ') || 'No PCI supplied',posting.band || 'Not supplied',posting.count || 'Not supplied',posting.rsrpRaw || 'Not supplied']) row.append(make('td','',value)); body.append(row); }
      table.append(caption,head,body); wrap.append(table); panel.append(wrap,rawDetails('Complete selected native coverage payload',source.raw),action('Download native payload ↓',() => download(`atlas-coverage-${source.id}.json`,{record:source.raw,schema:manifest.coverageSchema}),'catalog-download-wire'));
    } catch (error) { if (!signal.aborted) { progress.textContent = error instanceof Error ? error.message : 'The selected native coverage payload could not be loaded.'; progress.setAttribute('role','alert'); load.disabled = false; } }
  }
  /** @param {CatalogRecord} record @param {HTMLButtonElement} load @param {HTMLElement} panel @param {AbortSignal} signal @returns {Promise<void>} */
  async function loadTour(record,load,panel,signal) {
    load.disabled = true; const progress = make('p','','Loading the original virtual camera sequence…'); progress.setAttribute('role','status'); panel.append(progress);
    try {
      if (!record.detailPath) throw new Error('The selected Flyover record has no camera-path file.'); const tour = validateTour(await localJson(record.detailPath,signal)); if (signal.aborted || selected?.key !== record.key) return;
      cameraFrames = tour.frames; progress.textContent = `${tour.frames.length} virtual camera frames loaded. The sequence is a map resource, not an observed route or visit.`;
      const fit = fitViewport(tour.frames.map(frame => ({...record,lat:frame.lat,lon:frame.lon})),canvas.clientWidth / canvas.clientHeight); if (fit) view = fit; drawLater();
      const wrap = make('div','table-wrap',''); const table = make('table','',''); table.dataset.testid = 'catalog-camera-frames'; const caption = make('caption','','All source camera-frame coordinates; original angular/animation fields are in the complete source payload.'); const head = make('thead','',''); const header = make('tr','',''); for (const label of ['Frame','Latitude','Longitude']) { const th = make('th','',label); th.scope = 'col'; header.append(th); } head.append(header); const body = make('tbody','',''); for (const frame of tour.frames) { const row = make('tr','',''); for (const value of [String(frame.ordinal),String(frame.lat),String(frame.lon)]) row.append(make('td','',value)); body.append(row); } table.append(caption,head,body); wrap.append(table);
      panel.append(wrap,rawDetails('Complete Flyover source component and camera path',tour.raw),action('Download complete tour ↓',() => download(`atlas-tour-${record.id}.json`,tour.raw),'catalog-download-tour'));
    } catch (error) { if (!signal.aborted) { progress.textContent = error instanceof Error ? error.message : 'The selected Flyover tour could not be loaded.'; progress.setAttribute('role','alert'); load.disabled = false; } }
  }

  /** @param {CatalogRecord[]} candidates @param {Query} query @param {AbortSignal} signal @returns {Promise<Set<string>>} */
  async function qualifyCoverage(candidates,query,signal) {
    let coverage = candidates.filter(record => record.layer === 'coverage');
    if (!coverage.length) return new Set();
    const needsPostings = query.pcis.length || query.channels.length || query.radios.length || query.radio;
    if (!needsPostings) return new Set(coverage.map(record => record.id));
    if (query.pcis.length > 8) throw new Error('A single search can qualify at most eight PCI values. Split the search to keep local native-wire scans bounded.');
    if (query.pcis.length) {
      for (const pci of [...new Set(query.pcis)]) {
        if (!pciIndex.values.includes(pci)) return new Set();
        const rows = validatePciPostings(await localJson(`pci/pci-${pci}.json`,signal),pci); const ids = new Set(rows.filter(row => postingMatches(row,query)).map(row => row.id)); coverage = coverage.filter(record => ids.has(record.id));
        if (!coverage.length) return new Set();
      }
    } else {
      const radios = ['lte','nr'].map(asRadio).filter(value => radioMatches(value,query));
      /** @type {Set<string>} */ const ids = new Set();
      for (const radio of radios) { const rows = validateRadioPostings(await localJson(pciIndex.radioFiles[radio],signal),radio); for (const row of rows) if (postingMatches(row,query)) ids.add(row.id); }
      coverage = coverage.filter(record => ids.has(record.id));
    }
    if (!query.channels.length && query.pcis.length < 2) return new Set(coverage.map(record => record.id));
    /** @type {Map<string,CatalogRecord[]>} */ const groups = new Map();
    for (const record of coverage) { if (!record.detailPath) throw new Error(`Coverage ${record.id} has no native detail file for channel qualification.`); const group = groups.get(record.detailPath); if (group) group.push(record); else groups.set(record.detailPath,[record]); }
    /** @type {Set<string>} */ const matches = new Set();
    let completed = 0;
    for (const [path,group] of groups) {
      signal.throwIfAborted(); node('status').textContent = `Checking native channel/PCI postings · ${completed + 1} / ${groups.size} source chunks. Previous valid results remain visible. Change a filter to cancel this scan.`;
      const expected = new Set(group.map(record => record.id)); const chunk = validateCoverageChunk(await localJson(path,signal));
      for (const row of chunk) if (expected.has(row.id) && coveragePostings(row).some(posting => postingMatches(posting,query))) matches.add(row.id);
      completed += 1;
    }
    return matches;
  }
  /** @returns {Promise<void>} */
  async function apply() {
    const sequence = ++searchSequence; currentSearch?.abort(); currentSearch = new AbortController(); const signal = AbortSignal.any([currentSearch.signal,AbortSignal.timeout(120000)]);
    try {
      const prepared = compileQuery(queryInput.value,layerSelect.value,carrierSelect.value,radioSelect.value,registry); const text = queryInput.value;
      node('query-error').hidden = true; queryInput.removeAttribute('aria-invalid'); node('status').textContent = 'Qualifying the local source records… Previous valid results remain visible until the search finishes.';
      const candidates = records.filter(record => recordMatches(record,prepared)); const qualified = await qualifyCoverage(candidates,prepared,signal);
      if (sequence !== searchSequence) return; signal.throwIfAborted();
      filtered = candidates.filter(record => record.layer !== 'coverage' || qualified.has(record.id)); appliedText = text; appliedQuery = prepared; page = 0;
      const selectedKey = selected === null ? null : selected.key; selected = filtered.find(record => record.key === selectedKey) || null;
      if (!selected) { cameraFrames = []; currentDetail?.abort(); emptyDetail(); }
      drawRecords = [...filtered].sort((a,b) => order[a.layer] - order[b.layer]); list(); fit();
      node('status').textContent = `${filtered.length.toLocaleString('en-US')} matching records. ${prepared.pcis.length ? 'PCI results are raw source/context matches; full identities are not joined to grids.' : 'All source roles and original coordinate digits are retained.'}${prepared.channels.length ? ' Channel qualifiers were checked against the same native posting.' : ''}`;
    } catch (error) {
      if (sequence !== searchSequence) return;
      node('query-error').textContent = `${error instanceof Error ? error.message : 'The local search could not be completed.'} Previous valid results remain displayed.`; node('query-error').hidden = false; queryInput.setAttribute('aria-invalid','true'); node('status').textContent = 'Search was not applied. Correct the query or restore the reported local data file.';
    }
  }
  /** @returns {void} */
  function fit() { const fitted = fitViewport(filtered,canvas.clientWidth / canvas.clientHeight); if (fitted) view = fitted; drawLater(); }
  /** @param {number} factor @returns {void} */
  function zoom(factor) { view = {...view,span:Math.max(.0005,Math.min(800,view.span * factor))}; drawLater(); }

  for (const layer of manifest.layers) { const option = make('option','',`${layer.label} (${layer.count.toLocaleString('en-US')})`); option.value = layer.id; layerSelect.append(option); }
  const usedCodes = new Set(records.flatMap(record => record.carriers));
  for (const carrier of registry.carriers.filter(carrier => usedCodes.has(carrier.code))) { const option = make('option','',`${carrier.name} · ${carrier.code}${carrier.status === 'historical' ? ' (dated evidence)' : carrier.status === 'unresolved' ? ' (unresolved)' : ''}`); option.value = carrier.code; carrierSelect.append(option); }
  node('filters').addEventListener('submit',event => { event.preventDefault(); apply(); }); for (const item of [layerSelect,carrierSelect,radioSelect]) item.addEventListener('change',() => { apply(); });
  button('reset').addEventListener('click',() => { queryInput.value = ''; layerSelect.value = ''; carrierSelect.value = ''; radioSelect.value = ''; apply(); });
  button('previous').addEventListener('click',() => { if (page > 0) { page -= 1; list(); node('list').scrollTop = 0; } }); button('next').addEventListener('click',() => { if ((page + 1) * pageSize < filtered.length) { page += 1; list(); node('list').scrollTop = 0; } });
  button('zoom-in').addEventListener('click',() => zoom(.6)); button('zoom-out').addEventListener('click',() => zoom(1 / .6)); button('fit').addEventListener('click',fit);
  button('theme').addEventListener('click',drawLater);
  button('download').addEventListener('click',() => {
    const layers = manifest.layers.map(spec => { const rows = filtered.filter(record => record.layer === spec.id); return {id:spec.id,coordinateRole:spec.coordinateRole,columns:rows.length ? rows[0].columns : [],rows:rows.map(record => record.cells)}; }).filter(layer => layer.rows.length);
    download('atlas-location-records-filtered.json',{version:1,checkedAt:manifest.checkedAt,interpretation:manifest.interpretation,search:{query:appliedText,layer:appliedQuery.layer,carrier:appliedQuery.carrier,radio:appliedQuery.radio},count:filtered.length,layers,nativeDetailManifest:'../data/catalog/index.json',note:'Coverage wire and complete camera source payloads remain in the separate local detail files. No unsupported full-ID/PCI/site join is added.'});
  });
  canvas.addEventListener('keydown',event => {
    if (event.key === '+' || event.key === '=') zoom(.6); else if (event.key === '-' || event.key === '_') zoom(1 / .6); else if (event.key === 'ArrowLeft') { view = {...view,x:view.x - view.span * .15}; drawLater(); } else if (event.key === 'ArrowRight') { view = {...view,x:view.x + view.span * .15}; drawLater(); } else if (event.key === 'ArrowUp') { view = {...view,y:Math.min(180,view.y + view.span * .1)}; drawLater(); } else if (event.key === 'ArrowDown') { view = {...view,y:Math.max(-180,view.y - view.span * .1)}; drawLater(); } else return; event.preventDefault();
  });
  canvas.addEventListener('pointerdown',event => { if (event.button !== 0) return; drag = {startX:event.clientX,startY:event.clientY,view,moved:false}; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove',event => { if (!drag) return; const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY; if (Math.hypot(dx,dy) > 4) drag.moved = true; if (drag.moved) { const scale = canvas.clientWidth / drag.view.span; view = {...drag.view,x:drag.view.x - dx / scale,y:Math.max(-180,Math.min(180,drag.view.y + dy / scale))}; drawLater(); } });
  canvas.addEventListener('pointerup',event => { const pending = drag; drag = null; if (!pending || pending.moved) return; const box = canvas.getBoundingClientRect(); const x = event.clientX - box.left; const y = event.clientY - box.top; let distance = 10; /** @type {CatalogRecord|null} */ let closest = null; for (let index = visiblePoints.length - 1; index >= 0; index -= 1) { const point = visiblePoints[index]; const candidate = Math.hypot(point.x - x,point.y - y); if (candidate < distance) { distance = candidate; closest = point.record; } } if (closest) openRecord(closest); });
  canvas.addEventListener('pointercancel',() => { drag = null; });
  new ResizeObserver(drawLater).observe(canvas);
  for (const id of ['search','reset']) button(id).disabled = false; for (const item of [queryInput,layerSelect,carrierSelect,radioSelect]) item.disabled = false;
  list(); fit(); node('status').textContent = `Loaded all ${records.length.toLocaleString('en-US')} real records from 12 layers. ${manifest.unmappedRecords} documentary/resource rows are unplotted; complete coverage and camera payloads load on demand.`;
}

/** @returns {Promise<void>} */
async function load() {
  for (const id of ['search','reset']) button(id).disabled = true; for (const id of ['layer','carrier','radio']) select(id).disabled = true; input('query').disabled = true;
  const controller = new AbortController();
  try {
    const manifest = validateManifest(await localJson('index.json',controller.signal));
    const [registry,pciIndex,land] = await Promise.all([localJson(manifest.carrierRegistryUrl,controller.signal).then(validateRegistry),localJson(manifest.pciIndexUrl,controller.signal).then(validatePciIndex),localJson('land-110m.json',controller.signal).then(validateLand)]);
    let completed = 0;
    const layers = await Promise.all(manifest.layers.map(async spec => { const raw = await localJson(spec.url,controller.signal); const rows = validateLayer(raw,spec,registry); completed += 1; node('status').textContent = `Loading columnar indexes · ${completed} / ${manifest.layers.length} layers validated. Full wire and camera payloads remain deferred.`; return rows; }));
    const records = layers.flat(); if (records.length !== manifest.totalRecords) throw new Error('The complete catalog row count disagrees with its manifest.'); start(manifest,registry,pciIndex,records,land);
  } catch (error) { controller.abort(); node('error').textContent = error instanceof Error ? error.message : 'The complete local catalog could not be loaded.'; node('error').hidden = false; node('status').textContent = 'Catalog loading failed. No example points or alternate source files were substituted.'; }
}

button('theme').addEventListener('click',() => { const light = document.documentElement.dataset.theme !== 'light'; document.documentElement.dataset.theme = light ? 'light' : 'dark'; button('theme').textContent = light ? 'Dark theme' : 'Light theme'; button('theme').setAttribute('aria-label',light ? 'Switch to dark theme' : 'Switch to light theme'); });
load();
