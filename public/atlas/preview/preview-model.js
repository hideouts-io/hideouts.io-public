/**
 * Pure boundary validation, identity search, and geographic projection for the
 * selected public test-area dataset. Grid postings stay qualified by radio,
 * network, and channel; their PCI values are never assigned to a full cell ID.
 * Values in raw are already selected by the local export, and are preserved.
 */

/** @typedef {import('./preview-types.js').JsonObject} JsonObject */
/** @typedef {import('./preview-types.js').JsonValue} JsonValue */
/** @typedef {'lte'|'nr'|'independentLte'|'independentNr'|'coverage'|'outliers'|'wifi'|'smallCells'|'registeredSites'|'documentedPlans'} Layer */
/** @typedef {'lte'|'nr'} Radio */
/** @typedef {{id:string,title:string,url:string|null,scope:string,licenseUrl:string|null,attributionUrl:string|null}} EvidenceSource */
/** @typedef {{code:string,name:string,aliases:string[],status:string,asOf:string|null,note:string,sourceIds:string[]}} Carrier */
/** @typedef {{radio:Radio,carrier:string,channel:string|null,pcis:string[]}} Posting */
/** @typedef {{key:string,id:string,layer:Layer,lat:number|null,lon:number|null,carrier:string,carrierName:string,radio:Radio|null,nci:string|null,eci:string|null,tac:string|null,channel:string|null,pci:string|null,contextPcis:string[],postings:Posting[],coordinateRole:string,sourceIds:string[],observationTime:string|null,raw:JsonObject}} EvidenceRecord */
/** @typedef {{recordKey:string,gridId:string,pcis:string[]}} TargetContext */
/** @typedef {{recordKeys:string[],nci:string,carrier:string,tac:string,contexts:TargetContext[],verifiedPci:null,verifiedSite:null}} Target */
/** @typedef {{lat:number,lon:number,radiusMetres:number}} StudyArea */
/** @typedef {{version:1,checkedAt:string,studyArea:StudyArea,sources:EvidenceSource[],carriers:Carrier[],records:EvidenceRecord[],target:Target,coverageSchema:JsonObject,scope:JsonObject}} Dataset */
/** @typedef {{kind:'nci'|'eci'|'tac'|'pci'|'grid'|'radio'|'channel'|'text',value:string}} SearchTerm */
/** @typedef {{terms:SearchTerm[],carrier:string,radio:''|'lte'|'nr'|'none',layer:string,source:string}} Filters */
/** @typedef {{east:number,north:number}} Position */
/** @typedef {{carrierGroups:string[][],textTerms:SearchTerm[]}} QualifiedText */

/** @type {Readonly<Record<Layer,string>>} */
export const LAYER_LABELS = Object.freeze({lte:'LTE source estimate',nr:'NR source estimate',independentLte:'Independent LTE estimate',independentNr:'Independent NR estimate',coverage:'Coverage-grid center',outliers:'Raw PCI outlier context',wifi:'Wi-Fi source estimate',smallCells:'Administrative pole location',registeredSites:'Permit address record',documentedPlans:'Unplotted engineering plan'});
/** @type {readonly Layer[]} */
export const LAYERS = Object.freeze(['lte','nr','coverage','outliers','wifi','smallCells','registeredSites','independentLte','independentNr','documentedPlans']);

/** @param {string} path @param {string} expectation @returns {never} */
function invalid(path, expectation) {
  throw new Error(`Invalid public dataset at ${path}: ${expectation}.`);
}

/** @param {JsonValue} value @param {string} path @returns {JsonObject} */
function objectAt(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path, 'expected an object');
  return value;
}

/** @param {JsonValue} value @param {string} path @param {number} limit @returns {JsonValue[]} */
function arrayAt(value, path, limit) {
  if (!Array.isArray(value) || value.length > limit) invalid(path, `expected an array with at most ${limit} entries`);
  return value;
}

/** @param {JsonValue} value @param {string} path @param {number} limit @returns {string} */
function stringAt(value, path, limit) {
  if (typeof value !== 'string' || value.length > limit) invalid(path, `expected a string of at most ${limit} characters`);
  return value;
}

/** @param {JsonValue} value @param {string} path @param {number} limit @returns {string} */
function requiredStringAt(value, path, limit) {
  const text = stringAt(value,path,limit);
  if (text.trim().length === 0) invalid(path, 'expected a nonempty string');
  return text;
}

/** @param {JsonValue} value @param {string} path @param {number} low @param {number} high @returns {number} */
function numberAt(value, path, low, high) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) invalid(path, `expected a finite number from ${low} to ${high}`);
  return value;
}

/** @param {JsonValue} value @param {string} path @returns {string|null} */
function nullableStringAt(value, path) {
  return value === null ? null : requiredStringAt(value, path, 250);
}

/** @param {JsonValue} value @param {string} path @returns {string} */
function networkAt(value, path) {
  const text = requiredStringAt(value, path, 7);
  if (!/^\d{1,3}\/\d{1,3}$/.test(text)) invalid(path, 'expected the original numeric MCC/MNC code such as 310/260; leading zeroes are not invented');
  return text;
}

/** @param {JsonValue} value @param {string} path @param {bigint} maximum @returns {string|null} */
function nullableIdentityAt(value, path, maximum) {
  if (value === null) return null;
  const text = requiredStringAt(value, path, 20);
  if (!/^(0|[1-9]\d*)$/.test(text) || BigInt(text) > maximum) invalid(path, `expected a decimal integer string from 0 to ${maximum}`);
  return text;
}

/** @param {JsonValue} value @param {string} path @param {number} maximum @returns {string[]} */
function stringsAt(value, path, maximum) {
  return arrayAt(value, path, maximum).map((item, index) => requiredStringAt(item, `${path}[${index}]`, 500));
}

/** Raw wire PCI values are uint64; values outside radio domains remain visible as outliers. @param {JsonValue} value @param {string} path @returns {string[]} */
function pcisAt(value, path) {
  return arrayAt(value, path, 1024).map((item, index) => {
    const pci = nullableIdentityAt(item, `${path}[${index}]`, 18446744073709551615n);
    if (pci === null) invalid(`${path}[${index}]`, 'a PCI must be a decimal string');
    return pci;
  });
}

/** @param {JsonValue} value @param {string} path @returns {Radio} */
function radioAt(value, path) {
  if (value !== 'lte' && value !== 'nr') invalid(path, 'expected lte or nr');
  return value;
}

/** @param {JsonValue} value @param {string} path @returns {Layer} */
function layerAt(value, path) {
  switch (value) {
    case 'lte': case 'nr': case 'independentLte': case 'independentNr': case 'coverage': case 'outliers': case 'wifi': case 'smallCells': case 'registeredSites': case 'documentedPlans': return value;
    default: return invalid(path, 'expected a supported coordinate/source layer');
  }
}

/** @param {JsonValue} value @param {string} path @param {number} depth @returns {number} */
function validateRaw(value, path, depth) {
  if (depth > 20) invalid(path, 'source field nesting exceeds 20 levels');
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'string') { stringAt(value, path, 100000); return 1; }
  if (typeof value === 'number') { numberAt(value, path, -Number.MAX_VALUE, Number.MAX_VALUE); return 1; }
  if (Array.isArray(value)) {
    if (value.length > 20000) invalid(path, 'source array exceeds 20000 entries');
    return 1 + value.reduce(/** @param {number} count */ (count, child, index) => count + validateRaw(child, `${path}[${index}]`, depth + 1), 0);
  }
  const entries = Object.entries(value);
  if (entries.length > 1000) invalid(path, 'source object exceeds 1000 fields');
  return 1 + entries.reduce((count, [key, child]) => {
    if (key.length > 250) invalid(path, 'source field name exceeds 250 characters');
    return count + validateRaw(child, `${path}.${key}`, depth + 1);
  }, 0);
}

/** @param {JsonValue} value @param {string} path @returns {string|null} */
function sourceUrlAt(value, path) {
  const url = value === null || value === undefined ? null : requiredStringAt(value, path, 2000);
  if (url !== null) {
    let parsed;
    try { parsed = new URL(url); } catch { invalid(path, 'expected an absolute HTTPS source URL'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalid(path, 'expected an HTTPS source URL without credentials');
  }
  return url;
}

/** @param {JsonValue} value @param {string} path @returns {EvidenceSource} */
function sourceAt(value, path) {
  const input = objectAt(value, path);
  return {id:requiredStringAt(input.id, `${path}.id`, 150),title:requiredStringAt(input.title, `${path}.title`, 500),url:sourceUrlAt(input.url, `${path}.url`),scope:requiredStringAt(input.scope, `${path}.scope`, 3000),licenseUrl:sourceUrlAt(input.licenseUrl, `${path}.licenseUrl`),attributionUrl:sourceUrlAt(input.attributionUrl, `${path}.attributionUrl`)};
}

/** @param {JsonValue} value @param {string} path @returns {Carrier} */
function carrierAt(value, path) {
  const input = objectAt(value, path);
  return {code:networkAt(input.code, `${path}.code`),name:requiredStringAt(input.name, `${path}.name`, 250),aliases:stringsAt(input.aliases, `${path}.aliases`, 30),status:input.status === undefined ? 'unresolved' : requiredStringAt(input.status, `${path}.status`, 100),asOf:input.asOf === undefined ? null : nullableStringAt(input.asOf, `${path}.asOf`),note:input.note === undefined ? '' : stringAt(input.note, `${path}.note`, 3000),sourceIds:input.sourceIds === undefined ? [] : stringsAt(input.sourceIds, `${path}.sourceIds`, 30)};
}

/** @param {JsonValue} value @param {string} path @returns {Posting} */
function postingAt(value, path) {
  const input = objectAt(value, path);
  const radio = radioAt(input.radio, `${path}.radio`);
  return {radio,carrier:networkAt(input.carrier, `${path}.carrier`),channel:nullableIdentityAt(input.channel, `${path}.channel`, 3279165n),pcis:pcisAt(input.pcis, `${path}.pcis`)};
}

/** @param {JsonValue} value @param {string} path @returns {EvidenceRecord} */
function recordAt(value, path) {
  const input = objectAt(value, path);
  const layer = layerAt(input.layer, `${path}.layer`);
  const radio = input.radio === null ? null : radioAt(input.radio, `${path}.radio`);
  const lat = input.lat === null ? null : numberAt(input.lat, `${path}.lat`, -90, 90);
  const lon = input.lon === null ? null : numberAt(input.lon, `${path}.lon`, -180, 180);
  if ((lat === null) !== (lon === null)) invalid(path, 'latitude and longitude must both be present or both be null');
  const carrier = stringAt(input.carrier, `${path}.carrier`, 1000);
  if (carrier) carrier.split(', ').forEach(code => networkAt(code, `${path}.carrier`));
  const raw = objectAt(input.raw, `${path}.raw`);
  if (validateRaw(raw, `${path}.raw`, 0) > 50000) invalid(`${path}.raw`, 'source fields exceed 50000 values');
  const postings = arrayAt(input.postings, `${path}.postings`, 2000).map((posting, index) => postingAt(posting, `${path}.postings[${index}]`));
  const pci = nullableIdentityAt(input.pci, `${path}.pci`, 18446744073709551615n);
  const nci = nullableIdentityAt(input.nci, `${path}.nci`, 68719476735n);
  const eci = nullableIdentityAt(input.eci, `${path}.eci`, 268435455n);
  if (nci !== null && eci !== null) invalid(path, 'a record cannot have both an LTE ECI and NR NCI');
  if (nci !== null && radio !== 'nr') invalid(path, 'an NCI record must have radio nr');
  if (eci !== null && radio !== 'lte') invalid(path, 'an ECI record must have radio lte');
  if ((nci !== null || eci !== null) && postings.length > 0) invalid(path, 'coverage postings must not be attached as identity assignments');
  return {key:requiredStringAt(input.key, `${path}.key`, 250),id:requiredStringAt(input.id, `${path}.id`, 250),layer,lat,lon,carrier,carrierName:stringAt(input.carrierName, `${path}.carrierName`, 250),radio,nci,eci,tac:nullableIdentityAt(input.tac, `${path}.tac`, 16777215n),channel:nullableIdentityAt(input.channel, `${path}.channel`, 3279165n),pci,contextPcis:pcisAt(input.contextPcis, `${path}.contextPcis`),postings,coordinateRole:requiredStringAt(input.coordinateRole, `${path}.coordinateRole`, 2000),sourceIds:stringsAt(input.sourceIds, `${path}.sourceIds`, 30),observationTime:input.observationTime === undefined || input.observationTime === null ? null : requiredStringAt(input.observationTime, `${path}.observationTime`, 250),raw};
}

/**
 * Validate untrusted JSON without forwarding unrelated top-level/provider fields.
 * @param {JsonValue} value @returns {Dataset}
 */
export function validateDataset(value) {
  const input = objectAt(value, 'dataset');
  if (input.version !== 1) invalid('version', 'expected public preview schema version 1');
  const checkedAt = requiredStringAt(input.checkedAt, 'checkedAt', 100);
  if (!Number.isFinite(Date.parse(checkedAt))) invalid('checkedAt', 'expected a parseable review timestamp');
  const areaInput = objectAt(input.studyArea, 'studyArea');
  const studyArea = {lat:numberAt(areaInput.lat, 'studyArea.lat', -90, 90),lon:numberAt(areaInput.lon, 'studyArea.lon', -180, 180),radiusMetres:numberAt(areaInput.radiusMetres, 'studyArea.radiusMetres', 1, 5000)};
  if (studyArea.lat !== 34.05 || studyArea.lon !== -118.25 || studyArea.radiusMetres !== 5000) invalid('studyArea', 'this review is restricted to the authorized 5 km public area centered at 34.05, -118.25');
  const sources = arrayAt(input.sources, 'sources', 200).map((source, index) => sourceAt(source, `sources[${index}]`));
  if (new Set(sources.map(source => source.id)).size !== sources.length) invalid('sources', 'source IDs must be unique');
  const sourceIds = new Set(sources.map(source => source.id));
  const records = arrayAt(input.records, 'records', 50000).map((record, index) => recordAt(record, `records[${index}]`));
  if (records.length === 0) invalid('records', 'the review must contain actual public test records');
  const recordKeys = new Set(records.map(record => record.key));
  if (recordKeys.size !== records.length) invalid('records', 'record keys must be unique');
  for (const record of records) {
    if (record.sourceIds.length === 0 || record.sourceIds.some(id => !sourceIds.has(id))) invalid(`record ${record.key}.sourceIds`, 'each record must refer to at least one known evidence source');
    if (record.lat !== null && record.lon !== null && distanceMetres(studyArea.lat, studyArea.lon, record.lat, record.lon) > 5001) invalid(`record ${record.key}`, 'record coordinates fall outside the public study radius');
  }
  const suppliedCarriers = input.carriers === undefined ? [] : arrayAt(input.carriers, 'carriers', 200).map((carrier, index) => carrierAt(carrier, `carriers[${index}]`));
  if (new Set(suppliedCarriers.map(carrier => carrier.code)).size !== suppliedCarriers.length) invalid('carriers', 'network codes must be unique');
  const carriers = [...new Set([...suppliedCarriers.map(carrier => carrier.code),...records.flatMap(record => record.carrier ? record.carrier.split(', ') : []),...records.flatMap(record => record.postings.map(posting => posting.carrier))])].sort().map(code => {
    const supplied = suppliedCarriers.find(carrier => carrier.code === code);
    if (supplied) return supplied;
    const named = records.find(record => record.carrier === code && record.carrierName);
    return {code,name:named ? named.carrierName : 'Network name unresolved',aliases:[],status:'unresolved',asOf:null,note:'',sourceIds:[]};
  });
  const targetInput = objectAt(input.target, 'target');
  const targetRecordKeys = stringsAt(targetInput.recordKeys, 'target.recordKeys', 20);
  if (targetInput.nci !== '7587668269' || targetInput.carrier !== '310/260' || targetInput.tac !== '3960320') invalid('target', 'expected the documented public NCI 7587668269 case, network 310/260, TAC 3960320');
  if (targetInput.verifiedPci !== null || targetInput.verifiedSite !== null) invalid('target', 'PCI assignment and physical site are unresolved in this reviewed export');
  if (targetRecordKeys.length < 2 || targetRecordKeys.some(key => !recordKeys.has(key))) invalid('target.recordKeys', 'expected at least two existing target source records');
  if (targetRecordKeys.some(key => !records.some(record => record.key === key && record.nci === '7587668269' && record.carrier === '310/260' && record.tac === '3960320' && record.pci === null))) invalid('target.recordKeys', 'target records must retain the full identity, TAC, and unassigned PCI');
  const contexts = arrayAt(targetInput.contexts, 'target.contexts', 20).map((context, index) => {
    const item = objectAt(context, `target.contexts[${index}]`);
    const recordKey = requiredStringAt(item.recordKey, `target.contexts[${index}].recordKey`, 250);
    const gridId = requiredStringAt(item.gridId, `target.contexts[${index}].gridId`, 250);
    if (!records.some(record => record.key === recordKey && record.layer === 'coverage' && record.id === gridId)) invalid(`target.contexts[${index}].recordKey`, 'expected an existing coverage-grid context record');
    return {recordKey,gridId,pcis:pcisAt(item.pcis, `target.contexts[${index}].pcis`)};
  });
  const coverageSchema = objectAt(input.coverageSchema, 'coverageSchema');
  const scope = objectAt(input.scope, 'scope');
  validateRaw(coverageSchema, 'coverageSchema', 0);
  validateRaw(scope, 'scope', 0);
  if (scope.localReviewOnly !== false || scope.publicationAuthorized !== true || scope.releaseType !== 'research-preview' || scope.syntheticRecords !== 0) invalid('scope', 'expected the authorized research-preview release contract with actual data and no synthetic records');
  return {version:1,checkedAt,studyArea,sources,carriers,records,target:{recordKeys:targetRecordKeys,nci:'7587668269',carrier:'310/260',tac:'3960320',contexts,verifiedPci:null,verifiedSite:null},coverageSchema,scope};
}

/** @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2 @returns {number} */
export function distanceMetres(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/** Equirectangular display projection, centered on the public study area. @param {number} lat @param {number} lon @param {StudyArea} area @returns {Position} */
export function project(lat, lon, area) {
  return {east:(lon - area.lon) * Math.PI / 180 * 6371008.8 * Math.cos(area.lat * Math.PI / 180),north:(lat - area.lat) * Math.PI / 180 * 6371008.8};
}

/** @param {number} east @param {number} north @param {StudyArea} area @returns {{lat:number,lon:number}} */
export function unproject(east, north, area) {
  return {lat:area.lat + north / 6371008.8 * 180 / Math.PI,lon:area.lon + east / (6371008.8 * Math.cos(area.lat * Math.PI / 180)) * 180 / Math.PI};
}

/** Parse only supported exact prefixes; malformed identities do not become broad text queries. @param {string} query @returns {SearchTerm[]} */
export function parseSearch(query) {
  if (query.length > 500) throw new Error('Search is limited to 500 characters. Use a full cell ID, PCI, grid ID, or carrier name.');
  return query.trim().split(/\s+/).filter(Boolean).map(/** @returns {SearchTerm} */ token => {
    const colon = token.indexOf(':');
    if (colon < 0) return {kind:'text',value:token.toLowerCase()};
    const prefix = token.slice(0, colon).toLowerCase();
    const value = token.slice(colon + 1);
    const kind = prefix === 'ci' ? 'eci' : prefix === 'arfcn' ? 'channel' : prefix;
    if (kind !== 'nci' && kind !== 'eci' && kind !== 'tac' && kind !== 'pci' && kind !== 'grid' && kind !== 'radio' && kind !== 'channel') throw new Error(`Unsupported search prefix “${prefix}”. Use nci, eci, tac, pci, grid, radio, or channel.`);
    if (kind === 'grid') {
      if (!/^[a-z0-9_-]{1,100}$/i.test(value)) throw new Error('A grid search needs an exact grid ID, for example grid:C59904.');
      return {kind:'grid',value:value.toLowerCase()};
    }
    if (kind === 'radio') {
      if (!['lte','nr'].includes(value.toLowerCase())) throw new Error('A radio search must be radio:lte or radio:nr.');
      return {kind:'radio',value:value.toLowerCase()};
    }
    const maximum = kind === 'nci' ? 68719476735n : kind === 'eci' ? 268435455n : kind === 'tac' ? 16777215n : kind === 'channel' ? 3279165n : 18446744073709551615n;
    if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 20 || BigInt(value) > maximum) throw new Error(`Invalid ${kind.toUpperCase()} search. Use a decimal integer from 0 to ${maximum}, without a sign, exponent, or hex prefix.`);
    return {kind,value};
  });
}

/** @param {EvidenceRecord} record @param {Dataset} dataset @returns {string} */
export function carrierLabel(record, dataset) {
  if (record.carrier && !record.carrier.includes(',')) {
    const carrier = dataset.carriers.find(item => item.code === record.carrier);
    return `${carrier ? carrier.name : record.carrierName || 'Network name unresolved'} · ${record.carrier}`;
  }
  const codes = [...new Set(record.postings.map(posting => posting.carrier))];
  if (codes.length === 1) {
    const carrier = dataset.carriers.find(item => item.code === codes[0]);
    return `${carrier ? carrier.name : 'Network name unresolved'} · ${codes[0]}`;
  }
  return codes.length > 1 ? `${codes.length} networks in qualified postings` : 'No cell network identity supplied';
}

/** @param {EvidenceRecord} record @param {Dataset} dataset @returns {string} */
function searchableText(record, dataset) {
  const codes = [...new Set([...(record.carrier ? record.carrier.split(', ') : []),...record.postings.map(posting => posting.carrier)].filter(Boolean))];
  const carrierText = codes.flatMap(code => {
    const carrier = dataset.carriers.find(item => item.code === code);
    return carrier ? [carrier.code,carrier.name,...carrier.aliases] : [code];
  });
  const rawName = typeof record.raw.name === 'string' ? record.raw.name : '';
  const rawCell = typeof record.raw.cellId === 'string' || typeof record.raw.cellId === 'number' ? String(record.raw.cellId) : '';
  const places = Array.isArray(record.raw.derivedPlaceNames) ? record.raw.derivedPlaceNames.filter(place => typeof place === 'string') : [];
  const descriptiveFields = ['work_desc','description','siteCode','usid','poleId','plannedCarrierName','sourceId','kind'];
  const rawDescription = descriptiveFields.map(key => record.raw[key]).filter(value => typeof value === 'string' || typeof value === 'number');
  const sourceRecord = record.raw.rawSourceRecord;
  const sourceDescription = sourceRecord && typeof sourceRecord === 'object' && !Array.isArray(sourceRecord) ? ['work_desc','description','address','full_address','primary_address','slid','street_address','work_description'].map(key => sourceRecord[key]).filter(value => typeof value === 'string' || typeof value === 'number') : [];
  const aliases = Array.isArray(record.raw.aliases) ? record.raw.aliases.filter(alias => typeof alias === 'string') : [];
  return [record.id,record.key,rawName,rawCell,...places,...rawDescription,...sourceDescription,...aliases,LAYER_LABELS[record.layer],record.coordinateRole,record.carrierName,record.radio || '',record.nci || '',record.eci || '',record.tac || '',...carrierText].join(' ').toLowerCase();
}

/** @param {string} value @returns {string} */
function normalizedCarrierAlias(value) { return value.toLowerCase().replace(/[^\p{L}\p{N}/]+/gu,''); }

/** Bind recognized carrier phrases/codes to the same radio/channel/PCI posting. @param {Filters} filters @param {Dataset} dataset @returns {QualifiedText} */
function qualifiedText(filters, dataset) {
  const textTerms = filters.terms.filter(term => term.kind === 'text');
  if (!filters.carrier && (!filters.radio || filters.radio === 'none') && !filters.terms.some(term => ['pci','radio','channel'].includes(term.kind))) return {carrierGroups:[],textTerms};
  const carrierGroups = [];
  const remaining = [];
  for (let index = 0; index < textTerms.length;) {
    let matchedLength = 0;
    /** @type {string[]} */ let codes = [];
    for (let length = Math.min(8,textTerms.length - index); length > 0; length -= 1) {
      const phrase = normalizedCarrierAlias(textTerms.slice(index,index + length).map(term => term.value).join(' '));
      const matches = dataset.carriers.filter(carrier => [carrier.code,carrier.name,...carrier.aliases].some(alias => normalizedCarrierAlias(alias) === phrase));
      if (matches.length) { matchedLength = length; codes = matches.map(carrier => carrier.code); break; }
    }
    if (matchedLength) { carrierGroups.push(codes); index += matchedLength; }
    else { remaining.push(textTerms[index]); index += 1; }
  }
  return {carrierGroups,textTerms:remaining};
}

/**
 * A posting predicate keeps all PCI/radio/network requirements in one posting.
 * @param {Posting} posting @param {Filters} filters @param {QualifiedText} qualified @returns {boolean}
 */
function postingMatches(posting, filters, qualified) {
  return (!filters.carrier || posting.carrier === filters.carrier) && (!filters.radio || posting.radio === filters.radio) && qualified.carrierGroups.every(group => group.includes(posting.carrier)) && filters.terms.filter(term => term.kind === 'pci').every(term => posting.pcis.includes(term.value)) && filters.terms.filter(term => term.kind === 'radio').every(term => posting.radio === term.value) && filters.terms.filter(term => term.kind === 'channel').every(term => posting.channel === term.value);
}

/** @param {EvidenceRecord} record @param {Filters} filters @param {Dataset} dataset @returns {boolean} */
export function recordMatches(record, filters, dataset) {
  return recordMatchesQualified(record,filters,dataset,qualifiedText(filters,dataset));
}

/** @param {EvidenceRecord} record @param {Filters} filters @param {Dataset} dataset @param {QualifiedText} qualified @returns {boolean} */
function recordMatchesQualified(record, filters, dataset, qualified) {
  if (filters.layer && record.layer !== filters.layer) return false;
  if (filters.source && !record.sourceIds.includes(filters.source)) return false;
  if (filters.radio === 'none' && (record.radio !== null || record.postings.length > 0)) return false;
  const exactPcis = filters.terms.filter(term => term.kind === 'pci');
  const radios = filters.terms.filter(term => term.kind === 'radio');
  const channels = filters.terms.filter(term => term.kind === 'channel');
  const requiresPosting = record.postings.length > 0 && Boolean(filters.carrier || (filters.radio && filters.radio !== 'none') || exactPcis.length || radios.length || channels.length || qualified.carrierGroups.length);
  if (requiresPosting && !record.postings.some(posting => postingMatches(posting, filters,qualified))) return false;
  if (record.postings.length === 0) {
    if (filters.carrier && record.carrier !== filters.carrier) return false;
    if (filters.radio && filters.radio !== 'none' && record.radio !== filters.radio) return false;
    if (!exactPcis.every(term => record.pci !== null && record.pci === term.value)) return false;
    if (!radios.every(term => record.radio === term.value)) return false;
    if (!channels.every(term => record.channel === term.value)) return false;
    if (!qualified.carrierGroups.every(group => group.includes(record.carrier))) return false;
  }
  const text = qualified.textTerms.length ? searchableText(record, dataset) : '';
  if (!qualified.textTerms.every(term => text.includes(term.value))) return false;
  return filters.terms.every(term => {
    if (term.kind === 'nci') return record.nci === term.value;
    if (term.kind === 'eci') return record.eci === term.value;
    if (term.kind === 'tac') return record.tac === term.value;
    if (term.kind === 'grid') return record.layer === 'coverage' && record.id.toLowerCase() === term.value;
    return true;
  });
}

/** @param {Dataset} dataset @param {Filters} filters @returns {EvidenceRecord[]} */
export function filterRecords(dataset, filters) {
  const qualified = qualifiedText(filters,dataset);
  return dataset.records.filter(record => recordMatchesQualified(record, filters, dataset,qualified));
}

/** @param {EvidenceRecord} record @returns {string} */
export function identityLabel(record) {
  if (record.raw.sentinel === true) return `Unknown cell · raw sentinel ${String(record.raw.cellId)}`;
  return record.nci !== null ? `NCI ${record.nci}` : record.eci !== null ? `ECI ${record.eci}` : record.id;
}

/** @param {EvidenceRecord} record @returns {string} */
export function roleExplanation(record) {
  if (record.layer === 'coverage') return 'Coverage-grid center. Qualified PCI postings describe a grid’s network/channel context; they do not assign a PCI or a physical antenna to a full cell ID.';
  if (record.layer === 'smallCells') return 'Administrative pole location. The public City record identifies infrastructure; it does not link this pole to an LTE ECI, NR NCI, or measured PCI.';
  if (record.layer === 'documentedPlans') return 'Permit or plan address. An administrative location is not a surveyed antenna coordinate or a verified full cell identity.';
  if (record.layer === 'registeredSites') return 'Permit address record. An administrative address may describe a proposal, alteration, distributed antenna system, removal, or expired work. It does not establish an active antenna position, carrier tenant, or full cell identity.';
  if (record.layer === 'outliers') return 'Coverage or outlier context supplied by the source. This coordinate has not been verified as an antenna or linked to a full cell identity.';
  if (record.layer === 'wifi') return 'Returned Wi-Fi location estimate. Personal hardware addresses are excluded from this public review; this is not a device location history.';
  return 'Returned location estimate from the named source. It is not an independently surveyed antenna position. Precision, a nearby pole, or agreement between providers does not establish a physical-site link.';
}
