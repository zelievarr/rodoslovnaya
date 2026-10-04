const DB='rodoslovnaya-local',STORE='files';
export async function savedGedcom(action='read',record){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,action==='read'?'readonly':'readwrite'),store=tx.objectStore(STORE);
  const request=action==='read'?store.get('current'):store.put(record,'current');
  tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Сохранение отменено'));
 });}finally{db.close();}
}
export function readView(){try{return JSON.parse(localStorage.getItem('rodoslovnaya-view')||'null');}catch{return null;}}
export function saveView(view){try{localStorage.setItem('rodoslovnaya-view',JSON.stringify(view));}catch{/* File persistence does not depend on preferences storage. */}}
