// Routes between empty generation gutters, choosing the nearest clear vertical channel.
// Unlike a shared outer rail, each connection chooses a channel from its own endpoints.
export function routingPlan(data,nodes,rowH){
 const lanes=new Map(),ports=new Map();
 const reserve=(rank,owner)=>{if(!lanes.has(rank))lanes.set(rank,new Map());const row=lanes.get(rank);if(!row.has(owner))row.set(owner,row.size);};
 const port=(node,side,owner)=>{const key=node.id+'|'+side;if(!ports.has(key))ports.set(key,new Set());ports.get(key).add(owner);reserve(node.rank-(side==='top'?1:0),owner);};
 for(const f of data.families){const owner='family:'+f.id,ps=f.parents.map(id=>nodes.get(id)).filter(Boolean),cs=f.children.map(id=>nodes.get(id)).filter(Boolean);for(const n of ps)port(n,cs.length?'bottom':'top',owner);for(const n of cs)port(n,'top',owner);}
 for(const p of data.people.values())for(const a of p.associations){const n=nodes.get(p.id),other=nodes.get(a.id);if(!n||!other)continue;const owner='association:'+associationKey(p.id,a,data);for(const side of ['top','bottom','left','right']){port(n,side,owner);port(other,side,owner);}}
 const rowY=new Map();let height=0;
 for(const [rank,h] of [...rowH].sort((a,b)=>a[0]-b[0])){rowY.set(rank,height);height+=h+Math.max(120,(lanes.get(rank)?.size||0)*16+64);}
 for(const n of nodes.values())n.y=rowY.get(n.rank)+(rowH.get(n.rank)-n.h)/2;
 return {rowY,height,laneRows:[...lanes].map(([rank,row])=>[...row].map(([owner,slot])=>({owner,y:rank<0?-28-slot*16:rowY.get(rank)+rowH.get(rank)+28+slot*16}))),
  laneY(rank,owner){const slot=lanes.get(rank)?.get(owner)??0;return rank<0?-28-slot*16:rowY.get(rank)+rowH.get(rank)+28+slot*16;},
  portX(n,side,owner){const allOwners=[...(ports.get(n.id+'|'+side)||[])],family=owner.startsWith('family:'),owners=allOwners.filter(item=>item.startsWith('family:')===family),i=owners.indexOf(owner);if(family&&owners.length===1)return n.x+n.w/2;return n.x+n.w*(.2+.6*(Math.max(0,i)+1)/(owners.length+1));},
  portY(n,side,owner){const owners=[...(ports.get(n.id+'|'+side)||[])],i=owners.indexOf(owner);return n.y+n.h*(.25+.5*(i+1)/(owners.length+1));}
 };
}
// Large trees share one clear gutter per generation instead of reserving a
// separate lane for every family, which would make the SVG enormous.
export function compactRoutingPlan(nodes,rowH){
 const rowY=new Map(),ranks=[...rowH.keys()].sort((a,b)=>a-b);let height=0;
 for(const rank of ranks){rowY.set(rank,height);height+=rowH.get(rank)+150;}
 for(const n of nodes.values())n.y=rowY.get(n.rank)+(rowH.get(n.rank)-n.h)/2;
 return {rowY,height,laneRows:[],
  laneY(rank){return rowY.has(rank)?rowY.get(rank)+rowH.get(rank)+68:rank<ranks[0]?-48:height+48;},
  portX(n){return n.x+n.w/2;},
  portY(n){return n.y+n.h/2;}
 };
}
// Reorder independent family channels by their actual endpoints, before adding bridges.
export function optimizeFamilyLanes(edges,laneRows){
 const changes=new Map();
 for(const row of laneRows){
  const items=row.filter(r=>r.owner.startsWith('family:')).sort((a,b)=>a.y-b.y).map(r=>{
   const spans=[],top=new Set(),bottom=new Set();
   for(const edge of edges)if(edge.owner===r.owner)for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1],b=edge.points[i];
    if(a[1]===r.y&&b[1]===r.y&&a[0]!==b[0])spans.push([Math.min(a[0],b[0]),Math.max(a[0],b[0])]);
    if(a[0]===b[0]&&a[1]!==b[1]&&(a[1]===r.y||b[1]===r.y)){
     const other=a[1]===r.y?b[1]:a[1];(other<r.y?top:bottom).add(a[0]);
    }
   }
   return {...r,spans,top,bottom};
  }).filter(r=>r.spans.length);
  const hits=(spans,ports)=>[...ports].filter(x=>spans.some(([lo,hi])=>x>lo+.01&&x<hi-.01)).length;
  const cost=items.map(a=>items.map(b=>hits(a.spans,b.top)+hits(b.spans,a.bottom)));
  const order=items.map((_,i)=>i);
  for(let pass=0;pass<40;pass++){
   let bestDelta=0,move;
   for(let i=0;i<order.length;i++){
    let delta=0;for(let j=i+1;j<order.length;j++){delta+=cost[order[j]][order[i]]-cost[order[i]][order[j]];if(delta<bestDelta){bestDelta=delta;move=[i,j];}}
    delta=0;for(let j=i-1;j>=0;j--){delta+=cost[order[i]][order[j]]-cost[order[j]][order[i]];if(delta<bestDelta){bestDelta=delta;move=[i,j];}}
   }
   if(!move)break;const [i,j]=move,[item]=order.splice(i,1);order.splice(j,0,item);
  }
  order.forEach((item,slot)=>{if(items[item].y!==items[slot].y)changes.set(items[item].owner+'|'+items[item].y,items[slot].y);});
 }
 for(const edge of edges)edge.points=edge.points.map(([x,y])=>[x,changes.get(edge.owner+'|'+y)??y]);
 return changes;
}
export function associationKey(id,a,data){return [id,a.id].sort().join('|')+'|'+associationLabel(a.relation,data.people.get(a.id).sex);}
export function associationRoute(a,b,nodes,plan,occupied,owner,upward=false){
 const swap=p=>[p[1],p[0]];
 const rotated=new Map([...nodes].map(([id,n])=>[id,{...n,x:n.y,y:n.x,w:n.h,h:n.w}]));
 const taken=occupied.map(e=>({...e,points:e.points.map(swap)}));
 const endpoints=n=>['top','bottom','left','right'].map(side=>{
  const x=plan.portX(n,side,owner),y=plan.portY(n,side,owner),gap=20;
  return side==='top'?[[x,n.y],[x,n.y-gap]]:side==='bottom'?[[x,n.y+n.h],[x,n.y+n.h+gap]]:side==='left'?[[n.x,y],[n.x-gap,y]]:[[n.x+n.w,y],[n.x+n.w+gap,y]];
 });
 const clean=points=>{const out=[];for(const p of points){const last=out.at(-1);if(last&&last[0]===p[0]&&last[1]===p[1])continue;out.push(p);}return out;};
 const intersects=(u,v,n,pad=5)=>u[0]===v[0]?(u[0]>n.x-pad&&u[0]<n.x+n.w+pad&&Math.max(u[1],v[1])>n.y-pad&&Math.min(u[1],v[1])<n.y+n.h+pad):(u[1]>n.y-pad&&u[1]<n.y+n.h+pad&&Math.max(u[0],v[0])>n.x-pad&&Math.min(u[0],v[0])<n.x+n.w+pad);
 let best=null,bestCost=Infinity;
 const sourcePorts=upward?[.08,.82].map(base=>{const slot=(plan.portX(a,'top',owner)-a.x)/a.w,x=a.x+a.w*(base+.1*slot);return [[x,a.y],[x,a.y-20]];}):endpoints(a);
 const targetPorts=upward?endpoints(b).filter((p,i)=>i!==0):endpoints(b);
 for(const [start,s] of sourcePorts)for(const [end,t] of targetPorts){
  const candidates=[ [s,[s[0],t[1]],t], [s,[t[0],s[1]],t],routeLocal(s,t,nodes,0,occupied,owner),routeLocal(swap(s),swap(t),rotated,0,taken,owner).map(swap) ];
  for(const middle of candidates){const points=clean([start,...middle,end]);let cost=0,valid=true;
   for(let i=1;i<points.length&&valid;i++){
    const u=points[i-1],v=points[i];cost+=Math.abs(u[0]-v[0])+Math.abs(u[1]-v[1]);
    for(const n of nodes.values())if(intersects(u,v,n,(i===1&&n.id===a.id)||(i===points.length-1&&n.id===b.id)?0:5)){valid=false;break;}
    if(!valid)break;
    for(const edge of occupied){if(edge.owner===owner)continue;for(let j=1;j<edge.points.length;j++){
     const c=edge.points[j-1],d=edge.points[j],h=u[1]===v[1],eh=c[1]===d[1];
     if(h===eh){const axis=h?0:1,other=1-axis;if(Math.abs(u[other]-c[other])<4&&Math.min(Math.max(u[axis],v[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(u[axis],v[axis]),Math.min(c[axis],d[axis]))>1){valid=false;break;}}
     else{const hs=h?u:c,he=h?v:d,vs=h?c:u,ve=h?d:v;if(vs[0]>Math.min(hs[0],he[0])&&vs[0]<Math.max(hs[0],he[0])&&hs[1]>Math.min(vs[1],ve[1])&&hs[1]<Math.max(vs[1],ve[1]))cost+=45;}
    }}
   }
   cost+=Math.max(0,points.length-2)*12;
   if(valid&&cost<bestCost){best=points;bestCost=cost;}
  }
 }
 // Reserved generation gutters remain a safe fallback when local exits are obstructed.
 if(!best){const tx=plan.portX(b,'bottom',owner);
  if(upward){const [start]=sourcePorts[b.x<a.x?0:1];best=[start,...routeLocal([start[0],plan.laneY(a.rank-1,owner)],[tx,plan.laneY(b.rank,owner)],nodes,0,occupied,owner),[tx,b.y+b.h]];}
  else{const sx=plan.portX(a,'bottom',owner);best=[[sx,a.y+a.h],...routeLocal([sx,plan.laneY(a.rank,owner)],[tx,plan.laneY(b.rank,owner)],nodes,0,occupied,owner),[tx,b.y+b.h]];}
 }
 return best;
}
export function routeLocal(start,end,nodes,lane=0,occupied=[],owner=''){
 const [sx,sy]=start,[tx,ty]=end,pad=14;
 if(Math.abs(sy-ty)<1)return [[sx,sy],[tx,ty]];
 const lo=Math.min(sy,ty),hi=Math.max(sy,ty);
 const obstacles=[...nodes.values()].filter(n=>n.y-pad<hi&&n.y+n.h+pad>lo);
 const candidates=new Set([sx,tx,(sx+tx)/2]);
 for(const n of obstacles){candidates.add(n.x-pad-4-(lane%7)*3);candidates.add(n.x+n.w+pad+4+(lane%7)*3);}
 const taken=[];for(const edge of occupied){if(edge.owner===owner)continue;for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i];if(a[0]===b[0]&&Math.max(a[1],b[1])>lo&&Math.min(a[1],b[1])<hi){taken.push(a[0]);candidates.add(a[0]-10);candidates.add(a[0]+10);}}}
 const clear=x=>obstacles.every(n=>x<=n.x-pad||x>=n.x+n.w+pad)&&taken.every(t=>Math.abs(t-x)>=8);
 const cost=x=>Math.abs(sx-x)+Math.abs(tx-x)+.15*Math.abs(x-(sx+tx)/2);
 const xs=[...candidates].filter(clear).sort((a,b)=>cost(a)-cost(b));
 let x=xs[0];if(x===undefined){x=Math.min(sx,tx,...obstacles.map(n=>n.x))-pad-20;while(!clear(x))x-=12;}
 return [[sx,sy],[x,sy],[x,ty],[tx,ty]];
}
export function pathData(points){return points.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ');}
// Only non-junction crossings get a jump. Family-owned shared branches stay joined.
// No background/erase stroke: both lines remain continuous SVG paths.
export function bridgePaths(edges,radius=6){
 const vertical=[];
 for(const edge of edges)for(let i=1;i<edge.points.length;i++){
  const a=edge.points[i-1],b=edge.points[i];
  if(a[0]===b[0]&&a[1]!==b[1])vertical.push({edge,x:a[0],lo:Math.min(a[1],b[1]),hi:Math.max(a[1],b[1])});
 }
 return edges.map(edge=>{
  if(!edge.points.length)return '';
  let d=`M${edge.points[0].join(',')}`;
  for(let i=1;i<edge.points.length;i++){
   const a=edge.points[i-1],b=edge.points[i];
   if(a[1]!==b[1]||a[0]===b[0]){d+=` L${b.join(',')}`;continue;}
   const lo=Math.min(a[0],b[0]),hi=Math.max(a[0],b[0]),y=a[1],direction=Math.sign(b[0]-a[0]);
   const crossings=[...new Set(vertical.filter(v=>v.edge!==edge&&v.edge.owner!==edge.owner&&v.x>lo+.1&&v.x<hi-.1&&y>v.lo+.1&&y<v.hi-.1).map(v=>v.x))].sort((a,b)=>a-b);
   const clusters=[];for(const x of crossings){const last=clusters.at(-1);if(last&&x-last.at(-1)<radius*2+2)last.push(x);else clusters.push([x]);}
   const jumps=clusters.map(c=>{const center=(c[0]+c.at(-1))/2;return {center,r:Math.min((c.at(-1)-c[0])/2+radius,center-lo-.1,hi-center-.1)};});
   if(direction<0)jumps.reverse();
   for(const {center,r} of jumps){if(r<=0)continue;d+=` L${center-direction*r},${y} A${r},${r} 0 0 ${direction>0?1:0} ${center+direction*r},${y}`;}
   d+=` L${b.join(',')}`;
  }
  return d;
 });
}
export function labelSegment(points){
 let best,score=-1;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);const horizontal=a[1]===b[1],s=length*(horizontal?1.5:1);if(s>score){score=s;best=horizontal?(a[0]<b[0]?[a,b]:[b,a]):(a[1]>b[1]?[a,b]:[b,a]);}}
 return best||points;
}
export function associationLabel(relation,sex){
 if(/godfather|godmother|godparent|восприем|восприим|кр[её]стн/i.test(relation))return sex==='F'?'Восприемница':'Восприемник';
 if(/witness|свидетел/i.test(relation))return 'Свидетель';
 return relation==='Связь из GEDCOM'?'Другая связь':relation;
}
