// Coarse aircraft category from an ICAO type code (with the ADS-B emitter
// category as a fallback). Used server-side for type filtering, and sent to the
// client for the silhouette icon so both agree on one classification.

const startsAny = (t, arr) => arr.some((p) => t.startsWith(p));

const HELI = ['R22','R44','R66','EC','AS35','AS55','A109','A119','A139','A149','A169','A189','B06','B407','B412','B427','B429','B430','B47','S76','S92','S61','S64','H125','H130','H135','H145','H155','H160','H175','UH','CH53','CH47','MI8','MI17','NH90','EH10','H500','EC20','EC25','EC30','EC35','EC45','EC55','EC75'];
const TURBOPROP = ['AT4','AT5','AT7','DH8','DHC','SF34','SF3','B190','B350','C208','PC12','PC6','TBM','E120','SW4','D228','D328','F27','AN24','AN26','AN32','C130','L410','BE9','BE10','BE20','BE30','C441','AT2'];
const PISTON = ['C15','C170','C172','C177','C180','C182','C185','C206','C207','C210','C310','C337','C41','P28','PA2','PA3','PA4','SR20','SR22','DA40','DA42','DA62','DA20','M20','BE33','BE35','BE36','BE55','BE58','BE76','AA5','G115','DR40','RV','TB20','C77','C82','P32'];
const BIZJET = ['GLF','GALX','GL5','GL7','GLEX','G280','G150','CL30','CL35','CL60','CL64','LJ','C25','C500','C501','C510','C525','C55','C560','C56','C650','C680','C68','C700','C750','E50P','E55P','E545','E550','FA','F2TH','F900','F2000','H25','HDJT','PRM1','PC24','BE40','ASTR','WW24'];
const REGIONAL = ['CRJ','CL65','E135','E145','E45','E70','E75','E170','E190','E195','E290','E295','RJ85','RJ1','RJ70','B461','B462','B463','F70','F100','SU95','SSJ','AR1','AR8','E13'];
const NARROW = ['A318','A319','A320','A321','A19N','A20N','A21N','A32','B71','B72','B73','B37M','B38M','B39M','B3XM','B75','MD8','MD9','BCS','A223','A221','DC9'];
const WIDE = new Set(['A306','A30B','A310','A3ST','A332','A333','A337','A338','A339','A342','A343','A345','A346','A359','A35K','A388','B741','B742','B743','B744','B748','B74S','B74R','B762','B763','B764','B772','B773','B77L','B77W','B778','B779','B788','B789','B78X','IL96','MD11','DC10','L101','A337']);

function fromAdsbCategory(cat) {
  return { A1: 'piston', A2: 'regional', A3: 'narrowbody', A4: 'narrowbody', A5: 'widebody', A7: 'heli' }[cat] || 'default';
}

export function aircraftCategory(typeCode, adsbCat) {
  const t = (typeCode || '').toUpperCase();
  if (!t) return fromAdsbCategory(adsbCat);
  if (startsAny(t, HELI)) return 'heli';
  if (startsAny(t, TURBOPROP)) return 'turboprop';
  if (startsAny(t, PISTON)) return 'piston';
  if (startsAny(t, BIZJET)) return 'bizjet';
  if (WIDE.has(t)) return 'widebody';
  if (startsAny(t, REGIONAL)) return 'regional';
  if (startsAny(t, NARROW)) return 'narrowbody';
  const c = fromAdsbCategory(adsbCat);
  return c === 'default' ? 'narrowbody' : c;
}

// Map the fine category to the user-facing filter buckets.
const UI = {
  widebody: 'commercial', narrowbody: 'commercial', regional: 'commercial',
  bizjet: 'smalljet',
  turboprop: 'light', piston: 'light',
  heli: 'heli',
  default: 'other',
};
export const UI_CATEGORIES = ['commercial', 'smalljet', 'light', 'heli', 'other'];
export function uiCategory(cat) {
  return UI[cat] || 'other';
}
