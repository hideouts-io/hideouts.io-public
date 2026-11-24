/** Pure parsing and search for the complete, columnar research-preview catalog. */
import {parseSearch} from '../preview/preview-model.js';

/** @typedef {import('../preview/preview-types.js').JsonValue} JsonValue */
/** @typedef {import('../preview/preview-types.js').JsonObject} JsonObject */
/** @typedef {import('../preview/preview-model.js').SearchTerm} SearchTerm */
/** @typedef {import('./catalog-types.js').WireEntry} WireEntry */
/** @typedef {'lte'|'nr'|'coverage'|'outliers'|'flyover'|'flyoverCatalog'|'wifi'|'smallCells'|'registeredSites'|'independentLte'|'independentNr'|'documentedPlans'} LayerId */
/** @typedef {'lte'|'nr'} Radio */
/** @typedef {{id:LayerId,label:string,count:number,locatedCount:number,unmappedCount:number,coordinateRole:string,url:string,bytes:number,sha256:string}} LayerSpec */
/** @typedef {{version:1,checkedAt:string,totalRecords:number,geographicRecords:number,unmappedRecords:number,layers:LayerSpec[],coverageSchema:JsonObject,interpretation:JsonObject,pciIndexUrl:string,carrierRegistryUrl:string}} Manifest */
/** @typedef {{code:string,name:string,aliases:string[],status:string,asOf:string|null,note:string,sourceIds:string[]}} Carrier */
/** @typedef {{id:string,title:string,url:string,verifiedAt:string|null}} RegistrySource */
/** @typedef {{carriers:Carrier[],sources:RegistrySource[]}} Registry */
/** @typedef {{key:string,id:string,layer:LayerId,lat:number|null,lon:number|null,name:string,carriers:string[],radio:Radio|null,nci:string|null,eci:string|null,tac:string|null,pci:string|null,channel:string|null,detailPath:string|null,detailIndex:number|null,columns:string[],cells:JsonValue[],role:string,text:string}} CatalogRecord */
/** @typedef {{terms:SearchTerm[],text:string[],networks:string[][],layer:string,carrier:string,radio:''|'lte'|'nr'|'none',pcis:string[],channels:string[],radios:string[]}} Query */
/** @typedef {{id:string,radio:Radio,carrier:string,references:number}} IndexPosting */
/** @typedef {{radio:Radio,carrier:string,channel:string|null,pcis:string[],band:string|null,count:string|null,rsrpRaw:string|null}} Posting */
/** @typedef {{id:string,raw:JsonObject,wire:WireEntry[]}} CoverageDetail */
/** @typedef {{values:string[],radioFiles:{lte:string,nr:string}}} PciIndex */
/** @typedef {{lat:number,lon:number,ordinal:number}} CameraFrame */
/** @typedef {{raw:JsonObject,frames:CameraFrame[]}} Tour */
/** @typedef {{lon:number,lat:number}[][]} Land */

/** @type {readonly LayerId[]} */
export const LAYERS = Object.freeze(['lte','nr','coverage','outliers','flyover','flyoverCatalog','wifi','smallCells','registeredSites','independentLte','independentNr','documentedPlans']);

/** @param {string} path @param {string} reason @returns {never} */
function fail(path,reason) { throw new Error(`Invalid local catalog at ${path}: ${reason}.`); }
/** @param {JsonValue|undefined} value @param {string} path @returns {JsonObject} */
function object(value,path) { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path,'expected an object'); return value; }
/** @param {JsonValue|undefined} value @param {string} path @param {number} limit @returns {JsonValue[]} */
function array(value,path,limit) { if (!Array.isArray(value) || value.length > limit) fail(path,`expected an array of at most ${limit} entries`); return value; }
/** @param {JsonValue|undefined} value @param {string} path @param {number} limit @returns {string} */
function text(value,path,limit) { if (typeof value !== 'string' || value.length > limit) fail(path,`expected a string of at most ${limit} characters`); return value; }
/** @param {JsonValue|undefined} value @param {string} path @returns {string} */
function required(value,path) { const result = text(value,path,5000); if (!result.trim()) fail(path,'expected a nonempty string'); return result; }
/** @param {JsonValue|undefined} value @param {string} path @param {number} low @param {number} high @returns {number} */
function numeric(value,path,low,high) { if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(path,`expected a finite number from ${low} to ${high}`); return value; }
/** @param {JsonValue|undefined} value @param {string} path @param {number} high @returns {number} */
function integer(value,path,high) { const result = numeric(value,path,0,high); if (!Number.isInteger(result)) fail(path,'expected an integer'); return result; }
/** @param {JsonValue|undefined} value @param {string} path @returns {string[]} */
function strings(value,path) { return array(value,path,1000).map((item,index) => required(item,`${path}[${index}]`)); }
/** @param {JsonValue|undefined} value @param {string} path @returns {Radio} */
function radio(value,path) { if (value !== 'lte' && value !== 'nr') fail(path,'expected lte or nr'); return value; }
/** @param {JsonValue|undefined} value @param {string} path @returns {string} */
function network(value,path) { const code = required(value,path); if (!/^\d{1,3}\/\d{1,3}$/.test(code)) fail(path,'expected an original numeric MCC/MNC pair'); return code; }
/** @param {JsonValue|undefined} value @param {string} path @param {bigint} maximum @returns {string|null} */
function decimal(value,path,maximum) { if (value === null || value === undefined) return null; const result = typeof value === 'number' ? String(integer(value,path,Number.MAX_SAFE_INTEGER)) : text(value,path,20); if (!/^(0|[1-9]\d*)$/.test(result) || BigInt(result) > maximum) fail(path,`expected an unsigned decimal integer no larger than ${maximum}`); return result; }
/** @param {JsonValue} value @param {string} path @param {number} depth @returns {number} */
function jsonSize(value,path,depth) {
  if (depth > 25) fail(path,'JSON nesting exceeds 25 levels');
  if (typeof value === 'number' && !Number.isFinite(value)) fail(path,'non-finite JSON number');
  if (typeof value === 'string' && value.length > 1000000) fail(path,'individual field exceeds 1 MB');
  if (Array.isArray(value)) return 1 + value.reduce(/** @param {number} count */ (count,item,index) => count + jsonSize(item,`${path}[${index}]`,depth + 1),0);
  if (value !== null && typeof value === 'object') return 1 + Object.entries(value).reduce((count,[key,item]) => count + jsonSize(item,`${path}.${key}`,depth + 1),0);
  return 1;
}
/** @param {string} path @returns {string} */
export function allowedPath(path) {
  if (/^(index|carrier-registry|land-110m)\.json$/.test(path) || /^(lte|nr|coverage|outliers|flyover|flyoverCatalog|wifi|smallCells|registeredSites|independentLte|independentNr|documentedPlans)\.json$/.test(path) || /^pci\/(index|radio-lte|radio-nr|pci-\d{1,20})\.json$/.test(path) || /^coverage\/(chunk-\d{3}|nonspatial)\.json$/.test(path) || /^flyover\/tour-\d{1,20}\.json$/.test(path)) return path;
  return fail('file path','file is outside the fixed local catalog allowlist');
}
/** @param {string} path @returns {string} */
export function detailPath(path) { if (!path.startsWith('./data/')) fail('detailChunk','expected the preserved catalog-relative source path'); return allowedPath(path.slice(7)); }
/** @param {JsonValue} value @returns {Manifest} */
export function validateManifest(value) {
  const input = object(value,'manifest');
  if (input.version !== 1 || input.localReviewOnly !== false || input.publicationAuthorized !== true || input.releaseType !== 'research-preview' || input.externalRuntimeRequests !== false) fail('manifest','expected authorized research-preview release version 1 without external runtime requests');
  const layers = array(input.layers,'manifest.layers',12).map(item => {
    const row = object(item,'manifest.layer'); const id = layerId(row.id);
    const url = allowedPath(required(row.url,`${id}.url`)); if (url !== `${id}.json`) fail(`${id}.url`,'layer filename does not match its ID');
    const count = integer(row.count,`${id}.count`,200000); const locatedCount = integer(row.locatedCount,`${id}.locatedCount`,count); const unmappedCount = integer(row.unmappedCount,`${id}.unmappedCount`,count);
    if (locatedCount + unmappedCount !== count) fail(id,'located and unplotted counts do not sum to total');
    const sha256 = required(row.sha256,`${id}.sha256`); if (!/^[a-f0-9]{64}$/.test(sha256)) fail(id,'expected a SHA-256 manifest digest');
    return {id,label:required(row.label,`${id}.label`),count,locatedCount,unmappedCount,coordinateRole:required(row.coordinateRole,`${id}.coordinateRole`),url,bytes:integer(row.bytes,`${id}.bytes`,50000000),sha256};
  });
  if (layers.length !== 12 || new Set(layers.map(layer => layer.id)).size !== 12) fail('layers','expected all 12 unique source layers');
  const totalRecords = integer(input.totalRecords,'totalRecords',200000); const geographicRecords = integer(input.geographicRecords,'geographicRecords',totalRecords); const unmappedRecords = integer(input.unmappedRecords,'unmappedRecords',totalRecords);
  if (layers.reduce((sum,layer) => sum + layer.count,0) !== totalRecords || geographicRecords + unmappedRecords !== totalRecords) fail('manifest','record totals disagree');
  return {version:1,checkedAt:required(input.checkedAt,'checkedAt'),totalRecords,geographicRecords,unmappedRecords,layers,coverageSchema:object(input.coverageSchema,'coverageSchema'),interpretation:object(input.interpretation,'interpretation'),pciIndexUrl:allowedPath(required(input.pciIndexUrl,'pciIndexUrl')),carrierRegistryUrl:allowedPath(required(input.carrierRegistryUrl,'carrierRegistryUrl'))};
}
/** @param {JsonValue|undefined} value @returns {LayerId} */
function layerId(value) { switch (value) { case 'lte': case 'nr': case 'coverage': case 'outliers': case 'flyover': case 'flyoverCatalog': case 'wifi': case 'smallCells': case 'registeredSites': case 'independentLte': case 'independentNr': case 'documentedPlans': return value; default:return fail('layer','unsupported source layer'); } }
/** @param {JsonValue} value @returns {Registry} */
export function validateRegistry(value) {
  const input = object(value,'carrier registry');
  const sources = array(input.sources,'registry.sources',200).map(item => { const source = object(item,'registry.source'); const url = required(source.url,'source.url'); const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('source.url','expected HTTPS without credentials'); return {id:required(source.id,'source.id'),title:required(source.title,'source.title'),url,verifiedAt:source.verifiedAt === null || source.verifiedAt === undefined ? null : required(source.verifiedAt,'source.verifiedAt')}; });
  const carriers = array(input.carriers,'registry.carriers',500).map(item => { const carrier = object(item,'carrier'); return {code:network(carrier.code,'carrier.code'),name:carrier.brandName !== null && carrier.brandName !== undefined ? required(carrier.brandName,'brandName') : carrier.operatorName !== null && carrier.operatorName !== undefined ? required(carrier.operatorName,'operatorName') : 'Unresolved assignment',aliases:strings(carrier.aliases,'carrier.aliases'),status:required(carrier.status,'carrier.status'),asOf:carrier.asOf === null ? null : required(carrier.asOf,'carrier.asOf'),note:required(carrier.note,'carrier.note'),sourceIds:strings(carrier.sourceIds,'carrier.sourceIds')}; });
  if (new Set(carriers.map(carrier => carrier.code)).size !== carriers.length) fail('registry','duplicate carrier code');
  return {carriers,sources};
}
/** @param {JsonValue} value @param {string} path @param {number} limit @returns {{columns:string[],rows:JsonValue[][]}} */
function columnar(value,path,limit) {
  const input = object(value,path); const columns = strings(input.columns,`${path}.columns`);
  if (columns.length > 100 || columns.some(column => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(column)) || new Set(columns).size !== columns.length) fail(path,'invalid or duplicate column names');
  const rows = array(input.rows,`${path}.rows`,limit).map((item,index) => { const row = array(item,`${path}.rows[${index}]`,columns.length); if (row.length !== columns.length) fail(path,`row ${index} has the wrong number of cells`); return row; });
  return {columns,rows};
}
/** @param {string[]} columns @param {JsonValue[]} cells @param {string} key @returns {JsonValue|null} */
function cell(columns,cells,key) { const index = columns.indexOf(key); return index < 0 ? null : cells[index]; }
/** @param {CatalogRecord} record @param {string} key @returns {JsonValue|null} */
export function field(record,key) { return cell(record.columns,record.cells,key); }
/** @param {CatalogRecord} record @returns {JsonObject} */
export function rawRecord(record) { return Object.fromEntries(record.columns.map((column,index) => [column,record.cells[index]])); }
/** @param {string} value @returns {string} */
function normalizedAlias(value) { return value.toLowerCase().replace(/[^\p{L}\p{N}/]+/gu,''); }
/** @param {JsonValue} value @param {LayerSpec} spec @param {Registry} registry @returns {CatalogRecord[]} */
export function validateLayer(value,spec,registry) {
  const data = columnar(value,spec.id,spec.count); if (data.rows.length !== spec.count) fail(spec.id,'row count disagrees with manifest');
  for (const key of ['id','lat','lon','carrier']) if (!data.columns.includes(key)) fail(spec.id,`required column ${key} is missing`);
  const records = data.rows.map((cells,index) => {
    /** @param {string} key @returns {JsonValue|null} */
    const get = key => cell(data.columns,cells,key);
    const id = required(get('id'),`${spec.id}[${index}].id`);
    const lat = get('lat') === null ? null : numeric(get('lat'),`${id}.lat`,-90,90); const lon = get('lon') === null ? null : numeric(get('lon'),`${id}.lon`,-180,180);
    if ((lat === null) !== (lon === null)) fail(id,'latitude and longitude must both exist or both be null');
    const carrier = text(get('carrier'),`${id}.carrier`,2000); const carriers = carrier ? carrier.split(', ').map(code => network(code,`${id}.carrier`)) : [];
    const nci = spec.id === 'nr' || spec.id === 'independentNr' ? decimal(get('nci'),`${id}.nci`,68719476735n) : null;
    const eci = (spec.id === 'lte' || spec.id === 'independentLte') && get('sentinel') !== true ? decimal(get('cellId'),`${id}.eci`,268435455n) : null;
    const radioKind = spec.id === 'lte' || spec.id === 'independentLte' ? 'lte' : spec.id === 'nr' || spec.id === 'independentNr' ? 'nr' : spec.id === 'outliers' ? get('radioSlot') === 3 ? 'lte' : 'nr' : null;
    const tac = decimal(get('tac'),`${id}.tac`,16777215n); const pci = decimal(get('pci'),`${id}.pci`,18446744073709551615n);
    const channel = decimal(get('nrarfcn') ?? get('arfcn') ?? get('channel'),`${id}.channel`,3279165n);
    const detail = get('detailChunk'); const detailFile = detail === null ? null : detailPath(required(detail,`${id}.detailChunk`)); const detailIndex = get('detailIndex') === null ? null : integer(get('detailIndex'),`${id}.detailIndex`,1000);
    const sourceUrl = get('sourceUrl');
    if (sourceUrl !== null) { const url = new URL(required(sourceUrl,`${id}.sourceUrl`)); if (url.protocol !== 'https:' || url.username || url.password) fail(`${id}.sourceUrl`,'published source links must use HTTPS without credentials'); }
    const name = get('name') === null ? id : text(get('name'),`${id}.name`,5000);
    const extra = ['cellId','siteCode','usid','poleId','plannedCarrierName','sourceId','kind'].map(key => get(key)).filter(item => typeof item === 'string' || typeof item === 'number');
    const placeNames = get('derivedPlaceNames'); const places = placeNames === null ? [] : strings(placeNames,`${id}.derivedPlaceNames`);
    const aliasValues = get('aliases'); const aliases = aliasValues === null ? [] : strings(aliasValues,`${id}.aliases`);
    const sourceRecord = get('rawSourceRecord');
    const sourceText = sourceRecord !== null && typeof sourceRecord === 'object' && !Array.isArray(sourceRecord) ? ['work_desc','description','primary_address','sourceAddress','title'].map(key => sourceRecord[key]).filter(item => typeof item === 'string') : [];
    const names = carriers.flatMap(code => { const found = registry.carriers.find(item => item.code === code); return found ? [code,found.name,...found.aliases] : [code]; });
    const searchable = [id,name,...names,...extra,...places,...aliases,...sourceText,spec.label].join(' ').toLowerCase();
    /** @type {CatalogRecord} */
    const record = {key:`${spec.id}:${id}`,id,layer:spec.id,lat,lon,name,carriers,radio:radioKind,nci,eci,tac,pci,channel,detailPath:detailFile,detailIndex,columns:data.columns,cells,role:spec.coordinateRole,text:searchable};
    return record;
  });
  if (new Set(records.map(record => record.id)).size !== records.length || records.filter(record => record.lat !== null).length !== spec.locatedCount) fail(spec.id,'duplicate IDs or coordinate count mismatch');
  return records;
}
/** @param {string} value @param {string} selectedLayer @param {string} carrier @param {string} selectedRadio @param {Registry} registry @returns {Query} */
export function compileQuery(value,selectedLayer,carrier,selectedRadio,registry) {
  if (selectedLayer && !LAYERS.some(id => id === selectedLayer)) fail('layer filter','unsupported layer');
  if (carrier && !registry.carriers.some(item => item.code === carrier)) fail('carrier filter','unknown registry code');
  if (selectedRadio !== '' && selectedRadio !== 'lte' && selectedRadio !== 'nr' && selectedRadio !== 'none') fail('radio filter','unsupported radio');
  const terms = parseSearch(value); const words = terms.filter(term => term.kind === 'text').map(term => term.value);
  const pcis = terms.filter(term => term.kind === 'pci').map(term => term.value); const channels = terms.filter(term => term.kind === 'channel').map(term => term.value); const radios = terms.filter(term => term.kind === 'radio').map(term => term.value);
  /** @type {string[][]} */ const networks = []; /** @type {string[]} */ const remaining = [];
  if (carrier || (selectedRadio && selectedRadio !== 'none') || pcis.length || channels.length || radios.length) {
    for (let index = 0; index < words.length;) {
      let lengthMatched = 0;
      /** @type {string[]} */ let codes = [];
      for (let length = Math.min(8,words.length - index); length > 0; length -= 1) { const phrase = normalizedAlias(words.slice(index,index + length).join(' ')); const matched = registry.carriers.filter(item => [item.code,item.name,...item.aliases].some(alias => normalizedAlias(alias) === phrase)); if (matched.length) { lengthMatched = length; codes = matched.map(item => item.code); break; } }
      if (lengthMatched) { networks.push(codes); index += lengthMatched; } else { remaining.push(words[index]); index += 1; }
    }
  } else remaining.push(...words);
  return {terms,text:remaining,networks,layer:selectedLayer,carrier,radio:selectedRadio,pcis,channels,radios};
}
/** @param {string} code @param {Query} query @returns {boolean} */
export function networkMatches(code,query) { return (!query.carrier || code === query.carrier) && query.networks.every(group => group.includes(code)); }
/** @param {Radio} value @param {Query} query @returns {boolean} */
export function radioMatches(value,query) { return query.radio !== 'none' && (!query.radio || value === query.radio) && query.radios.every(expected => expected === value); }
/** Broad coverage candidates are subsequently qualified by native posting indexes/wire. @param {CatalogRecord} record @param {Query} query @returns {boolean} */
export function recordMatches(record,query) {
  if (query.layer && record.layer !== query.layer) return false;
  if (!query.text.every(word => record.text.includes(word))) return false;
  if (query.terms.some(term => term.kind === 'nci' && record.nci !== term.value || term.kind === 'eci' && record.eci !== term.value || term.kind === 'tac' && record.tac !== term.value || term.kind === 'grid' && (record.layer !== 'coverage' || record.id.toLowerCase() !== term.value))) return false;
  if (query.carrier || query.networks.length) { if (!record.carriers.some(code => networkMatches(code,query))) return false; }
  if (record.layer === 'coverage') return query.radio !== 'none';
  if (query.radio === 'none' && record.radio !== null) return false;
  if ((query.radio && query.radio !== 'none') || query.radios.length) { if (record.radio === null || !radioMatches(record.radio,query)) return false; }
  if (!query.pcis.every(value => record.pci === value) || !query.channels.every(value => record.channel === value)) return false;
  return true;
}
/** @param {Posting|IndexPosting} posting @param {Query} query @returns {boolean} */
export function postingMatches(posting,query) { return networkMatches(posting.carrier,query) && radioMatches(posting.radio,query) && (!('channel' in posting) || query.channels.every(value => posting.channel === value)) && (!('pcis' in posting) || query.pcis.every(value => posting.pcis.includes(value))); }
/** @param {JsonValue} value @returns {PciIndex} */
export function validatePciIndex(value) { const input = object(value,'PCI index'); const values = array(input.values,'PCI values',2000).map(item => required(item,'PCI value')); values.forEach(value => { if (decimal(value,'PCI',18446744073709551615n) === null) fail('PCI','missing value'); }); const files = object(input.radioFiles,'radioFiles'); return {values,radioFiles:{lte:detailPath(required(files.lte,'radioFiles.lte')),nr:detailPath(required(files.nr,'radioFiles.nr'))}}; }
/** @param {JsonValue} value @returns {IndexPosting[]} */
function indexRows(value) { const data = columnar(value,'posting index',1000000); if (data.columns.join(',') !== 'id,radio,carrier,references') fail('posting index','unexpected columns'); return data.rows.map(row => ({id:required(row[0],'posting.id'),radio:radio(row[1],'posting.radio'),carrier:network(row[2],'posting.carrier'),references:integer(row[3],'posting.references',100000000)})); }
/** @param {JsonValue} value @param {string} pci @returns {IndexPosting[]} */
export function validatePciPostings(value,pci) { const input = object(value,'PCI posting index'); if (input.version !== 1 || input.pci !== pci) fail('PCI posting index','version or requested PCI mismatch'); return indexRows(input); }
/** @param {JsonValue} value @param {Radio} expected @returns {IndexPosting[]} */
export function validateRadioPostings(value,expected) { const input = object(value,'radio posting index'); if (input.version !== 1 || input.radio !== expected) fail('radio posting index','version or requested radio mismatch'); const rows = indexRows(input); if (rows.some(row => row.radio !== expected)) fail('radio posting index','mixed radio rows'); return rows; }
/** @param {JsonValue} value @param {string} path @param {number} depth @returns {WireEntry[]} */
function wire(value,path,depth) { if (depth > 16) fail(path,'wire nesting exceeds native schema limit'); return array(value,path,10000).map((item,index) => { const entry = array(item,`${path}[${index}]`,2); if (entry.length !== 2) fail(path,'expected tag/value wire pairs'); const tag = integer(entry[0],`${path}.tag`,10000); if (tag === 0) fail(path,'zero protobuf tag'); const raw = entry[1]; if (Array.isArray(raw)) return [tag,wire(raw,path,depth + 1)]; if (typeof raw === 'number') return [tag,integer(raw,path,Number.MAX_SAFE_INTEGER)]; const decimalValue = decimal(raw,path,18446744073709551615n); if (decimalValue === null) fail(path,'null wire scalar'); return [tag,decimalValue]; }); }
/** @param {JsonValue} value @returns {CoverageDetail[]} */
export function validateCoverageChunk(value) { const data = columnar(value,'coverage chunk',1000); if (!data.columns.includes('wire') || !data.columns.includes('id')) fail('coverage chunk','required id/wire columns missing'); return data.rows.map(cells => { const raw = Object.fromEntries(data.columns.map((column,index) => [column,cells[index]])); return {id:required(raw.id,'coverage detail ID'),raw,wire:wire(raw.wire,'coverage wire',0)}; }); }
/** @param {WireEntry[]} entries @param {number} tag @returns {WireEntry[][]} */
function children(entries,tag) { return entries.flatMap(entry => entry[0] === tag && Array.isArray(entry[1]) ? [entry[1]] : []); }
/** @param {WireEntry[]} entries @param {number} tag @returns {string|null} */
function scalar(entries,tag) { const entry = entries.find(item => item[0] === tag && !Array.isArray(item[1])); return !entry || Array.isArray(entry[1]) ? null : String(entry[1]); }
/** @param {CoverageDetail} detail @returns {Posting[]} */
export function coveragePostings(detail) {
  return children(detail.wire,4).flatMap(plmn => {
    const mcc = scalar(plmn,1); const mnc = scalar(plmn,2); const carrier = mcc !== null && mnc !== null ? `${mcc}/${mnc}` : '';
    return children(plmn,5).flatMap(tower => [3,4].flatMap(slot => children(tower,slot).map(entry => ({radio:slot === 3 ? 'lte' : 'nr',carrier,channel:scalar(entry,1),pcis:children(entry,slot === 3 ? 5 : 6).flatMap(pci => { const id = scalar(pci,1); return id === null ? [] : [id]; }),band:scalar(entry,2),count:scalar(entry,3),rsrpRaw:scalar(entry,4)}))));
  });
}
/** @param {JsonValue} value @returns {Tour} */
export function validateTour(value) { const raw = object(value,'Flyover tour'); if (jsonSize(raw,'tour',0) > 200000) fail('tour','payload is too large'); const data = columnar(raw.cameraPath,'cameraPath',1000); const frames = data.rows.map(cells => ({ordinal:integer(cell(data.columns,cells,'frameOrdinal'),'frameOrdinal',10000),lat:numeric(cell(data.columns,cells,'lat'),'frame latitude',-90,90),lon:numeric(cell(data.columns,cells,'lon'),'frame longitude',-180,180)})); return {raw,frames}; }
/** @param {JsonValue} value @returns {Land} */
export function validateLand(value) {
  const input = object(value,'land'); if (input.type !== 'FeatureCollection') fail('land','expected GeoJSON FeatureCollection');
  return array(input.features,'land.features',1000).flatMap(item => { const feature = object(item,'land feature'); const geometry = object(feature.geometry,'land geometry'); const raw = array(geometry.coordinates,'land coordinates',10000); const polygons = geometry.type === 'Polygon' ? [raw] : geometry.type === 'MultiPolygon' ? raw.map(polygon => array(polygon,'land polygon',10000)) : fail('land geometry','only Polygon and MultiPolygon are supported'); return polygons.flatMap(polygon => polygon.map(ring => array(ring,'land ring',100000).map(coordinate => { const pair = array(coordinate,'land coordinate',3); return {lon:numeric(pair[0],'land longitude',-180,180),lat:numeric(pair[1],'land latitude',-90,90)}; }))); });
}
/** @param {number} lat @param {number} lon @returns {{x:number,y:number}} */
export function mercator(lat,lon) { const limited = Math.max(-85.05112878,Math.min(85.05112878,lat)); return {x:lon,y:Math.log(Math.tan(Math.PI / 4 + limited * Math.PI / 360)) * 180 / Math.PI}; }
