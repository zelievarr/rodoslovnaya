const first=(n,t)=>n?.children.find(c=>c.tag===t);
const all=(n,t)=>n?.children.filter(c=>c.tag===t)||[];
const value=(n,t)=>first(n,t)?.value||'';
const privateFlag=n=>!!first(n,'PRIV')||/privacy|private|confidential/i.test(value(n,'RESN'));
export function parseGedcom(text){
 const roots=[],stack=[],warnings=[];let malformed=0;
 for(const line of text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/)){
  if(!line.trim())continue;
  const m=line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([\w]+)(?:\s(.*))?$/);if(!m){malformed++;continue;}
  const level=+m[1],n={tag:m[3],id:m[2],value:m[4]||'',children:[]};
  if(n.tag==='CONT'||n.tag==='CONC'){const p=stack[level-1];if(p)p.value+=(n.tag==='CONT'?'\n':'')+n.value;continue;}
  if(level===0)roots.push(n);else if(stack[level-1])stack[level-1].children.push(n);else warnings.push('Пропущена запись с неверным уровнем вложенности.');
  stack[level]=n;stack.length=level+1;
 }
 const records=new Map(roots.filter(r=>r.id).map(r=>[r.id,r]));
 const labelDefinitions=new Map(roots.filter(r=>r.tag==='LABL'&&r.id).map(r=>[r.id,{id:r.id,title:value(r,'TITL')||r.value||r.id,color:value(r,'COLR')}]));
 const labelsOf=n=>all(n,'LABL').map(ref=>labelDefinitions.get(ref.value)||{id:ref.value,title:ref.value,color:''});
 const isNoteworthy=labels=>labels.some(label=>/заслуживающ[\p{L}]*\s+внимани|noteworthy|notable/iu.test(label.title));
 const isUnconfirmedRelationship=labels=>labels.some(label=>/родств[\p{L}]*\s+не\s+подтвержден|unconfirmed\s+(?:relationship|lineage|kinship)/iu.test(label.title));
 const noteText=n=>{const ref=records.get(n.value);return ref?.tag==='NOTE'?ref.value:n.value;};
 const citation=n=>{
  const ref=records.get(n.value),source=ref?.tag==='SOUR'?ref:n,linked=source!==n;
  const repository=first(source,'REPO'),repo=records.get(repository?.value),data=first(n,'DATA');
  return {id:linked?n.value:'',title:value(source,'TITL')||value(source,'ABBR')||n.value||'Источник без названия',
   author:value(source,'AUTH'),publication:value(source,'PUBL'),reference:all(source,'REFN').map(r=>r.value).join('; '),
   date:value(source,'DATE'),place:value(source,'PLAC'),page:value(n,'PAGE'),quality:value(n,'QUAY'),citationDate:value(data,'DATE'),
   repository:value(repo,'NAME')||repository?.value||'',callNumber:value(repository,'CALN'),
   texts:[...all(source,'TEXT'),...all(first(source,'DATA'),'TEXT'),...(linked?all(n,'TEXT'):[]),...(linked?all(data,'TEXT'):[])].map(t=>t.value),
   notes:[...all(source,'NOTE'),...(linked?all(n,'NOTE'):[])].map(noteText),missing:/^@[^@]+@$/.test(n.value)&&!linked};
 };
 const sources=n=>all(n,'SOUR').map(citation);
 const event=n=>{const labels=labelsOf(n);return {tag:n.tag,type:value(n,'TYPE'),value:n.value==='Y'?'':n.value,date:value(n,'DATE'),place:value(n,'PLAC'),notes:all(n,'NOTE').map(noteText),sources:sources(n),private:privateFlag(n),labels,noteworthy:isNoteworthy(labels)};};
 const people=new Map(),families=[];
 const eventTags=new Set(['BIRT','DEAT','BAPM','CHR','BURI','RESI','OCCU','TITL','CAST','EDUC','RELI','NATI','NATU','EMIG','IMMI','EVEN','FACT','ADOP','_MILT','_MILI']);
 for(const r of roots.filter(r=>r.tag==='INDI')){
  if(!r.id){warnings.push('Человек без идентификатора получил временный номер.');r.id=`@missing-${people.size}@`;}
  if(people.has(r.id))throw new Error('В файле есть повторяющийся идентификатор человека: '+r.id+'. Исправьте дубликат в программе генеалогии.');
  const nameRecords=all(r,'NAME').map(n=>{
   const clean=s=>s.replaceAll('/',' ').replace(/\s+/g,' ').trim();
   const full=clean(n.value),parts=['NPFX','GIVN','SECG','_PATR','SURN','NSFX'].map(t=>value(n,t)).filter(Boolean),composed=clean(parts.join(' '));
   const tokens=s=>s.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]+/gu)||[],fullTokens=tokens(full),composedTokens=new Set(tokens(composed));
   // MacFamilyTree often keeps the patronymic only in SECG while NAME contains
   // just the first name. Prefer the structured form when it preserves every
   // visible word; keep free-form historical names when they contain extra text.
   const text=composed&&fullTokens.every(t=>composedTokens.has(t))?composed:(full||composed),type=value(n,'TYPE').trim().toLowerCase(),surname=value(n,'SURN')||n.value.match(/\/([^/]+)\//)?.[1]||'';
   const surnameOnly=!!surname&&text===surname;
   const label=type==='married'?(surnameOnly?'Фамилия в браке':'Имя в браке'):['birth','maiden'].includes(type)?(surnameOnly?'Фамилия при рождении':'Имя при рождении'):type==='aka'?'Также известен / известна как':type==='immigrant'?'Имя после переселения':type==='religious'?'Религиозное имя':type?'Другой вариант имени ('+value(n,'TYPE')+')':'Другой вариант имени';
   return {text,type,surname,label};
  }).filter(n=>n.text);
  const primary=nameRecords[0],secondary=nameRecords.slice(1),birthRecord=!primary?.surname&&secondary.find(n=>['birth','maiden'].includes(n.type)&&n.surname);
  const hasWord=(text,word)=>text.toLocaleLowerCase('ru').split(/\s+/).includes(word.toLocaleLowerCase('ru'));
  const baseName=primary?(birthRecord&&!hasWord(primary.text,birthRecord.surname)?`${primary.text} ${birthRecord.surname}`:primary.text):'Имя не указано';
  const marriedSurnames=[...new Set(secondary.filter(n=>n.type==='married').map(n=>n.surname||n.text).filter(s=>s&&!hasWord(baseName,s)))];
  const displayName=baseName+(marriedSurnames.length?` (${marriedSurnames.join(', ')})`:''),usedBirth=birthRecord?.text;
  const nameVariants=[...new Set(secondary.filter(n=>n.type!=='married'&&n.text!==usedBirth&&n.text!==baseName).map(n=>n.text))];
  const names=[displayName,...nameRecords.map(n=>n.text)];
  const labels=labelsOf(r),p={id:r.id,name:displayName,baseName,nameVariants,names,nameRecords,sex:value(r,'SEX'),private:privateFlag(r),labels,noteworthy:isNoteworthy(labels),unconfirmedRelationship:isUnconfirmedRelationship(labels),events:r.children.filter(n=>eventTags.has(n.tag)).map(event),notes:all(r,'NOTE').map(noteText),sources:sources(r),parents:[],children:[],spouses:[],associations:[],raw:r,familyChild:all(r,'FAMC').map(n=>({id:n.value,pedigree:value(n,'PEDI'),status:value(n,'STAT')})),familySpouse:all(r,'FAMS').map(n=>n.value)};
  people.set(p.id,p);
 }
 if(!people.size)throw new Error('Содержимое файла не распознано как GEDCOM с записями людей (INDI). Выберите файл GEDCOM — его название и расширение могут быть любыми.');
 for(const r of roots.filter(r=>r.tag==='FAM')){const labels=labelsOf(r);families.push({id:r.id||`@family-${families.length}@`,private:privateFlag(r),labels,noteworthy:isNoteworthy(labels),unconfirmedRelationship:isUnconfirmedRelationship(labels),parents:[...all(r,'HUSB'),...all(r,'WIFE')].map(n=>n.value),children:all(r,'CHIL').map(n=>n.value),events:r.children.filter(n=>['MARR','DIV','EVEN','_MARR','_CIVIL','_COHAB','_PRS'].includes(n.tag)).map(event),notes:all(r,'NOTE').map(noteText),sources:sources(r)});}
 const familyMap=new Map(families.map(f=>[f.id,f]));
 for(const p of people.values()){
  for(const link of p.familyChild){const f=familyMap.get(link.id);if(f){if(!f.children.includes(p.id))f.children.push(p.id);}else warnings.push(`У ${p.name} не найдена родительская семья ${link.id}.`);}
  for(const id of p.familySpouse){const f=familyMap.get(id);if(f&&!f.parents.includes(p.id))f.parents.push(p.id);}
 }
 const links=[];
 for(const f of families){
  for(const id of [...f.parents,...f.children])if(!people.has(id))warnings.push(`Семья ${f.id}: отсутствует запись человека ${id}.`);
  f.parents=[...new Set(f.parents.filter(id=>people.has(id)))];f.children=[...new Set(f.children.filter(id=>people.has(id)))];
  for(const id of f.parents){const p=people.get(id);for(const other of f.parents)if(other!==id&&!p.spouses.includes(other))p.spouses.push(other);}
  for(const child of f.children){const cp=people.get(child),ped=cp.familyChild.find(x=>x.id===f.id);const biological=!ped?.pedigree||/^birth$/i.test(ped.pedigree);const uncertain=/challenged|disproven/i.test(ped?.status||'');
   for(const parent of f.parents){if(parent===child){warnings.push(`Самоссылка родительства у ${cp.name}.`);continue;}const l={parent,child,family:f.id,biological,uncertain,pedigree:ped?.pedigree||''};links.push(l);people.get(parent).children.push(l);cp.parents.push(l);}
  }
 }
 for(const p of people.values()){
  const visit=n=>{if(n.tag==='ASSO'&&people.has(n.value)){p.associations.push({id:n.value,relation:value(n,'RELA')||'Связь из GEDCOM',notes:all(n,'NOTE').map(noteText),sources:sources(n)});}for(const c of n.children)visit(c);};visit(p.raw);
 }
 if(malformed)warnings.push(`Нераспознанных строк: ${malformed}.`);
 return {people,families,links,labels:labelDefinitions,warnings:[...new Set(warnings)]};
}
export function unconfirmedAncestry(data,lineage){
 const roots=new Set([...data.people.values()].filter(p=>p.unconfirmedRelationship).map(p=>p.id)),branchRoots=lineage?new Set([...roots].filter(id=>lineage.has(id))):roots,ancestors=new Set(branchRoots),queue=[...branchRoots];
 for(let i=0;i<queue.length;i++)for(const link of data.people.get(queue[i])?.parents||[])if(!ancestors.has(link.parent)){ancestors.add(link.parent);queue.push(link.parent);}
 return {roots,ancestors};
}
export function dateRu(s=''){
 const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
 return s.replace(/\b(\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{3,4})\b/g,(_,d,m,y)=>`${d.padStart(2,'0')}.${months[m]}.${y}`).replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{3,4})\b/g,(_,m,y)=>`${months[m]}.${y}`).replace(/\b(ABT|CAL|EST|BEF|AFT|BET|AND|FROM|TO|INT)\b/g,m=>({ABT:'ок.',CAL:'расч.',EST:'предп.',BEF:'до',AFT:'после',BET:'между',AND:'и',FROM:'с',TO:'по',INT:'предп.'}[m]));
}
export function dateSortKey(value=''){
 const text=String(value).trim().toUpperCase(),months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
 const numeric=text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{3,4})/),gedcom=text.match(/(?:(\d{1,2})\s+)?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?(\d{3,4})/);if(!numeric&&!gedcom)return Number.POSITIVE_INFINITY;
 const year=+(numeric?.[3]||gedcom[3]),month=+(numeric?.[2]||months[gedcom?.[2]]||0),day=+(numeric?.[1]||gedcom?.[1]||0),within=month?(month-1)*31+(day||15):186,base=year*400+within;
 if(/\bBEF\b|\bДО\b/.test(text))return year*400-1;
 if(/\bAFT\b|\bПОСЛЕ\b/.test(text))return year*400+399;
 return base;
}
export function lifespan(p){const b=p.events.find(e=>e.tag==='BIRT')?.date,d=p.events.find(e=>e.tag==='DEAT')?.date;return b&&d?`${dateRu(b)} — ${dateRu(d)}`:b?`р. ${dateRu(b)}`:d?`ум. ${dateRu(d)}`:'';}
export function traverse(data,start,direction){const distance=new Map([[start,0]]),queue=[start];for(let i=0;i<queue.length;i++){const id=queue[i];for(const l of data.people.get(id)?.[direction]||[]){if(!l.biological||l.uncertain)continue;const next=direction==='parents'?l.parent:l.child;if(!distance.has(next)){distance.set(next,distance.get(id)+1);queue.push(next);}}}return distance;}
export function relatives(data,focus){const ancestors=traverse(data,focus,'parents'),descendants=traverse(data,focus,'children');return {ancestors,descendants,direct:new Set([...ancestors.keys(),...descendants.keys()])};}
export function privacyVisible(data,candidates,focus){
 const ids=new Set(candidates),required=new Set(),reachesPublic=(start,direction)=>{const seen=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++){const p=data.people.get(queue[i]),next=direction==='parents'?p.parents.map(l=>l.parent):p.children.map(l=>l.child);for(const id of next)if(ids.has(id)&&!seen.has(id)){if(!data.people.get(id).private)return true;seen.add(id);queue.push(id);}}return false;};
 for(const id of ids){const p=data.people.get(id);if(p.private&&(id===focus||reachesPublic(id,'parents')&&reachesPublic(id,'children')))required.add(id);}
 return new Set([...ids].filter(id=>!data.people.get(id).private||required.has(id)));
}
export const isGodparentRelation=relation=>/godfather|godmother|godparent|восприем|восприим|кр[её]стн/i.test(relation||'');
// Add the godparents of people in the direct line. When a godparent is also a
// blood relative, include the shortest parent/child chain back to the already
// visible direct line so the card remains attached to its genealogical branch.
export function directWithGodparents(data,direct){
 const visible=new Set(direct),godparents=new Set(),paths=new Map(),anchors=new Map();
 for(const id of direct)for(const association of data.people.get(id)?.associations||[])if(isGodparentRelation(association.relation)&&data.people.has(association.id)){godparents.add(association.id);visible.add(association.id);if(!anchors.has(association.id))anchors.set(association.id,new Set());anchors.get(association.id).add(id);}
 for(const start of godparents){
  if(direct.has(start)){paths.set(start,[start]);continue;}
  const queue=[start],previous=new Map([[start,null]]);let destination;
  for(let i=0;i<queue.length&&!destination;i++){
   const id=queue[i],person=data.people.get(id),neighbors=[...(person?.parents||[]).map(link=>link.parent),...(person?.children||[]).map(link=>link.child)];
   for(const next of neighbors)if(!previous.has(next)){previous.set(next,id);if(direct.has(next)){destination=next;break;}queue.push(next);}
  }
  if(!destination)continue;
  const path=[];for(let id=destination;id;id=previous.get(id))path.push(id);path.reverse();paths.set(start,path);for(const id of path)visible.add(id);
 }
 return {visible,godparents,paths,detachedAnchors:new Map([...anchors].filter(([id])=>!paths.has(id)))};
}
export function compactKinship(text){return String(text??'').replace(/(?:пра){2,}/gi,part=>`пра(${part.length/3})`);}
export function directName(n,sex,up){
 const f=sex==='F',m=sex==='M';
 if(n===1)return up?(f?'мать':m?'отец':'родитель'):(f?'дочь':m?'сын':'ребёнок');
 const prefix='пра'.repeat(Math.max(0,n-2));
 return up?(f?prefix+'бабушка':m?prefix+'дед':prefix+'дед / '+prefix+'бабушка'):(f?prefix+'внучка':m?prefix+'внук':prefix+'внук / '+prefix+'внучка');
}
export function spouseLabel(data,from,to){
 const families=data.families.filter(f=>f.parents.includes(from)&&f.parents.includes(to));
 const events=families.flatMap(f=>f.events);
 const civil=e=>e.tag==='_PRS'||/гражданск|civil|common[ -]?law|cohab|сожитель/i.test(e.type+' '+e.value+' '+e.tag);
 const recorded=e=>e.value.trim().toUpperCase()!=='N';
 const marriage=events.some(e=>recorded(e)&&!civil(e)&&(['MARR','_MARR'].includes(e.tag)||/^(брак|венчание|marriage|wedding)$/i.test(e.type.trim())));
 const informal=events.some(e=>recorded(e)&&civil(e));
 const sex=data.people.get(to).sex;
 if(marriage)return sex==='F'?'жена':sex==='M'?'муж':'супруг / супруга';
 if(informal)return sex==='F'?'гражданская жена':sex==='M'?'гражданский муж':'гражданский супруг / гражданская супруга';
 return 'партнёр';
}
function genitive(text){
 const words={отец:'отца',мать:'матери',родитель:'родителя',сын:'сына',дочь:'дочери',ребёнок:'ребёнка',брат:'брата',сестра:'сестры',дед:'деда',бабушка:'бабушки',внук:'внука',внучка:'внучки',дядя:'дяди',тётя:'тёти',племянник:'племянника',племянница:'племянницы',муж:'мужа',жена:'жены',партнёр:'партнёра',супруг:'супруга',супруга:'супруги',родной:'родного',родная:'родной',гражданский:'гражданского',гражданская:'гражданской',выбранный:'выбранного',человек:'человека',восприемник:'восприемника',восприемница:'восприемницы',приёмный:'приёмного',приёмная:'приёмной'};
 return text.replace(/[А-Яа-яЁё0-9-]+/g,w=>{const lower=w.toLowerCase();if(words[lower])return words[lower];const p=lower.match(/^((?:пра)+)(дед|бабушка|внук|внучка)$/);if(p)return p[1]+words[p[2]];if(/юродный$/.test(lower))return lower.replace(/ый$/,'ого');if(/юродная$/.test(lower))return lower.replace(/ая$/,'ой');return w;});
}
function cousinPrefix(n,sex){const stems={2:'двоюродн',3:'троюродн',4:'четвероюродн',5:'пятиюродн',6:'шестиюродн',7:'семиюродн',8:'восьмиюродн',9:'девятиюродн',10:'десятиюродн',11:'одиннадцатиюродн',12:'двенадцатиюродн'};return (stems[n]||`${n}-юродн`)+(sex==='F'?'ая':'ый');}
function siblingName(order,sex){const noun=sex==='F'?'сестра':sex==='M'?'брат':'брат / сестра';return order===1?noun:cousinPrefix(order,sex)+' '+noun;}
function ancestorPath(data,start,target){const paths=new Map([[start,[start]]]),q=[start];for(let i=0;i<q.length;i++){const id=q[i];if(id===target)return paths.get(id);for(const l of data.people.get(id).parents){if(!l.biological||l.uncertain||paths.has(l.parent))continue;paths.set(l.parent,[...paths.get(id),l.parent]);q.push(l.parent);}}return [];}
function generationDepths(data,start,direction){
 const adjacency=new Map(),reachable=new Set([start]),queue=[start];
 for(let i=0;i<queue.length;i++){
  const id=queue[i],next=[];
  for(const link of data.people.get(id)?.[direction]||[]){
   if(!link.biological||link.uncertain)continue;
   const target=direction==='parents'?link.parent:link.child;
   if(!next.includes(target))next.push(target);
   if(!reachable.has(target)){reachable.add(target);queue.push(target);}
  }
  adjacency.set(id,next);
 }
 const indegree=new Map([...reachable].map(id=>[id,0]));
 for(const next of adjacency.values())for(const id of next)indegree.set(id,(indegree.get(id)||0)+1);
 const ordered=[...indegree].filter(([,degree])=>degree===0).map(([id])=>id);
 for(let i=0;i<ordered.length;i++)for(const id of adjacency.get(ordered[i])||[]){const degree=indegree.get(id)-1;indegree.set(id,degree);if(degree===0)ordered.push(id);}
 // A valid pedigree is acyclic. For malformed cyclic input, retain the safe shortest-path result.
 if(ordered.length!==reachable.size)return new Map([...traverse(data,start,direction)].map(([id,depth])=>[id,new Set([depth])]));
 const depths=new Map([[start,new Set([0])]]);
 for(const id of ordered){const own=depths.get(id);if(!own)continue;for(const target of adjacency.get(id)||[]){if(!depths.has(target))depths.set(target,new Set());const found=depths.get(target);for(const depth of own)found.add(depth+1);}}
 return depths;
}
export function relationships(data,focus,sets){
 const result=new Map([[focus,'Выбранный человек']]);
 for(const [id,depths] of generationDepths(data,focus,'parents'))if(id!==focus)result.set(id,[...depths].sort((a,b)=>a-b).map(depth=>directName(depth,data.people.get(id).sex,true)).join(' / '));
 for(const [id,depths] of generationDepths(data,focus,'children'))if(id!==focus&&!result.has(id))result.set(id,[...depths].sort((a,b)=>a-b).map(depth=>directName(depth,data.people.get(id).sex,false)).join(' / '));
 const f=data.people.get(focus);
 for(const p of data.people.values()){
  if(result.has(p.id))continue;
  const an=traverse(data,p.id,'parents');let best;
  for(const [id,b] of an){const a=sets.ancestors.get(id);if(a!==undefined&&a>0&&b>0&&(!best||a+b<best.a+best.b))best={id,a,b};}
  let text='';
  if(best){const {a,b,id}=best;
   if(a===1&&b===1){const fp=new Set(f.parents.filter(l=>l.biological&&!l.uncertain).map(l=>l.parent));const pp=new Set(p.parents.filter(l=>l.biological&&!l.uncertain).map(l=>l.parent));const both=[...fp].filter(x=>pp.has(x)).length;text=siblingName(1,p.sex);if(both>=2&&['M','F'].includes(p.sex))text=(p.sex==='F'?'родная ':'родной ')+text;else text+=' по общему родителю';}
   else if(a===b)text=siblingName(a,p.sex);
   else if(a===b+1)text=(b>1?cousinPrefix(b,p.sex)+' ':'')+(p.sex==='F'?'тётя':p.sex==='M'?'дядя':'дядя / тётя');
   else if(b===a+1)text=(a>1?cousinPrefix(a,p.sex)+' ':'')+(p.sex==='F'?'племянница':p.sex==='M'?'племянник':'племянник / племянница');
   else if(a>b){const anchor=data.people.get(ancestorPath(data,focus,id)[a-b]);text=siblingName(b,p.sex)+' '+genitive(directName(a-b,anchor?.sex,true));}
   else {const anchor=data.people.get(ancestorPath(data,p.id,id)[b-a]);text=directName(b-a,p.sex,false)+' '+genitive(siblingName(a,anchor?.sex));}
  }
  if(text)result.set(p.id,text);
 }
 for(const id of f.spouses){const blood=result.get(id);result.set(id,spouseLabel(data,focus,id)+(blood?' · также '+blood:''));}
 const paths=new Map([[focus,[]]]),q=[focus];
 for(let i=0;i<q.length;i++){
  const p=data.people.get(q[i]),path=paths.get(p.id);
  const parentEdge=(l,up)=>{const id=up?l.parent:l.child;let label=directName(1,data.people.get(id).sex,up);if(!l.biological)label=(data.people.get(id).sex==='F'?'приёмная ':'приёмный ')+label;if(l.uncertain)label+=' (спорная связь)';return {id,label};};
  const edges=[...p.parents.map(l=>parentEdge(l,true)),...p.children.map(l=>parentEdge(l,false)),...p.spouses.map(id=>({id,label:spouseLabel(data,p.id,id)})),...p.associations.map(l=>({id:l.id,label:/godfather|godmother|godparent|восприем/i.test(l.relation)?(data.people.get(l.id).sex==='F'?'восприемница':'восприемник'):l.relation,association:true}))];
  for(const e of edges)if(!paths.has(e.id)){paths.set(e.id,[...path,{...e,name:data.people.get(e.id).name}]);q.push(e.id);}
 }
 // Affinity descriptions follow the actual recorded path; a marriage never creates blood kinship.
 const known=new Map(result);
 for(const p of data.people.values())if(!result.has(p.id)){
  const path=paths.get(p.id);if(!path){result.set(p.id,'Связь не установлена');continue;}
  let label='выбранный человек';for(const step of path){if(known.has(step.id)&&!known.get(step.id).includes(' · также '))label=known.get(step.id);else label=step.label+' '+genitive(label);}
  result.set(p.id,label);
 }
 return {labels:new Map([...result].map(([id,label])=>[id,compactKinship(label)])),paths};
}
// Each identity is laid out once; spouse groups and all disconnected components survive.
export function layout(data,visible,sets,options={}){
 const verticalBranches=typeof options==='boolean'?options:!!options.verticalBranches;
 const ids=[...visible],generation=new Map();
 // Anchor every known direct relative to the chosen person, not to each branch's oldest record.
 for(const [id,d] of sets.ancestors)generation.set(id,-d);
 for(const [id,d] of sets.descendants)if(!generation.has(id))generation.set(id,d);
 const propagate=seeds=>{const queue=[...seeds];for(let i=0;i<queue.length;i++){
  const id=queue[i],p=data.people.get(id),g=generation.get(id);
  const neighbors=[...p.parents.map(l=>[l.parent,g-1]),...p.children.map(l=>[l.child,g+1]),...p.spouses.map(id=>[id,g])];
  for(const [next,rank] of neighbors)if(!generation.has(next)){generation.set(next,rank);queue.push(next);}
 }};
 propagate([...generation.keys()].sort((a,b)=>Math.abs(generation.get(a))-Math.abs(generation.get(b))));
 for(const p of data.people.values())if(generation.has(p.id))for(const a of p.associations)if(!generation.has(a.id)){generation.set(a.id,generation.get(p.id)-1);propagate([a.id]);}
 for(const id of data.people.keys())if(!generation.has(id)){generation.set(id,0);propagate([id]);}
 const minGeneration=Math.min(...ids.map(id=>generation.get(id))),parent=new Map(ids.map(id=>[id,id]));
 const find=id=>{let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next;}return root;};
 // Keep the couple carrying the selected person's direct line as one visual
 // family. Other partners of either parent stay outside that block, so they
 // cannot move its midpoint or stand between the child's own parents.
 const primaryCoupled=new Set(),joinFamily=f=>{const ps=f.parents.filter(id=>visible.has(id));for(let i=1;i<ps.length;i++)if(generation.get(ps[i])===generation.get(ps[0]))parent.set(find(ps[i]),find(ps[0]));};
 for(const f of data.families)if(f.children.some(id=>visible.has(id)&&sets.direct.has(id))){joinFamily(f);for(const id of f.parents)if(visible.has(id))primaryCoupled.add(id);}
 for(const f of data.families)if(!f.parents.some(id=>primaryCoupled.has(id)))joinFamily(f);
 const groups=new Map();for(const id of ids){const root=find(id);if(!groups.has(root))groups.set(root,{id:root,people:[],out:new Set(),incoming:new Set(),rank:generation.get(id)-minGeneration});groups.get(root).people.push(id);}
 let exceptions=0;
 for(const l of data.links)if(visible.has(l.parent)&&visible.has(l.child)){const a=find(l.parent),b=find(l.child);if(generation.get(l.child)!==generation.get(l.parent)+1)exceptions++;if(a!==b){groups.get(a).out.add(b);groups.get(b).incoming.add(a);}}
 const auxiliary=new Map();
 for(const p of data.people.values())if(visible.has(p.id))for(const link of p.associations)if(visible.has(link.id)){
  const a=find(p.id),b=find(link.id);if(a===b)continue;
  if(!auxiliary.has(a))auxiliary.set(a,new Set());if(!auxiliary.has(b))auxiliary.set(b,new Set());auxiliary.get(a).add(b);auxiliary.get(b).add(a);
 }
 const setOffsets=g=>{g.width=g.people.reduce((sum,id)=>sum+(sets.direct.has(id)?250:184)+28,0)-28;g.offsets=new Map();let cursor=0;for(const id of g.people){const w=sets.direct.has(id)?250:184;g.offsets.set(id,cursor+w/2-g.width/2);cursor+=w+28;}};
 const rows=new Map();for(const g of groups.values()){
  setOffsets(g);
  if(!rows.has(g.rank))rows.set(g.rank,[]);rows.get(g.rank).push(g);
 }
 const positions=new Map(),keys=[...rows.keys()].sort((a,b)=>a-b),groupOf=new Map(ids.map(id=>[id,find(id)]));
 const relationEdges=data.links.filter(l=>visible.has(l.parent)&&visible.has(l.child)&&groupOf.get(l.parent)!==groupOf.get(l.child));
 const focusId=sets.ancestors.keys().next().value;
 const fatherLeftMotherRight=order=>{const arranged=[...order],member=new Set(arranged);for(let pass=0;pass<data.families.length;pass++){let changed=false;for(const family of data.families){const fathers=family.parents.filter(id=>member.has(id)&&data.people.get(id)?.sex==='M'),mothers=family.parents.filter(id=>member.has(id)&&data.people.get(id)?.sex==='F');for(const father of fathers)for(const mother of mothers){const fi=arranged.indexOf(father),mi=arranged.indexOf(mother);if(fi>mi){[arranged[fi],arranged[mi]]=[arranged[mi],arranged[fi]];changed=true;}}}if(!changed)break;}return arranged;};
 // First determine a stable left-to-right family order. Association links are
 // useful as a weak ordering hint, but do not pull blood branches sideways.
 for(let sweep=0;sweep<10;sweep++){
  for(const rank of (sweep%2?[...keys].reverse():keys)){
   const row=rows.get(rank);row.forEach((g,i)=>{const neighbors=new Set([...(sweep%2?g.out:g.incoming),...(auxiliary.get(g.id)||[])]);const xs=[...neighbors].map(id=>positions.get(id)).filter(x=>x!==undefined);g.score=xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:(positions.get(g.id)??i*300);});row.sort((a,b)=>a.score-b.score);
   let x=0;for(const g of row){g.x=x;positions.set(g.id,x+g.width/2);x+=g.width+85;}
   const width=x-85;for(const g of row){g.x-=width/2;positions.set(g.id,g.x+g.width/2);}
  }
 }
 // A spouse group must face the same way as the branches above it. GEDCOM
 // record order is not visual order: keeping it here can put the child of
 // the left family on the right and force two otherwise independent parent
 // lines to cross. Use each person's own parent branch as the primary hint.
 for(const g of groups.values())if(g.people.length>1){
  const scored=g.people.map((id,index)=>{const incoming=relationEdges.filter(l=>l.child===id).map(l=>positions.get(groupOf.get(l.parent))).filter(Number.isFinite),outgoing=relationEdges.filter(l=>l.parent===id).map(l=>positions.get(groupOf.get(l.child))).filter(Number.isFinite),xs=incoming.length?incoming:outgoing;return {id,index,score:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:(positions.get(g.id)||0)+(g.offsets.get(id)||0)};});
  scored.sort((a,b)=>a.score-b.score||a.index-b.index);let ordered=scored.map(x=>x.id);const baseIndex=new Map(ordered.map((id,i)=>[id,i])),member=new Set(ordered),childPairs=data.families.filter(f=>f.children.some(id=>visible.has(id))).flatMap(f=>{const ps=f.parents.filter(id=>member.has(id)),priority=f.children.includes(focusId)?1000000:f.children.some(id=>sets.direct.has(id))?100000:10000;return ps.length>1?ps.slice(1).map(id=>({a:ps[0],b:id,priority})):[];});
  if(childPairs.length){const cost=order=>{const at=new Map(order.map((id,i)=>[id,i]));return childPairs.reduce((sum,p)=>sum+Math.max(0,Math.abs(at.get(p.a)-at.get(p.b))-1)*p.priority,0)+order.reduce((sum,id,i)=>sum+Math.abs(i-baseIndex.get(id)),0);};let best=cost(ordered);for(let pass=0;pass<40;pass++){let next,bestNext=best;for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){const candidate=[...ordered];[candidate[i],candidate[j]]=[candidate[j],candidate[i]];const value=cost(candidate);if(value<bestNext){bestNext=value;next=candidate;}}if(!next)break;ordered=next;best=bestNext;}}
  ordered=fatherLeftMotherRight(ordered);
  if(ordered.some((id,i)=>id!==g.people[i])){g.people=ordered;setOffsets(g);}
 }
 // Project desired group centres onto a non-overlapping row. Unlike centring
 // every generation independently, this keeps each family in its own column.
 const packRow=(row,desired,weights,gap=85)=>{
  const gapAt=(a,b)=>typeof gap==='function'?gap(a,b):gap,base=[0];for(let i=1;i<row.length;i++)base[i]=base[i-1]+row[i-1].width/2+gapAt(row[i-1],row[i])+row[i].width/2;
  const blocks=[];for(let i=0;i<row.length;i++){
   const weight=Math.max(.05,weights[i]||1),block={from:i,to:i,sum:(desired[i]-base[i])*weight,weight};blocks.push(block);
   while(blocks.length>1){const b=blocks.at(-1),a=blocks.at(-2);if(a.sum/a.weight<=b.sum/b.weight)break;blocks.splice(-2,2,{from:a.from,to:b.to,sum:a.sum+b.sum,weight:a.weight+b.weight});}
  }
  const projected=[];for(const b of blocks)for(let i=b.from;i<=b.to;i++)projected[i]=b.sum/b.weight;
  row.forEach((g,i)=>{const center=projected[i]+base[i];g.x=center-g.width/2;positions.set(g.id,center);});
 };
 const focusGroup=groupOf.get(focusId),focusRank=groups.get(focusGroup)?.rank??0;
 const towardFocusGroups=new Map(),towardFocusPeople=new Map();for(const group of groups.values()){const foundGroups=new Set(),foundPeople=new Set();for(const link of relationEdges){const pg=groupOf.get(link.parent),cg=groupOf.get(link.child);if(group.rank<focusRank&&pg===group.id&&groups.get(cg)?.rank>group.rank){foundGroups.add(cg);foundPeople.add(link.child);}if(group.rank>focusRank&&cg===group.id&&groups.get(pg)?.rank<group.rank){foundGroups.add(pg);foundPeople.add(link.parent);}}towardFocusGroups.set(group.id,foundGroups);towardFocusPeople.set(group.id,foundPeople);}
 const share=(a,b)=>a?.size&&b?.size&&[...a].some(id=>b.has(id));
 const branchSpacing=(sameBranch,differentBranch,relatedBranch=(sameBranch+differentBranch)/2)=>(left,right)=>share(towardFocusPeople.get(left.id),towardFocusPeople.get(right.id))?sameBranch:share(towardFocusGroups.get(left.id),towardFocusGroups.get(right.id))?relatedBranch:differentBranch;
 if(verticalBranches){
  // Lay the tree out from the selected person's generation towards the outer
  // generations. A branch is positioned from the already placed relative one
  // step nearer to the focus. This makes ancestors continue upward above their
  // own child instead of every row being pulled sideways towards a global centre.
 const outward=[...keys].sort((a,b)=>Math.abs(a-focusRank)-Math.abs(b-focusRank)||a-b);
  for(const rank of outward){const row=rows.get(rank),targets=row.map((g,index)=>{
    let sum=(positions.get(g.id)||0)*.04,weight=.04;
    for(const l of relationEdges){const parentGroup=groupOf.get(l.parent),childGroup=groupOf.get(l.child),ownParent=parentGroup===g.id,ownChild=childGroup===g.id;if(!ownParent&&!ownChild)continue;
     const otherId=ownParent?childGroup:parentGroup,other=groups.get(otherId);if(!other||Math.abs(other.rank-focusRank)>=Math.abs(rank-focusRank))continue;
     const otherPerson=ownParent?l.child:l.parent,ownPerson=ownParent?l.parent:l.child,target=positions.get(otherId)+(other.offsets.get(otherPerson)||0)-(g.offsets.get(ownPerson)||0),edgeWeight=sets.direct.has(l.parent)&&sets.direct.has(l.child)?12:3;
     sum+=target*edgeWeight;weight+=edgeWeight;
    }
    if(g.id===focusGroup){sum+=-(g.offsets.get(focusId)||0)*100;weight+=100;}
    return {g,index,x:sum/weight,weight};
   });
   targets.sort((a,b)=>a.x-b.x||a.index-b.index);row.splice(0,row.length,...targets.map(t=>t.g));packRow(row,targets.map(t=>t.x),targets.map(t=>t.weight),branchSpacing(80,110,95));
  }
  // Once the ancestor rows have opened out, carry their columns back down
  // towards the focus. In a wide family the direct child should sit below the
  // midpoint of their parents, rather than remain beside the whole sibling
  // row. Moving the nearer generation is what makes each pedigree branch read
  // as a vertical column even when that family has several other children.
  // Relax both ends of the direct lines together. Repeating the pass lets a
  // crowded child row push the corresponding parent branches apart instead of
  // forcing the child off to one side. Non-direct siblings are only a weak hint.
  for(let sweep=0;sweep<28;sweep++)for(const rank of (sweep%2?keys:[...keys].reverse())){
   const row=rows.get(rank),targets=row.map((g,index)=>{let sum=(positions.get(g.id)||0)*.15,weight=.15;
    for(const l of relationEdges){const ownParent=groupOf.get(l.parent)===g.id,ownChild=groupOf.get(l.child)===g.id;if(!ownParent&&!ownChild)continue;
     const otherId=ownParent?groupOf.get(l.child):groupOf.get(l.parent),other=groups.get(otherId),otherPerson=ownParent?l.child:l.parent,ownPerson=ownParent?l.parent:l.child;
     const target=positions.get(otherId)+(other.offsets.get(otherPerson)||0)-(g.offsets.get(ownPerson)||0),directEdge=sets.direct.has(l.parent)&&sets.direct.has(l.child),edgeWeight=directEdge?20000:.25;
     sum+=target*edgeWeight;weight+=edgeWeight;
    }
    if(g.id===focusGroup){sum+=-(g.offsets.get(focusId)||0)*160;weight+=160;}
    return {g,index,x:sum/weight,weight};
   });
   targets.sort((a,b)=>a.x-b.x||a.index-b.index);row.splice(0,row.length,...targets.map(t=>t.g));packRow(row,targets.map(t=>t.x),targets.map(t=>t.weight),branchSpacing(80,110,95));
  }
  // The branch relaxation can change the final order of two parent families.
  // Face every couple towards those final columns once more, otherwise the
  // spouses can be reversed and their two descent lines must cross.
  for(const g of groups.values())if(g.people.length>1){const centre=positions.get(g.id),parentCentre=id=>{const parents=[...new Set(relationEdges.filter(l=>l.child===id&&sets.direct.has(l.parent)).map(l=>groupOf.get(l.parent)))];return parents.length?parents.reduce((sum,p)=>sum+positions.get(p),0)/parents.length:centre+(g.offsets.get(id)||0);};let ordered=[...g.people].sort((a,b)=>parentCentre(a)-parentCentre(b)),baseIndex=new Map(ordered.map((id,i)=>[id,i])),member=new Set(ordered),childPairs=data.families.filter(f=>f.children.some(id=>visible.has(id))).flatMap(f=>{const ps=f.parents.filter(id=>member.has(id)),priority=f.children.includes(focusId)?1000000:f.children.some(id=>sets.direct.has(id))?100000:10000;return ps.length>1?ps.slice(1).map(id=>({a:ps[0],b:id,priority})):[];});if(childPairs.length){const cost=order=>{const at=new Map(order.map((id,i)=>[id,i]));return childPairs.reduce((sum,p)=>sum+Math.max(0,Math.abs(at.get(p.a)-at.get(p.b))-1)*p.priority,0)+order.reduce((sum,id,i)=>sum+Math.abs(i-baseIndex.get(id)),0);};let best=cost(ordered);for(let pass=0;pass<40;pass++){let next,bestNext=best;for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){const candidate=[...ordered];[candidate[i],candidate[j]]=[candidate[j],candidate[i]];const value=cost(candidate);if(value<bestNext){bestNext=value;next=candidate;}}if(!next)break;ordered=next;best=bestNext;}}ordered=fatherLeftMotherRight(ordered);if(ordered.some((id,i)=>id!==g.people[i])){g.people=ordered;setOffsets(g);g.x=centre-g.width/2;positions.set(g.id,centre);}}
  // In direct-only mode, finish from the oldest displayed generation down.
  // Every group is placed from the centres of the actual parent cards above
  // it. One-parent links receive the strongest priority, so they remain truly
  // vertical whenever geometry permits; neighbouring free branches move aside.
  // Edges belonging only to a longer pedigree-collapse path are still drawn,
  // but do not pull a card out of its shortest-path generation.
  if(options.directMode??ids.every(id=>sets.direct.has(id))){
   const firstRank=Math.min(...keys);
   for(const rank of keys.filter(rank=>rank>firstRank).sort((a,b)=>a-b)){
    const row=rows.get(rank),targets=row.map((g,index)=>{
     let weighted=0,weight=0;
     for(const child of g.people){
      const links=relationEdges.filter(l=>l.child===child&&sets.direct.has(l.parent)&&generation.get(l.child)===generation.get(l.parent)+1);
      for(const familyId of new Set(links.map(l=>l.family))){
       const familyLinks=links.filter(l=>l.family===familyId);if(!familyLinks.length)continue;
       const parentCentre=familyLinks.reduce((sum,l)=>{const pg=groups.get(groupOf.get(l.parent));return sum+positions.get(pg.id)+(pg.offsets.get(l.parent)||0);},0)/familyLinks.length;
       const priority=familyLinks.length===1?1e9:1e6,desired=parentCentre-(g.offsets.get(child)||0);
       weighted+=desired*priority;weight+=priority;
      }
     }
     return {g,index,x:weight?weighted/weight:(positions.get(g.id)||0),weight:weight||.02};
    });
   targets.sort((a,b)=>a.x-b.x||a.index-b.index);row.splice(0,row.length,...targets.map(t=>t.g));
    packRow(row,targets.map(t=>t.x),targets.map(t=>t.weight),branchSpacing(28,64,46));
   }
   // Straighten a one-parent segment by moving that parent's whole ancestor
   // branch as one unit. Apply it only when every affected generation keeps
   // the required card gap; otherwise the small elbow is genuinely necessary.
   const adjacentEdges=relationEdges.filter(l=>generation.get(l.child)===generation.get(l.parent)+1);
   const ancestryFrom=root=>{const found=new Set([root]),queue=[root];for(let i=0;i<queue.length;i++){const id=queue[i];for(const l of adjacentEdges)if(groupOf.get(l.child)===id){const parentId=groupOf.get(l.parent);if(!found.has(parentId)){found.add(parentId);queue.push(parentId);}}}return found;};
   const canShift=(moving,delta)=>{for(const row of rows.values()){const placed=row.map(g=>({g,x:g.x+(moving.has(g.id)?delta:0)})).sort((a,b)=>a.x-b.x);for(let i=1;i<placed.length;i++)if(placed[i].x<placed[i-1].x+placed[i-1].g.width+28-.01)return false;}return true;};
   const shiftGroups=(moving,delta)=>{for(const id of moving){const group=groups.get(id);group.x+=delta;positions.set(id,positions.get(id)+delta);}};
   const childRanks=[...keys].sort((a,b)=>b-a);for(let pass=0;pass<2;pass++)for(const rank of childRanks)for(const childGroup of rows.get(rank))for(const child of childGroup.people){
    const links=adjacentEdges.filter(l=>l.child===child&&sets.direct.has(l.parent));if(links.length!==1)continue;
    const parentGroup=groups.get(groupOf.get(links[0].parent));if(!parentGroup||parentGroup.people.length!==1)continue;
    const childCentre=positions.get(childGroup.id)+(childGroup.offsets.get(child)||0),parentCentre=positions.get(parentGroup.id)+(parentGroup.offsets.get(links[0].parent)||0),delta=childCentre-parentCentre;if(Math.abs(delta)<.01)continue;
    const moving=ancestryFrom(parentGroup.id);if(!canShift(moving,delta))continue;
    for(const id of moving){const group=groups.get(id);group.x+=delta;positions.set(id,positions.get(id)+delta);}
   }
   // Treat every direct parent family as the root of one ancestor subtree.
   // Starting near the selected person and moving upwards keeps that subtree
   // above its child instead of accumulating a sideways step at every couple.
   const directFamilies=data.families.map(f=>{const children=f.children.filter(id=>visible.has(id)&&sets.direct.has(id)),parents=f.parents.filter(id=>visible.has(id)&&sets.direct.has(id));return {children,parents,depth:Math.max(-Infinity,...children.map(id=>groups.get(groupOf.get(id)).rank))};}).filter(f=>f.parents.length&&f.children.length&&Number.isFinite(f.depth)).sort((a,b)=>b.depth-a.depth);
   for(const family of directFamilies){const children=family.children.filter(child=>family.parents.some(parent=>generation.get(child)===generation.get(parent)+1)),parents=family.parents.filter(parent=>children.some(child=>generation.get(child)===generation.get(parent)+1));if(!children.length||!parents.length)continue;const moving=new Set();for(const parent of parents)for(const id of ancestryFrom(groupOf.get(parent)))moving.add(id);if(children.some(id=>moving.has(groupOf.get(id))))continue;const centre=id=>positions.get(groupOf.get(id))+(groups.get(groupOf.get(id)).offsets.get(id)||0),parentMidpoint=parents.reduce((sum,id)=>sum+centre(id),0)/parents.length,childMidpoint=children.reduce((sum,id)=>sum+centre(id),0)/children.length,delta=childMidpoint-parentMidpoint;if(Math.abs(delta)<.01||!canShift(moving,delta))continue;shiftGroups(moving,delta);}
  }
 }else for(let sweep=0;sweep<36;sweep++){
  const order=sweep%2?[...keys].reverse():keys;
  for(const rank of order){const row=rows.get(rank),desired=[],weights=[];
   for(const g of row){let sum=(positions.get(g.id)||0)*.18,weight=.18;
    for(const l of relationEdges){const ownParent=groupOf.get(l.parent)===g.id,ownChild=groupOf.get(l.child)===g.id;if(!ownParent&&!ownChild)continue;
     const otherId=ownParent?groupOf.get(l.child):groupOf.get(l.parent),other=groups.get(otherId),otherPerson=ownParent?l.child:l.parent,ownPerson=ownParent?l.parent:l.child;
     const target=positions.get(otherId)+(other.offsets.get(otherPerson)||0)-(g.offsets.get(ownPerson)||0),edgeWeight=sets.direct.has(l.parent)&&sets.direct.has(l.child)?6:1.5;
     sum+=target*edgeWeight;weight+=edgeWeight;
    }
    if(g.id===focusGroup){sum+=-(g.offsets.get(focusId)||0)*80;weight+=80;}
    desired.push(sum/weight);weights.push(weight);
   }
   packRow(row,desired,weights,branchSpacing(60,90,75));
  }
 }
 // A one-parent/one-child chain is a rigid vertical component. Moving the
 // whole component during collision removal preserves every exact axis in all
 // views, including full-tree mode and branches with repeated marriages.
 const shownFamilies=data.families.map(f=>({...f,shownParents:f.parents.filter(id=>visible.has(id)),shownChildren:f.children.filter(id=>visible.has(id))})),alignment=new Map();
 const addAlignment=(a,b,delta)=>{if(a===b)return;if(!alignment.has(a))alignment.set(a,[]);alignment.get(a).push([b,delta]);};
 for(const family of shownFamilies)if(family.shownParents.length===1&&family.shownChildren.length===1){const parent=family.shownParents[0],child=family.shownChildren[0],pg=groupOf.get(parent),cg=groupOf.get(child),po=groups.get(pg).offsets.get(parent)||0,co=groups.get(cg).offsets.get(child)||0;addAlignment(pg,cg,po-co);addAlignment(cg,pg,co-po);}
 const componentOf=new Map(),componentMembers=new Map();
 for(const group of groups.values())if(!componentOf.has(group.id)){const root=group.id,queue=[root],relative=new Map([[root,0]]),members=[];componentOf.set(root,root);for(let i=0;i<queue.length;i++){const id=queue[i];members.push(id);for(const [next,delta] of alignment.get(id)||[])if(!componentOf.has(next)){componentOf.set(next,root);relative.set(next,relative.get(id)+delta);queue.push(next);}}const base=members.reduce((sum,id)=>sum+positions.get(id)-relative.get(id),0)/members.length;for(const id of members){const centre=base+relative.get(id),item=groups.get(id);positions.set(id,centre);item.x=centre-item.width/2;}componentMembers.set(root,new Set(members));}
 const shiftComponent=(root,delta)=>{if(Math.abs(delta)<.001)return;for(const id of componentMembers.get(root)||[]){const group=groups.get(id);group.x+=delta;positions.set(id,positions.get(id)+delta);}};
 const cardCentre=id=>{const group=groups.get(groupOf.get(id));return positions.get(group.id)+(group.offsets.get(id)||0);};
 // With several visible children one card cannot be above every child, so the
 // sole parent is centred over the children's midpoint.
 for(const family of shownFamilies)if(family.shownParents.length===1&&family.shownChildren.length>1){const parent=family.shownParents[0],target=family.shownChildren.reduce((sum,id)=>sum+cardCentre(id),0)/family.shownChildren.length;shiftComponent(componentOf.get(groupOf.get(parent)),target-cardCentre(parent));}
 const finalSpacing=branchSpacing(options.directMode?28:verticalBranches?80:60,options.directMode?64:verticalBranches?110:90,options.directMode?46:verticalBranches?95:75),separateComponents=()=>{let changed=false;for(const row of rows.values())for(let pass=0;pass<row.length*3;pass++){const placed=[...row].sort((a,b)=>a.x-b.x);let fixed=true;for(let i=1;i<placed.length;i++){const left=placed[i-1],right=placed[i],overlap=left.x+left.width+finalSpacing(left,right)-right.x;if(overlap<=.01)continue;const leftRoot=componentOf.get(left.id),rightRoot=componentOf.get(right.id);if(leftRoot===rightRoot)continue;shiftComponent(rightRoot,overlap);fixed=false;changed=true;break;}if(fixed)break;}return changed;};
 // Parent sex order is global: it also applies when another partnership keeps
 // the two parent cards in separate layout groups.
 for(let pass=0;pass<24;pass++){let changed=false;for(const family of shownFamilies){const father=family.shownParents.find(id=>data.people.get(id)?.sex==='M'),mother=family.shownParents.find(id=>data.people.get(id)?.sex==='F');if(!father||!mother||cardCentre(father)<cardCentre(mother))continue;const fatherRoot=componentOf.get(groupOf.get(father)),motherRoot=componentOf.get(groupOf.get(mother));if(fatherRoot===motherRoot)continue;shiftComponent(motherRoot,cardCentre(father)-cardCentre(mother)+1);changed=true;}if(separateComponents())changed=true;if(!changed)break;}
 // A godparent without a separate blood path is an auxiliary card, not an
 // independent branch. Put it into the nearest clear slot to the associated
 // direct person after the family layout has settled.
 for(const [godparent,sources] of options.associationAnchors||[]){if(!visible.has(godparent))continue;const group=groups.get(groupOf.get(godparent)),root=componentOf.get(group.id);if((componentMembers.get(root)?.size||0)>1)continue;const sourceIds=[...sources].filter(id=>visible.has(id));if(!sourceIds.length)continue;const target=sourceIds.reduce((sum,id)=>sum+cardCentre(id),0)/sourceIds.length,offset=group.offsets.get(godparent)||0,row=rows.get(group.rank),other=row.filter(item=>item.id!==group.id),candidates=new Set([target-offset]);for(const item of other){candidates.add(item.x-28-group.width/2);candidates.add(item.x+item.width+28+group.width/2);}const clear=centre=>{const left=centre-group.width/2,right=centre+group.width/2;return other.every(item=>right<=item.x-28+.01||left>=item.x+item.width+28-.01);},best=[...candidates].filter(clear).sort((a,b)=>Math.abs(a+offset-target)-Math.abs(b+offset-target))[0];if(Number.isFinite(best))shiftComponent(root,best-positions.get(group.id));}
 // Put the selected person at x=0 without changing any relative positions.
 const origin=(positions.get(focusGroup)||0)+(groups.get(focusGroup)?.offsets.get(focusId)||0);for(const g of groups.values()){g.x-=origin;positions.set(g.id,positions.get(g.id)-origin);}
 const nodes=new Map();for(const g of groups.values()){let x=g.x;for(const id of g.people){const direct=sets.direct.has(id),w=direct?250:184,h=direct?128:100;nodes.set(id,{id,x,y:g.rank*250,w,h,rank:g.rank,generation:generation.get(id),direct});x+=w+28;}}
 // Resolve the exceptional case where a pedigree-collapse component fixes two
 // co-parents in the wrong horizontal order. Swap their occupied card slots;
 // this preserves spacing and keeps every ordinary branch calculation intact.
 for(const family of shownFamilies){const fatherId=family.shownParents.find(id=>data.people.get(id)?.sex==='M'),motherId=family.shownParents.find(id=>data.people.get(id)?.sex==='F'),father=nodes.get(fatherId),mother=nodes.get(motherId);if(!father||!mother||father.x+father.w/2<mother.x+mother.w/2)continue;const left=mother.x,right=father.x+father.w;father.x=left;mother.x=right-mother.w;}
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const n of nodes.values()){minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x+n.w);minY=Math.min(minY,n.y);maxY=Math.max(maxY,n.y+n.h);}
 return {nodes,bounds:{x:minX-100,y:minY-100,w:maxX-minX+200,h:maxY-minY+240},generationCount:rows.size,exceptions};
}
export const EVENT_LABELS={BIRT:'Рождение',DEAT:'Смерть',CHR:'Крещение',BAPM:'Крещение',BURI:'Погребение',RESI:'Проживание',OCCU:'Занятие',TITL:'Звание',CAST:'Сословие',EDUC:'Образование',RELI:'Вероисповедание',NATI:'Национальность',NATU:'Натурализация',EMIG:'Эмиграция',IMMI:'Иммиграция',EVEN:'Событие',FACT:'Сведения',ADOP:'Усыновление',_MILT:'Служба',_MILI:'Служба',MARR:'Брак',_PRS:'Гражданский брак',DIV:'Развод'};
