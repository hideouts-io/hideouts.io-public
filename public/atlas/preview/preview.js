/**
 * Local-only presentation boundary. Data is fetched from this review bundle,
 * validated before display, and rendered as text or canvas primitives. No map
 * provider, analytics, device-location, or external runtime service is used.
 */
import {LAYER_LABELS,LAYERS,validateDataset,parseSearch,filterRecords,carrierLabel,identityLabel,roleExplanation,project,unproject,distanceMetres} from './preview-model.js';

/** @typedef {import('./preview-model.js').Dataset} Dataset */
/** @typedef {import('./preview-model.js').EvidenceRecord} EvidenceRecord */
/** @typedef {import('./preview-model.js').EvidenceSource} EvidenceSource */
/** @typedef {import('./preview-model.js').Filters} Filters */
/** @typedef {import('./preview-model.js').Layer} Layer */
/** @typedef {import('./preview-model.js').JsonValue} JsonValue */
/** @typedef {{east:number,north:number,span:number}} Viewport */
/** @typedef {{record:EvidenceRecord,x:number,y:number}} PlotPoint */
/** @typedef {{background:string,grid:string,gridText:string,ring:string,text:string,lte:string,nr:string,coverage:string,pole:string,permit:string,other:string}} PlotPalette */

/** @param {string} id @returns {HTMLElement} */
function element(id) {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Preview interface element #${id} is missing. Restore the complete research-preview bundle.`);
  return node;
}

/** @param {string} id @returns {HTMLInputElement} */
function input(id) {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Preview input #${id} has an invalid element type.`);
  return node;
}

/** @param {string} id @returns {HTMLSelectElement} */
function select(id) {
  const node = element(id);
  if (!(node instanceof HTMLSelectElement)) throw new Error(`Preview selection #${id} has an invalid element type.`);
  return node;
}

/** @param {string} id @returns {HTMLButtonElement} */
function control(id) {
  const node = element(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Preview button #${id} has an invalid element type.`);
  return node;
}

/** @param {HTMLCanvasElement} canvas @returns {CanvasRenderingContext2D} */
function plotContext(canvas) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create a 2D coordinate plot. Use a browser with Canvas 2D support to explore these records.');
  return context;
}

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} className @param {string} text @returns {HTMLElementTagNameMap[K]} */
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** @param {string} text @param {string} className @param {() => void} action @param {string} testId @returns {HTMLButtonElement} */
function actionButton(text, className, action, testId) {
  const button = make('button', className, text);
  button.type = 'button';
  button.dataset.testid = testId;
  button.addEventListener('click', action);
  return button;
}

/** @param {string} text @param {string} url @returns {HTMLAnchorElement} */
function evidenceLink(text, url) {
  const link = make('a', '', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.referrerPolicy = 'no-referrer';
  return link;
}

/** @param {JsonValue} value @returns {string} */
function sourceValue(value) {
  return value === null || value === undefined ? 'Not supplied' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

/** @param {EvidenceRecord} record @returns {string} */
function coordinates(record) {
  return record.lat === null || record.lon === null ? 'Unplotted · source coordinate system retained' : `${record.lat}, ${record.lon}`;
}

/** @param {string} filename @param {JsonValue} value @returns {void} */
function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = make('a', '', '');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {string} label @param {string} value @param {string} className @returns {HTMLDivElement} */
function detailValue(label, value, className) {
  const row = make('div', '', '');
  row.append(make('dt', '', label),make('dd', className, value));
  return row;
}

/** @param {EvidenceSource} source @returns {HTMLDivElement} */
function sourceCard(source) {
  const card = make('div', 'source-reference', '');
  card.append(source.url ? evidenceLink(source.title + ' ↗', source.url) : make('strong', '', source.title));
  card.append(make('p', '', source.scope));
  if (source.licenseUrl) card.append(evidenceLink('License: CC BY-SA 4.0 ↗', source.licenseUrl));
  if (source.attributionUrl) card.append(evidenceLink('Attribution guidance ↗', source.attributionUrl));
  if (source.scope.toLowerCase().includes('unresolved')) card.append(make('p', 'source-use-note', 'Source-specific reuse terms unresolved · no vendor license grant asserted'));
  return card;
}

/** @param {Layer} layer @returns {HTMLSpanElement} */
function swatch(layer) {
  const marker = make('span', `legend-swatch ${layer}`, '');
  marker.setAttribute('aria-hidden', 'true');
  return marker;
}

/** @param {number} span @returns {number} */
function gridStep(span) {
  const target = span / 5;
  const power = 10 ** Math.floor(Math.log10(target));
  return [1,2,5,10].map(multiplier => multiplier * power).find(step => step >= target) || power * 10;
}

/** @param {number} metres @returns {string} */
function distanceLabel(metres) {
  return metres >= 1000 ? `${Number((metres / 1000).toFixed(2))} km` : `${Math.round(metres)} m`;
}

/** @returns {PlotPalette} */
function palette() {
  const styles = getComputedStyle(document.documentElement);
  /** @param {string} name @returns {string} */
  const color = name => styles.getPropertyValue(name).trim();
  return {background:color('--bg'),grid:color('--plot-grid'),gridText:color('--plot-grid-text'),ring:color('--plot-ring'),text:color('--text'),lte:color('--lte'),nr:color('--nr'),coverage:color('--coverage'),pole:color('--pole'),permit:color('--permit'),other:color('--other')};
}

/** @param {Layer} layer @param {PlotPalette} colors @returns {string} */
function pointColor(layer, colors) {
  if (layer === 'lte' || layer === 'independentLte') return colors.lte;
  if (layer === 'nr' || layer === 'independentNr') return colors.nr;
  if (layer === 'coverage') return colors.coverage;
  if (layer === 'smallCells') return colors.pole;
  if (layer === 'registeredSites' || layer === 'documentedPlans') return colors.permit;
  return colors.other;
}

/** @param {CanvasRenderingContext2D} context @param {Layer} layer @param {number} x @param {number} y @param {number} size @returns {void} */
function pointShape(context, layer, x, y, size) {
  context.beginPath();
  if (layer === 'coverage' || layer === 'outliers') context.rect(x - size, y - size, size * 2, size * 2);
  else if (layer === 'nr' || layer === 'independentNr') { context.moveTo(x, y - size * 1.35); context.lineTo(x + size * 1.15, y); context.lineTo(x, y + size * 1.35); context.lineTo(x - size * 1.15, y); context.closePath(); }
  else if (layer === 'smallCells') { context.moveTo(x, y - size * 1.4); context.lineTo(x + size * 1.3, y + size); context.lineTo(x - size * 1.3, y + size); context.closePath(); }
  else if (layer === 'registeredSites' || layer === 'documentedPlans') {
    for (let index = 0; index < 5; index += 1) { const angle = Math.PI * 2 * index / 5 - Math.PI / 2; const px = x + Math.cos(angle) * size * 1.3; const py = y + Math.sin(angle) * size * 1.3; if (index === 0) context.moveTo(px, py); else context.lineTo(px, py); }
    context.closePath();
  } else context.arc(x, y, size, 0, Math.PI * 2);
}

/** @param {Dataset} dataset @param {EvidenceRecord[]} records @returns {Viewport|null} */
function fittedViewport(dataset, records) {
  const positions = records.flatMap(record => record.lat !== null && record.lon !== null ? [project(record.lat, record.lon, dataset.studyArea)] : []);
  if (!positions.length) return null;
  const east = positions.map(position => position.east);
  const north = positions.map(position => position.north);
  const minEast = Math.min(...east);
  const maxEast = Math.max(...east);
  const minNorth = Math.min(...north);
  const maxNorth = Math.max(...north);
  return {east:(minEast + maxEast) / 2,north:(minNorth + maxNorth) / 2,span:Math.max(250,(maxEast - minEast) * 1.35,(maxNorth - minNorth) * 1.35)};
}

/** @param {Dataset} dataset @returns {void} */
function startExplorer(dataset) {
  const canvasNode = element('coordinate-plot');
  if (!(canvasNode instanceof HTMLCanvasElement)) throw new Error('The local coordinate plot canvas is missing. Restore the complete review bundle.');
  const context = plotContext(canvasNode);
  const canvas = canvasNode;
  const query = input('identity-search');
  const carrierSelect = select('carrier-filter');
  const radioSelect = select('radio-filter');
  const layerSelect = select('layer-filter');
  const sourceSelect = select('source-filter');
  const pageSize = 40;
  /** @type {EvidenceRecord[]} */ let filtered = dataset.records;
  /** @type {EvidenceRecord|null} */ let selected = null;
  /** @type {PlotPoint[]} */ let plotPoints = [];
  /** @type {Viewport} */ let viewport = {east:0,north:0,span:11000};
  /** @type {Filters} */ let appliedFilters = {terms:[],carrier:'',radio:'',layer:'',source:''};
  let appliedQuery = '';
  let page = 0;
  let plotWidth = 0;
  let plotHeight = 0;
  let framePending = false;

  /** @returns {void} */
  function schedulePlot() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => { framePending = false; drawPlot(); });
  }

  /** @returns {void} */
  function drawPlot() {
    const rect = canvas.getBoundingClientRect();
    plotWidth = Math.max(1,rect.width);
    plotHeight = Math.max(1,rect.height);
    canvas.width = Math.round(plotWidth * 2);
    canvas.height = Math.round(plotHeight * 2);
    context.setTransform(2,0,0,2,0,0);
    const colors = palette();
    context.fillStyle = colors.background;
    context.fillRect(0,0,plotWidth,plotHeight);
    const usableWidth = Math.max(1,plotWidth - 90);
    const usableHeight = Math.max(1,plotHeight - 90);
    const scale = Math.min(usableWidth,usableHeight) / viewport.span;
    /** @param {number} east @returns {number} */
    const toX = east => plotWidth / 2 + (east - viewport.east) * scale;
    /** @param {number} north @returns {number} */
    const toY = north => plotHeight / 2 - (north - viewport.north) * scale;
    const left = viewport.east - plotWidth / scale / 2;
    const right = viewport.east + plotWidth / scale / 2;
    const bottom = viewport.north - plotHeight / scale / 2;
    const top = viewport.north + plotHeight / scale / 2;
    const step = gridStep(viewport.span);
    context.lineWidth = 1;
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textBaseline = 'top';
    context.fillStyle = colors.gridText;
    context.strokeStyle = colors.grid;
    for (let east = Math.ceil(left / step) * step; east <= right; east += step) {
      const x = toX(east);
      context.beginPath(); context.moveTo(x,0); context.lineTo(x,plotHeight); context.stroke();
      const coordinate = unproject(east,viewport.north,dataset.studyArea);
      context.fillText(coordinate.lon.toFixed(viewport.span < 1000 ? 4 : 3) + '°',x + 5,10);
    }
    for (let north = Math.ceil(bottom / step) * step; north <= top; north += step) {
      const y = toY(north);
      context.beginPath(); context.moveTo(0,y); context.lineTo(plotWidth,y); context.stroke();
      const coordinate = unproject(viewport.east,north,dataset.studyArea);
      context.fillText(coordinate.lat.toFixed(viewport.span < 1000 ? 4 : 3) + '°',10,y + 5);
    }
    context.strokeStyle = colors.ring;
    context.setLineDash([5,6]);
    context.beginPath(); context.arc(toX(0),toY(0),5000 * scale,0,Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.fillStyle = colors.gridText;
    if (viewport.span >= 7000) context.fillText('5 km study boundary',toX(-3100),toY(4200));
    const order = {coverage:0,registeredSites:1,smallCells:2,wifi:3,lte:4,nr:5,independentLte:6,independentNr:7,outliers:8,documentedPlans:9};
    const projected = filtered.flatMap(record => { if (record.lat === null || record.lon === null) return []; const position = project(record.lat,record.lon,dataset.studyArea); return [{record,x:toX(position.east),y:toY(position.north)}]; });
    plotPoints = projected.filter(point => point.x >= 0 && point.x <= plotWidth && point.y >= 0 && point.y <= plotHeight).sort((a,b) => order[a.record.layer] - order[b.record.layer]);
    for (const point of plotPoints) {
      const layer = point.record.layer;
      const isTarget = dataset.target.recordKeys.includes(point.record.key);
      const size = isTarget ? 6.5 : layer === 'coverage' ? 2.1 : layer === 'outliers' ? 4 : 3.3;
      context.globalAlpha = layer === 'coverage' ? .48 : layer === 'registeredSites' || layer === 'smallCells' ? .65 : .82;
      context.fillStyle = pointColor(layer,colors);
      context.strokeStyle = pointColor(layer,colors);
      context.lineWidth = isTarget ? 2.4 : 1.8;
      pointShape(context,layer,point.x,point.y,size);
      if (layer === 'independentNr' || layer === 'independentLte') context.stroke(); else context.fill();
      if (isTarget && viewport.span < 1800) {
        context.globalAlpha = 1;
        context.fillStyle = colors.text;
        context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        const label = layer === 'independentNr' ? 'OpenCellID mirror estimate' : 'Apple NR estimate';
        const textWidth = context.measureText(label).width;
        const labelX = Math.max(8,Math.min(plotWidth - textWidth - 8,point.x + 12));
        context.fillText(label,labelX,point.y + (layer === 'independentNr' ? 12 : -25));
      }
    }
    context.globalAlpha = 1;
    if (selected) {
      const selectedKey = selected.key;
      const point = plotPoints.find(item => item.record.key === selectedKey);
      if (point) { context.strokeStyle = colors.text; context.lineWidth = 2; context.beginPath(); context.arc(point.x,point.y,10,0,Math.PI * 2); context.stroke(); }
    }
    const scaleMetres = gridStep(viewport.span / 2);
    const scalePixels = scaleMetres * scale;
    context.strokeStyle = colors.text;
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(20,plotHeight - 45); context.lineTo(20 + scalePixels,plotHeight - 45); context.stroke();
    context.fillStyle = colors.text;
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText(distanceLabel(scaleMetres),20,plotHeight - 62);
    const unplotted = filtered.filter(record => record.lat === null).length;
    element('plot-caption').textContent = `${plotPoints.length.toLocaleString('en-US')} points in view / ${projected.length.toLocaleString('en-US')} matching coordinates${unplotted ? ` · ${unplotted} unplotted documentary record` : ''}. Display projection is approximate; source digits are unchanged in record details.`;
    canvas.setAttribute('aria-label',`Geographic coordinate plot: ${plotPoints.length} points in view, ${filtered.length} matching public test records. ${unplotted} unplotted documentary records. All records are available in the keyboard-accessible list. Plus and minus zoom; arrow keys pan.`);
  }

  /** @returns {void} */
  function showRecords() {
    const start = page * pageSize;
    const rows = filtered.slice(start,start + pageSize);
    const list = element('record-list');
    list.replaceChildren();
    if (rows.length === 0) list.append(make('div','empty-results','No records match these filters. Try a different full identity or reset the filters. A PCI query returns context only where a source actually supplies that value.'));
    const fragment = document.createDocumentFragment();
    for (const record of rows) {
      const button = actionButton('', 'record-button', () => openRecord(record), 'record-button');
      button.dataset.recordKey = record.key;
      button.setAttribute('aria-pressed',String(selected !== null && selected.key === record.key));
      const top = make('span','record-topline','');
      const kind = make('span','record-kind',''); kind.append(swatch(record.layer),make('span','',LAYER_LABELS[record.layer]));
      const network = record.carrier && !record.carrier.includes(',') ? record.carrier : record.postings.length ? 'Mixed / qualified' : 'No cell ID';
      top.append(kind,make('span','record-network',network));
      button.append(top,make('span','record-id',identityLabel(record)),make('span','record-description',carrierLabel(record,dataset)));
      if (record.pci !== null) button.append(make('span','record-description',record.layer === 'outliers' ? `Raw PCI ${record.pci} · outside conventional radio range` : `PCI ${record.pci} supplied by this record`));
      fragment.append(button);
    }
    list.append(fragment);
    element('result-count').textContent = `${filtered.length.toLocaleString('en-US')} / ${dataset.records.length.toLocaleString('en-US')} records`;
    const pages = Math.max(1,Math.ceil(filtered.length / pageSize));
    element('page-label').textContent = `${page + 1} / ${pages}`;
    control('previous-page').disabled = page === 0;
    control('next-page').disabled = page + 1 >= pages;
    control('download-results').disabled = filtered.length === 0;
    const hasPci = appliedFilters.terms.some(term => term.kind === 'pci');
    element('result-scope').textContent = hasPci ? 'PCI matches are raw source values or qualified coverage context, not inferred PCI-to-full-cell assignments.' : 'Selected public test records only. No private cache history. Use the evidence source filter to compare providers.';
  }

  /** @param {EvidenceRecord} record @returns {void} */
  function chooseRecord(record) {
    selected = record;
    showRecords();
    showDetail(record);
    schedulePlot();
  }

  /** @param {EvidenceRecord} record @returns {void} */
  function openRecord(record) {
    chooseRecord(record);
    element('record-detail').focus();
  }

  /** @param {EvidenceRecord} record @returns {void} */
  function showDetail(record) {
    const detail = element('record-detail');
    detail.replaceChildren();
    detail.dataset.recordKey = record.key;
    const heading = make('div','detail-heading','');
    const title = make('div','','');
    title.append(make('div','eyebrow',LAYER_LABELS[record.layer]));
    const h3 = make('h3','',identityLabel(record)); h3.id = 'record-detail-title'; h3.dataset.testid = 'record-detail-title';
    title.append(h3,make('p','',carrierLabel(record,dataset)));
    heading.append(title,actionButton('Download this record ↓','secondary-button',() => downloadJson(`atlas-public-record-${record.id.replace(/[^a-z0-9_-]/gi,'-')}.json`,{record,sources:dataset.sources.filter(source => record.sourceIds.includes(source.id)),coverageSchema:record.layer === 'coverage' ? dataset.coverageSchema : null}),'download-record'));
    detail.append(heading);
    const notice = make('div','role-notice',''); notice.append(make('p','',roleExplanation(record))); detail.append(notice);
    const fields = make('dl','detail-grid','');
    const pciLabel = record.pci === null ? record.nci !== null || record.eci !== null ? 'Not supplied / unassigned' : 'No cell assignment' : record.layer === 'outliers' ? `${record.pci} · raw outlier` : record.pci;
    fields.append(detailValue('Latitude / longitude',coordinates(record),''),detailValue('Network code',record.carrier || 'Not supplied',''),detailValue('Full NR NCI',record.nci || 'Not supplied',''),detailValue('Full LTE ECI',record.eci || (record.raw.sentinel === true ? 'Unknown-cell sentinel; no valid ECI' : 'Not supplied'),''),detailValue('TAC',record.tac || 'Not supplied',''),detailValue('Radio / channel',`${record.radio ? record.radio.toUpperCase() : record.postings.length ? 'See qualified postings' : 'Not supplied'}${record.channel !== null ? ` / ${record.channel}` : ''}`,''),detailValue('Assigned / raw PCI',pciLabel,''),detailValue('Observation time',record.observationTime || 'Unknown / not supplied',''),detailValue('Source horizontal accuracy',record.raw.hAccMetres === null || record.raw.hAccMetres === undefined ? 'Not supplied' : `${sourceValue(record.raw.hAccMetres)} m (source field)`,''),detailValue('Provider coverage range',record.raw.providerRangeMetres === null || record.raw.providerRangeMetres === undefined ? 'Not supplied' : `${sourceValue(record.raw.providerRangeMetres)} m · not horizontal accuracy`,''),detailValue('Physical-site link','Not independently verified','description-value'),detailValue('Source record key',record.key,''));
    detail.append(fields);
    const interpretation = make('div','detail-section','');
    interpretation.append(make('h4','','What this coordinate means'),make('p','',record.coordinateRole));
    if (record.raw.sentinel === true) interpretation.append(make('p','','The source retains raw cell ID 4294967295 (0xFFFFFFFF), an unknown-cell sentinel outside the LTE 28-bit ECI domain. It is not displayed as a valid full ECI. The original raw value remains available below.'));
    if (record.raw.firstSeen || record.raw.lastSeen) interpretation.append(make('p','',`Provider database metadata: first seen ${sourceValue(record.raw.firstSeen)}; last seen ${sourceValue(record.raw.lastSeen)}. These describe the provider’s record, not an observation by this Mac or a person’s visit.`));
    if (record.contextPcis.length) interpretation.append(make('p','',`Context PCI union (${record.contextPcis.length} values): ${record.contextPcis.join(', ')}. Use the qualified postings below to retain network, radio, and channel associations.`));
    detail.append(interpretation);
    if (record.postings.length) {
      const section = make('div','detail-section','');
      section.append(make('h4','','Qualified coverage postings'),make('p','','Each row keeps one source association together. PCI values in different rows must not be joined across carriers, radios, or channels. A matching posting still has no full LTE ECI or NR NCI assignment.'));
      const scroll = make('div','table-scroll',''); const table = make('table','',''); table.dataset.testid = 'postings-table';
      const thead = make('thead','',''); const header = make('tr','',''); for (const label of ['Radio','Network / carrier','Channel','Context PCIs']) { const cell = make('th','',label); cell.scope = 'col'; header.append(cell); } thead.append(header);
      const tbody = make('tbody','','');
      for (const posting of record.postings) {
        const row = make('tr','','');
        const carrier = dataset.carriers.find(item => item.code === posting.carrier);
        const outlier = posting.pcis.some(pci => BigInt(pci) > (posting.radio === 'lte' ? 503n : 1007n));
        for (const value of [posting.radio.toUpperCase(),`${posting.carrier} · ${carrier ? carrier.name : 'Assignment unresolved'}`,posting.channel || 'Not supplied',posting.pcis.join(', ') + (outlier ? ' · includes raw outlier' : '')]) row.append(make('td','',value));
        tbody.append(row);
      }
      table.append(thead,tbody); scroll.append(table); section.append(scroll); detail.append(section);
    }
    const codes = [...new Set([...(record.carrier ? record.carrier.split(', ') : []),...record.postings.map(posting => posting.carrier)])];
    const names = dataset.carriers.filter(carrier => codes.includes(carrier.code));
    if (names.length) {
      const section = make('div','detail-section','');
      section.append(make('h4','','Carrier labels and their evidence'),make('p','','Carrier names describe network-code assignments. Dated assignments remain dated; shared or unresolved codes are not assigned to a nearby carrier. These labels do not establish antenna ownership or a subscriber’s retail plan.'));
      const cards = make('div','source-list','');
      for (const carrier of names) {
        const card = make('div','source-reference','');
        card.append(make('strong','',`${carrier.name} · ${carrier.code}`),make('p','',`${carrier.status}${carrier.asOf ? ` · evidence date ${carrier.asOf}` : ' · date not supplied'}`));
        if (carrier.note) card.append(make('p','',carrier.note));
        for (const source of dataset.sources.filter(item => carrier.sourceIds.includes(item.id))) if (source.url) card.append(evidenceLink(source.title + ' ↗',source.url));
        cards.append(card);
      }
      section.append(cards); detail.append(section);
    }
    const sources = make('div','detail-section',''); sources.append(make('h4','','Source evidence and use limits'));
    const cards = make('div','source-list','');
    for (const source of dataset.sources.filter(item => record.sourceIds.includes(item.id))) cards.append(sourceCard(source));
    sources.append(cards); detail.append(sources);
    const raw = make('details','raw-details',''); raw.dataset.testid = 'raw-record';
    raw.append(make('summary','','Show complete selected source fields'),make('p','','Source values selected for this review are preserved below, including unrounded coordinates and unresolved technical fields. Personal/access fields excluded from this derivative are described in the case study.'));
    raw.addEventListener('toggle',() => {
      if (!raw.open || raw.querySelector('pre')) return;
      const code = make('pre','',JSON.stringify(record.raw,null,2)); code.dataset.testid = 'raw-record-json'; raw.append(code);
    });
    detail.append(raw);
    if (record.layer === 'coverage') {
      const schema = make('details','raw-details',''); schema.dataset.testid = 'coverage-schema';
      schema.append(make('summary','','Show native coverage wire schema'),make('p','','The raw coverageDetail.wire tree uses this schema. A native message name such as CellTower does not make its grid coordinate a verified tower location. LTE tag 5 and NR tag 6 are PCI child messages; full ECI/NCI identities are not established by this schema.'));
      schema.addEventListener('toggle',() => { if (schema.open && !schema.querySelector('pre')) schema.append(make('pre','',JSON.stringify(dataset.coverageSchema,null,2))); });
      detail.append(schema);
    }
  }

  /** @returns {void} */
  function clearDetail() {
    const detail = element('record-detail');
    delete detail.dataset.recordKey;
    const empty = make('div','detail-empty','');
    const title = make('h3','','Choose a matching record to inspect it.'); title.id = 'record-detail-title';
    empty.append(make('div','eyebrow','Follow a point to its source'),title,make('p','','Full identities, coordinate meaning, qualified coverage postings, and source evidence appear here. Unknown observation times remain unknown.'));
    detail.replaceChildren(empty);
  }

  /** @returns {boolean} */
  function applyFilters() {
    try {
      const terms = parseSearch(query.value);
      const radio = radioSelect.value;
      if (radio !== '' && radio !== 'lte' && radio !== 'nr' && radio !== 'none') throw new Error('The selected radio filter is invalid. Choose LTE, NR, or administrative records.');
      appliedFilters = {terms,carrier:carrierSelect.value,radio,layer:layerSelect.value,source:sourceSelect.value};
      appliedQuery = query.value;
      filtered = filterRecords(dataset,appliedFilters);
      page = 0;
      const selectedKey = selected === null ? null : selected.key;
      selected = filtered.find(record => record.key === selectedKey) || null;
      if (selected === null) clearDetail();
      element('search-error').hidden = true;
      query.removeAttribute('aria-invalid');
      showRecords();
      schedulePlot();
      return true;
    } catch (error) {
      element('search-error').textContent = `${error instanceof Error ? error.message : 'The search could not be parsed. Use a supported exact identity prefix.'} The previous valid results remain displayed.`;
      element('search-error').hidden = false;
      query.setAttribute('aria-invalid','true');
      return false;
    }
  }

  /** @returns {void} */
  function resetFilters() {
    query.value = ''; carrierSelect.value = ''; radioSelect.value = ''; layerSelect.value = ''; sourceSelect.value = '';
    selected = null;
    applyFilters();
  }

  /** @param {number} factor @returns {void} */
  function zoom(factor) { viewport = {...viewport,span:Math.max(100,Math.min(30000,viewport.span * factor))}; schedulePlot(); }

  /** @returns {void} */
  function fitResults() {
    const fitted = fittedViewport(dataset,filtered);
    if (fitted) viewport = fitted;
    schedulePlot();
  }

  /** @param {string} gridId @returns {void} */
  function focusGrid(gridId) {
    resetFilters(); query.value = `grid:${gridId}`; applyFilters(); fitResults();
    if (filtered.length === 1) openRecord(filtered[0]);
    if (filtered.length !== 1) element('explorer').scrollIntoView({block:'start'});
  }

  /** @returns {void} */
  function focusTarget() {
    resetFilters(); query.value = `nci:${dataset.target.nci}`; carrierSelect.value = dataset.target.carrier; radioSelect.value = 'nr'; applyFilters(); fitResults();
    const target = filtered.find(record => record.layer === 'nr');
    if (target) chooseRecord(target);
    element('explorer').scrollIntoView({block:'start'});
    query.focus({preventScroll:true});
  }

  /** @returns {void} */
  function showTarget() {
    const panel = element('target-summary'); panel.replaceChildren();
    const targets = dataset.target.recordKeys.map(key => dataset.records.find(record => record.key === key));
    for (const record of targets) {
      if (!record) throw new Error('A validated target source record is unavailable. Restore the public review dataset.');
      const card = make('div','target-source',''); card.dataset.testid = 'target-source'; card.dataset.recordKey = record.key;
      const source = dataset.sources.find(item => record.sourceIds.includes(item.id));
      card.append(make('h3','',record.layer === 'independentNr' ? 'OpenCellID mirror estimate' : 'Apple NR estimate'),make('p','coordinate',coordinates(record)),make('p','',record.raw.hAccMetres === null || record.raw.hAccMetres === undefined ? 'Horizontal accuracy not supplied.' : `Source horizontal accuracy: ${sourceValue(record.raw.hAccMetres)} m.`));
      if (record.raw.providerRangeMetres !== null && record.raw.providerRangeMetres !== undefined) card.append(make('p','',`Provider coverage range: ${sourceValue(record.raw.providerRangeMetres)} m; not horizontal accuracy.`));
      card.append(make('p','','Full NCI 7587668269 · TAC 3960320'),make('p','','PCI: not supplied · Site: not independently verified'));
      if (source && source.url) card.append(evidenceLink(source.title + ' ↗',source.url));
      panel.append(card);
    }
    const [first,second] = targets;
    const comparison = make('div','target-distance','');
    comparison.append(make('span','','Estimate separation'));
    if (first && second && first.lat !== null && first.lon !== null && second.lat !== null && second.lon !== null) comparison.append(make('strong','',`${distanceMetres(first.lat,first.lon,second.lat,second.lon).toFixed(2)} m`));
    comparison.append(make('p','','Calculated between the two returned coordinates; not an accuracy estimate or a surveyed site.'),actionButton('Compare on the plot →','quiet-button',focusTarget,'compare-target'));
    panel.append(comparison);
    const contextPanel = make('div','target-contexts','');
    for (const item of dataset.target.contexts) {
      const card = make('div','target-context','');
      card.append(make('strong','',`Unassigned grid context ${item.gridId}`),make('span','mono',`NR PCI values ${item.pcis.join(', ')}`),actionButton('Inspect this grid →','quiet-button',() => focusGrid(item.gridId),'inspect-target-grid'));
      contextPanel.append(card);
    }
    panel.after(contextPanel);
  }

  const networks = dataset.carriers.filter(carrier => dataset.records.some(record => record.carrier === carrier.code || record.postings.some(posting => posting.carrier === carrier.code)));
  for (const carrier of networks) { const option = make('option','',`${carrier.name} · ${carrier.code}${carrier.status === 'historical' ? ' (dated evidence)' : carrier.status === 'unresolved' ? ' (unresolved)' : ''}`); option.value = carrier.code; carrierSelect.append(option); }
  for (const layer of LAYERS.filter(layer => dataset.records.some(record => record.layer === layer))) { const option = make('option','',`${LAYER_LABELS[layer]} (${dataset.records.filter(record => record.layer === layer).length.toLocaleString('en-US')})`); option.value = layer; layerSelect.append(option); }
  for (const source of dataset.sources.filter(source => dataset.records.some(record => record.sourceIds.includes(source.id)))) { const option = make('option','',source.title); option.value = source.id; sourceSelect.append(option); }
  const legend = element('plot-legend');
  for (const layer of LAYERS.filter(layer => dataset.records.some(record => record.layer === layer && record.lat !== null))) { const entry = make('span','legend-item',''); entry.append(swatch(layer),make('span','',LAYER_LABELS[layer])); legend.append(entry); }
  const attribution = make('p','plot-attribution','');
  attribution.append('Cell data from ',evidenceLink('OpenCellID','https://opencellid.org/'),' via ',evidenceLink('mcc-mnc.org mirror','https://mcc-mnc.org/cell-id-lookup'),', ',evidenceLink('CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/'),'. Changes: public-area selection, labels normalized, source-role comparison; source coordinates are not rounded. This research preview retains unresolved source-specific reuse questions; no vendor license grant or endorsement is asserted. ',evidenceLink('Read source and data notices','../DATA-NOTICES.md'),'.');
  legend.after(attribution);
  const checked = new Date(dataset.checkedAt).toISOString();
  element('dataset-meta').textContent = `${dataset.records.length.toLocaleString('en-US')} real records · 0 synthetic points\nReview dataset ${checked.slice(0,10)} · observation times unknown`;
  element('dataset-meta').classList.add('preserve-lines');
  showTarget();
  element('filters').addEventListener('submit',event => { event.preventDefault(); applyFilters(); });
  for (const dropdown of [carrierSelect,radioSelect,layerSelect,sourceSelect]) dropdown.addEventListener('change',() => { applyFilters(); });
  control('reset-filters').addEventListener('click',resetFilters);
  control('focus-target').disabled = false;
  control('focus-target').addEventListener('click',focusTarget);
  control('fit-results').addEventListener('click',fitResults);
  control('study-area').addEventListener('click',() => { viewport = {east:0,north:0,span:11000}; schedulePlot(); });
  control('zoom-in').addEventListener('click',() => zoom(.65));
  control('zoom-out').addEventListener('click',() => zoom(1 / .65));
  control('theme-toggle').addEventListener('click',schedulePlot);
  control('previous-page').addEventListener('click',() => { if (page > 0) { page -= 1; showRecords(); element('record-list').scrollTop = 0; } });
  control('next-page').addEventListener('click',() => { if ((page + 1) * pageSize < filtered.length) { page += 1; showRecords(); element('record-list').scrollTop = 0; } });
  control('download-results').addEventListener('click',() => downloadJson('atlas-public-filtered-records.json',{version:1,checkedAt:dataset.checkedAt,studyArea:dataset.studyArea,scope:dataset.scope,search:{query:appliedQuery,carrier:appliedFilters.carrier,radio:appliedFilters.radio,layer:appliedFilters.layer,source:appliedFilters.source},records:filtered,sources:dataset.sources,carriers:dataset.carriers,coverageSchema:dataset.coverageSchema}));
  canvas.addEventListener('click',event => {
    const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    /** @type {PlotPoint|null} */ let nearest = null;
    let nearestDistance = 12;
    for (let index = plotPoints.length - 1; index >= 0; index -= 1) { const point = plotPoints[index]; const distance = Math.hypot(point.x - x,point.y - y); if (distance <= nearestDistance) { nearest = point; nearestDistance = distance; } }
    if (nearest) openRecord(nearest.record);
  });
  canvas.addEventListener('keydown',event => {
    const shift = viewport.span * .15;
    if (event.key === '+' || event.key === '=') zoom(.65);
    else if (event.key === '-' || event.key === '_') zoom(1 / .65);
    else if (event.key === 'ArrowLeft') { viewport = {...viewport,east:viewport.east - shift}; schedulePlot(); }
    else if (event.key === 'ArrowRight') { viewport = {...viewport,east:viewport.east + shift}; schedulePlot(); }
    else if (event.key === 'ArrowUp') { viewport = {...viewport,north:viewport.north + shift}; schedulePlot(); }
    else if (event.key === 'ArrowDown') { viewport = {...viewport,north:viewport.north - shift}; schedulePlot(); }
    else return;
    event.preventDefault();
  });
  new ResizeObserver(schedulePlot).observe(element('plot-shell'));
  element('explorer-content').hidden = false;
  element('load-status').hidden = true;
  showRecords();
  schedulePlot();
}

/** Fetch only the selected local export; invalid or absent data is an explicit failure. @returns {Promise<void>} */
async function loadDataset() {
  element('load-error').hidden = true;
  element('load-status').hidden = false;
  control('retry-load').disabled = true;
  try {
    const response = await fetch('../data/preview-data.json',{signal:AbortSignal.timeout(15000),cache:'no-store',credentials:'omit',redirect:'error'});
    if (!response.ok) throw new Error(`Local dataset request failed with HTTP ${response.status}. Verify that the launcher serves public/data/preview-data.json.`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 45000000) throw new Error('The local dataset exceeds the 45 MB review limit. Verify the selected export rather than loading an unrelated private Atlas bundle.');
    const text = await response.text();
    if (text.length > 45000000) throw new Error('The local dataset exceeds the 45 MB review limit. Verify the selected public test-area export.');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('The local dataset is not valid JSON. Restore public/data/preview-data.json from this review bundle.'); }
    const dataset = validateDataset(parsed);
    startExplorer(dataset);
  } catch (error) {
    element('load-status').hidden = true;
    element('explorer-content').hidden = true;
    element('load-error-detail').textContent = error instanceof Error ? error.message : 'Loading the local dataset failed. Verify the launcher and the complete review bundle.';
    element('load-error').hidden = false;
    element('dataset-meta').textContent = 'Local dataset unavailable · no substitute points shown';
  } finally { control('retry-load').disabled = false; }
}

control('theme-toggle').addEventListener('click',() => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  control('theme-toggle').textContent = light ? 'Dark theme' : 'Light theme';
  control('theme-toggle').setAttribute('aria-label',light ? 'Switch to dark theme' : 'Switch to light theme');
});
control('retry-load').addEventListener('click',() => { loadDataset(); });
loadDataset();
