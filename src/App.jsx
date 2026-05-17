import { useState, useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import './App.css'

const TOOLS = { PEN:'pen', ERASER:'eraser', SELECT:'select', MOVE:'move', LINE:'line', RULER:'ruler', HAND:'hand' }
const PRESET_COLORS = ['#000000','#00cc00','#ff6600','#0066ff','#ff00ee','#ff0000']
const CW = 1400, CH = 1050
const PAPER_ID = 0
const MAX_HIST = 30
let layerCounter = 2
const mkLayer = (id,name) => ({ id, name, opacity:100, visible:true })
const mkPaper = () => ({ id:PAPER_ID, name:'用紙', opacity:100, visible:true, isPaper:true })
const inRect = (pt,r) => r && pt.x>=r.x && pt.x<=r.x+r.w && pt.y>=r.y && pt.y<=r.y+r.h

function applySnap(pt,{angleSnap=false,gridSnap=false,gridSize=100,lineFrom=null,hvFrom=null}={}){
  let x=pt.x,y=pt.y
  if(angleSnap&&lineFrom){
    const dx=x-lineFrom.x,dy=y-lineFrom.y
    const a45=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4)
    const len=Math.sqrt(dx*dx+dy*dy)
    x=lineFrom.x+Math.cos(a45)*len;y=lineFrom.y+Math.sin(a45)*len
  }
  if(hvFrom){
    if(Math.abs(x-hvFrom.x)>=Math.abs(y-hvFrom.y))y=hvFrom.y;else x=hvFrom.x
  }
  if(gridSnap&&gridSize>0){x=Math.round(x/gridSize)*gridSize;y=Math.round(y/gridSize)*gridSize}
  return{x,y}
}

const DEFAULT_SHORTCUTS={pen:'b',eraser:'e',select:'s',move:'v',line:'l',ruler:'r',grid:'g',hand:'h',sizeUp:']',sizeDn:'['}
const SHORTCUT_ACTIONS=[
  {a:'pen',l:'ペン'},{a:'eraser',l:'消しゴム'},{a:'select',l:'選択範囲'},
  {a:'move',l:'レイヤー移動'},{a:'line',l:'直線'},{a:'ruler',l:'定規'},
  {a:'hand',l:'手のひら移動'},
  {a:'grid',l:'マス目切替'},{a:'sizeUp',l:'サイズ拡大'},{a:'sizeDn',l:'サイズ縮小'},
]

// ── Practice compound objects ──────────────────────────────────────
const COMPOUNDS=['sphere','cube','cylinder','cone','torus','octahedron','tetrahedron','icosahedron','dodecahedron','prism','pyramid','capsule','torusknot','gem','arrow','mushroom','rocket','snowman','lamp','crystal','hourglass']
const PSTYLES=['shading','wireframe']
const PLABELS={shading:'陰影あり',wireframe:'線画'}
const TOOL_IDS=['pen','eraser','select','move','line','ruler','grid','hand']

// ep = ellipse perspective 0.2(front) → 0.55(top-down), rot/skX/skY = view angle
function genCompound(){
  return {
    type:COMPOUNDS[Math.floor(Math.random()*COMPOUNDS.length)],
    rot:(Math.random()-.5)*.28,
    skX:(Math.random()-.5)*.2,
    skY:(Math.random()-.5)*.08,
    ep:.22+Math.random()*.33
  }
}

function drawCompound(ctx,obj,cx,cy,sc,style){
  if(!obj)return
  const{type,rot=0,skX=0,skY=0,ep=.3}=typeof obj==='string'?{type:obj}:obj
  ctx.save()
  ctx.translate(cx,cy)
  ctx.transform(1,skY,skX,1-Math.abs(skY)*.3,0,0)
  if(rot)ctx.rotate(rot)
  ctx.translate(-cx,-cy)
  const fn={mushroom:drawMushroom,rocket:drawRocket,snowman:drawSnowman,lamp:drawLamp,crystal:drawCrystal,hourglass:drawHourglass,cube:drawCube,sphere:drawSphereShape,torus:drawTorus,octahedron:drawOctahedron,cone:drawCone}[type]
  if(fn)fn(ctx,cx,cy,sc,style,ep)
  ctx.restore()
}

// ── Shared helpers ────────────────────────────────────────────────
// Cast shadow on ground
function _gs(ctx,cx,cy,rx,ry){
  const g=ctx.createRadialGradient(cx+rx*.1,cy,0,cx,cy,Math.max(rx,ry)*1.1)
  g.addColorStop(0,'rgba(40,36,32,0.14)');g.addColorStop(1,'rgba(40,36,32,0)')
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill()
}
// White-plaster sphere: radial grad from upper-left highlight
function _sph(ctx,x,y,r,style,hue){
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2)
  if(style!=='outline'){
    if(style==='shading'){
      const g=ctx.createRadialGradient(x-r*.42,y-r*.38,r*.03,x+r*.18,y+r*.16,r*1.06)
      g.addColorStop(0,'#ffffff');g.addColorStop(.2,'#ece9e4');g.addColorStop(.55,'#c2beb8');g.addColorStop(.82,'#9a9692');g.addColorStop(1,'#726e6a')
      ctx.fillStyle=g
    } else if(style==='flat')ctx.fillStyle='#d4d0ca'
    else ctx.fillStyle=`hsl(${hue},50%,88%)`
    ctx.fill()
  }
  ctx.strokeStyle='#6e6a66';ctx.lineWidth=1.4;ctx.stroke()
}
// White-plaster cylinder fill (linear grad left→right)
function _cylFill(ctx,cx,w,style,hue){
  if(style==='shading'){
    const g=ctx.createLinearGradient(cx-w,0,cx+w,0)
    g.addColorStop(0,'#8a8682');g.addColorStop(.22,'#ffffff');g.addColorStop(.6,'#d8d4ce');g.addColorStop(1,'#8a8682')
    ctx.fillStyle=g
  } else if(style==='flat')ctx.fillStyle='#d4d0ca'
  else ctx.fillStyle=`hsl(${hue},45%,87%)`
}
// Stroke in warm dark-gray (not black)
const SK='#6e6a66'

function drawMushroom(ctx,cx,cy,sc,style,ep=.3){
  const bY=cy+sc*.48,sW=sc*.17,cRx=sc*.42,cRy=sc*.34,sTop=cy+sc*.04
  const ey=r=>r*(.18+ep*.45)  // horizontal ellipse Y based on viewpoint
  if(style==='shading')_gs(ctx,cx+sc*.06,bY+sc*.01,sc*.5,sc*.08)
  // stem
  ctx.beginPath();ctx.moveTo(cx-sW*1.1,bY);ctx.lineTo(cx-sW*.65,sTop);ctx.lineTo(cx+sW*.65,sTop);ctx.lineTo(cx+sW*1.1,bY);ctx.closePath()
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createLinearGradient(cx-sW,0,cx+sW,0);g.addColorStop(0,'#9a9690');g.addColorStop(.22,'#f2eee8');g.addColorStop(.68,'#d8d4cc');g.addColorStop(1,'#9a9690');ctx.fillStyle=g}
    else if(style==='flat')ctx.fillStyle='#d0ccc6'
    else ctx.fillStyle='hsl(50,40%,88%)'
    ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  // underside ellipse
  ctx.beginPath();ctx.ellipse(cx,sTop,cRx*.78,ey(cRx*.78),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='colored'?'hsl(50,40%,80%)':'#c8c4bc';ctx.fill()}
  ctx.strokeStyle=SK;ctx.lineWidth=1.1;ctx.stroke()
  // cap dome (bezier arc + underside ellipse curve)
  ctx.save();ctx.beginPath()
  ctx.moveTo(cx-cRx,sTop)
  ctx.bezierCurveTo(cx-cRx,cy-cRy*1.18,cx+cRx,cy-cRy*1.18,cx+cRx,sTop)
  ctx.ellipse(cx,sTop,cRx*.78,ey(cRx*.78),0,0,Math.PI);ctx.closePath()
  if(style!=='outline'){
    if(style==='shading'){
      const rg=ctx.createRadialGradient(cx-cRx*.3,cy-cRy*.46,cRx*.04,cx+cRx*.1,cy+cRy*.1,cRx*1.06)
      rg.addColorStop(0,'#ffffff');rg.addColorStop(.26,'#ece9e4');rg.addColorStop(.6,'#c4c0bc');rg.addColorStop(.84,'#9a9692');rg.addColorStop(1,'#726e6a')
      ctx.fillStyle=rg
    } else if(style==='flat')ctx.fillStyle='#d0ccc6'
    else ctx.fillStyle='hsl(0,30%,84%)'
    ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.8;ctx.stroke();ctx.restore()
  // spots (subtle on white)
  if(style!=='outline'){
    [[-.22,-.3,.1],[.2,-.5,.085],[.4,-.18,.072],[-.04,-.58,.065]].forEach(([dx,dy,r])=>{
      ctx.beginPath();ctx.ellipse(cx+dx*cRx,cy+dy*cRy,r*cRx,r*cRx*.66,0,0,Math.PI*2)
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.fill()
      ctx.strokeStyle='rgba(140,132,126,.28)';ctx.lineWidth=.7;ctx.stroke()
    })
  }
}

function drawRocket(ctx,cx,cy,sc,style,ep=.3){
  const bY=cy+sc*.5,tY=cy-sc*.52,bW=sc*.2
  const ey=r=>r*(.14+ep*.42)
  if(style==='shading')_gs(ctx,cx+sc*.06,bY+sc*.02,sc*.42,sc*.07)
  const bodyBot=bY-sc*.06,bodyTop=tY+sc*.28
  // fins
  ;[-1,1].forEach(sx=>{
    ctx.beginPath();ctx.moveTo(cx+sx*bW*.88,bodyBot);ctx.lineTo(cx+sx*(bW+sc*.2),bY);ctx.lineTo(cx+sx*bW*.6,bY-sc*.04);ctx.closePath()
    if(style!=='outline'){
      if(style==='shading')ctx.fillStyle=sx<0?'#aeaaa6':'#cac6c2'
      else if(style==='flat')ctx.fillStyle='#cac6c2'
      else ctx.fillStyle='hsl(200,35%,84%)'
      ctx.fill()
    }
    ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  })
  // body
  if(style!=='outline'){_cylFill(ctx,cx,bW,style,200);ctx.fillRect(cx-bW,bodyTop,bW*2,bodyBot-bodyTop)}
  ctx.strokeStyle=SK;ctx.lineWidth=1.7;ctx.strokeRect(cx-bW,bodyTop,bW*2,bodyBot-bodyTop)
  // nose
  ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx-bW,bodyTop);ctx.lineTo(cx+bW,bodyTop);ctx.closePath()
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createLinearGradient(cx-bW,0,cx+bW,0);g.addColorStop(0,'#8a8682');g.addColorStop(.24,'#ffffff');g.addColorStop(.68,'#d8d4ce');g.addColorStop(1,'#8a8682');ctx.fillStyle=g}
    else if(style==='flat')ctx.fillStyle='#cac6c2'
    else ctx.fillStyle='hsl(10,30%,86%)'
    ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.7;ctx.stroke()
  // nose top cap ellipse
  ctx.beginPath();ctx.ellipse(cx,bodyTop,bW,ey(bW),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#e0dcd6':'#cac6c2';ctx.fill()};ctx.strokeStyle=SK;ctx.lineWidth=1.2;ctx.stroke()
  // porthole window
  const wR=bW*.42,wY=cy+sc*.06
  ctx.beginPath();ctx.ellipse(cx,wY,wR,wR*.88,0,0,Math.PI*2)
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createRadialGradient(cx-wR*.32,wY-wR*.3,wR*.05,cx,wY,wR);g.addColorStop(0,'#dceeff');g.addColorStop(.58,'#b0c8dc');g.addColorStop(1,'#7898ac');ctx.fillStyle=g}
    else ctx.fillStyle=style==='colored'?'hsl(200,55%,84%)':'#b8ccd8'
    ctx.fill()
  }
  ctx.strokeStyle='#9098a2';ctx.lineWidth=2;ctx.stroke()
  // exhaust glow
  if(style!=='outline'){
    for(let i=0;i<3;i++){
      const fw=bW*(.54-i*.13),fh=sc*(.1+i*.034)
      const g2=ctx.createLinearGradient(0,bodyBot,0,bodyBot+fh)
      g2.addColorStop(0,style==='colored'?'#ffe080':'#e8dca8');g2.addColorStop(1,'rgba(220,200,140,0)')
      ctx.fillStyle=g2;ctx.globalAlpha=.7-i*.16
      ctx.beginPath();ctx.ellipse(cx,bodyBot,fw,fh,0,0,Math.PI*2);ctx.fill()
      ctx.globalAlpha=1
    }
  }
}

function drawSnowman(ctx,cx,cy,sc,style,ep=.3){
  const bR=sc*.3,mR=sc*.22,hR=sc*.16,bY=cy+sc*.18,mY=cy-sc*.22,hY=cy-sc*.46
  const ey=r=>r*(.18+ep*.44)
  if(style==='shading')_gs(ctx,cx+sc*.06,bY+bR*.92,sc*.38,sc*.07)
  _sph(ctx,cx,bY,bR,style,200);_sph(ctx,cx,mY,mR,style,200);_sph(ctx,cx,hY,hR,style,200)
  // hat cylinder
  const hW=hR*1.05,hH=hR*1.15,bW2=hR*1.5,bH=hR*.18,hBot=hY-hR*.58,hTop=hBot-hH
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createLinearGradient(cx-hW,0,cx+hW,0);g.addColorStop(0,'#1e1c1a');g.addColorStop(.3,'#5a5654');g.addColorStop(1,'#1e1c1a');ctx.fillStyle=g}
    else ctx.fillStyle=style==='colored'?'hsl(260,30%,22%)':'#363230'
    ctx.fillRect(cx-hW,hTop,hW*2,hH);ctx.fillRect(cx-bW2,hBot-bH,bW2*2,bH)
  }
  ctx.strokeStyle='#1e1c1a';ctx.lineWidth=1.5
  ctx.strokeRect(cx-hW,hTop,hW*2,hH);ctx.strokeRect(cx-bW2,hBot-bH,bW2*2,bH)
  // hat top ellipse (shows perspective)
  ctx.beginPath();ctx.ellipse(cx,hTop,hW,ey(hW),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#484442':'#363230';ctx.fill()};ctx.strokeStyle='#1e1c1a';ctx.lineWidth=1.2;ctx.stroke()
  if(style!=='outline'){
    [-.12,0,.12].forEach(t=>{ctx.beginPath();ctx.arc(cx,mY+t*mR*2.2,mR*.1,0,Math.PI*2);ctx.fillStyle='#282624';ctx.fill()})
    [-.28,.28].forEach(ex=>{ctx.beginPath();ctx.arc(cx+ex*hR,hY-hR*.3,hR*.1,0,Math.PI*2);ctx.fillStyle='#282624';ctx.fill()})
    ctx.save();ctx.beginPath()
    ctx.moveTo(cx+hR*.08,hY+hR*.1);ctx.lineTo(cx+hR*.82,hY+hR*.15);ctx.lineTo(cx+hR*.08,hY+hR*.2);ctx.closePath()
    ctx.fillStyle=style==='colored'?'hsl(28,85%,55%)':'#c47000';ctx.fill()
    ctx.strokeStyle='#904800';ctx.lineWidth=1;ctx.stroke();ctx.restore()
  }
}

function drawLamp(ctx,cx,cy,sc,style,ep=.3){
  const bY=cy+sc*.48,pW=sc*.04,pH=sc*.58,sW=sc*.36,sBot=cy-sc*.1,sTop=cy-sc*.38,tW=sc*.13
  const ey=r=>r*(.18+ep*.48)
  if(style==='shading')_gs(ctx,cx+sc*.05,bY+sc*.01,sc*.32,sc*.06)
  // base disk
  ctx.beginPath();ctx.ellipse(cx,bY,sc*.22,ey(sc*.22),0,0,Math.PI*2)
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createRadialGradient(cx-sc*.06,bY,0,cx,bY,sc*.22);g.addColorStop(0,'#f4f0ea');g.addColorStop(.5,'#c8c4bc');g.addColorStop(1,'#8a8682');ctx.fillStyle=g}
    else ctx.fillStyle=style==='colored'?'hsl(40,40%,84%)':'#cac6be'
    ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  // pole
  if(style!=='outline'){_cylFill(ctx,cx,pW,style,40);ctx.fillRect(cx-pW,bY-pH,pW*2,pH)}
  ctx.strokeStyle=SK;ctx.lineWidth=1.4;ctx.strokeRect(cx-pW,bY-pH,pW*2,pH)
  // shade body (trapezoid)
  ctx.beginPath();ctx.moveTo(cx-tW,sTop);ctx.lineTo(cx+tW,sTop);ctx.lineTo(cx+sW,sBot);ctx.lineTo(cx-sW,sBot);ctx.closePath()
  if(style!=='outline'){
    if(style==='shading'){const g=ctx.createLinearGradient(cx-sW,0,cx+sW,0);g.addColorStop(0,'#8a8682');g.addColorStop(.2,'#ffffff');g.addColorStop(.62,'#d8d4cc');g.addColorStop(1,'#8a8682');ctx.fillStyle=g}
    else ctx.fillStyle=style==='colored'?'hsl(40,45%,86%)':'#d4d0c8'
    ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.8;ctx.stroke()
  // top/bottom rim ellipses
  ctx.beginPath();ctx.ellipse(cx,sTop,tW,ey(tW),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#eceae4':'#d0ccc4';ctx.fill()};ctx.strokeStyle=SK;ctx.lineWidth=1.2;ctx.stroke()
  ctx.beginPath();ctx.ellipse(cx,sBot,sW,ey(sW),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#c4c0ba':'#b8b4ac';ctx.fill()};ctx.strokeStyle=SK;ctx.lineWidth=1.2;ctx.stroke()
  // inner glow hint
  if(style==='shading'){
    const gY=sBot+sc*.04,glow=ctx.createRadialGradient(cx,gY,0,cx,gY,sc*.2)
    glow.addColorStop(0,'rgba(255,248,220,0.16)');glow.addColorStop(1,'rgba(255,248,220,0)')
    ctx.fillStyle=glow;ctx.beginPath();ctx.ellipse(cx,gY,sc*.2,sc*.1,0,0,Math.PI*2);ctx.fill()
  }
}

function drawCrystal(ctx,cx,cy,sc,style,ep=.3){
  const bY=cy+sc*.44,tY=cy-sc*.22,tipY=cy-sc*.53,btY=bY+sc*.1
  const w=sc*.3,nw=sc*.12
  if(style==='shading')_gs(ctx,cx+sc*.06,btY+sc*.02,sc*.33,sc*.06)
  // tone → light gray value (shading: white=1.0, dark=0.0)
  const f=tone=>{
    if(style==='outline')return null
    const L=Math.round(tone*78+8)
    if(style==='shading')return`hsl(210,8%,${L}%)`
    if(style==='flat')return'hsl(210,5%,68%)'
    return`hsl(210,42%,${Math.round(tone*62+22)}%)`
  }
  const p=(pts,tone,lw=1.4)=>{
    ctx.beginPath();pts.forEach((pt,i)=>i===0?ctx.moveTo(pt[0],pt[1]):ctx.lineTo(pt[0],pt[1]));ctx.closePath()
    const c=f(tone);if(c){ctx.fillStyle=c;ctx.fill()};ctx.strokeStyle='#7a7870';ctx.lineWidth=lw;ctx.stroke()
  }
  p([[cx-w,bY],[cx,btY],[cx-nw,bY]],.28);p([[cx-nw,bY],[cx,btY],[cx+nw,bY]],.56);p([[cx+nw,bY],[cx,btY],[cx+w,bY]],.38)
  p([[cx-w,tY],[cx-nw,tY],[cx-nw,bY],[cx-w,bY]],.26)
  p([[cx-nw,tY],[cx+nw,tY],[cx+nw,bY],[cx-nw,bY]],.92)
  p([[cx+nw,tY],[cx+w,tY],[cx+w,bY],[cx+nw,bY]],.54)
  p([[cx-w,tY],[cx,tipY],[cx-nw,tY]],.46);p([[cx-nw,tY],[cx,tipY],[cx+nw,tY]],1.0);p([[cx+nw,tY],[cx,tipY],[cx+w,tY]],.66)
  if(style==='shading'){
    ctx.beginPath();ctx.moveTo(cx,tipY);ctx.lineTo(cx,btY)
    ctx.strokeStyle='rgba(255,255,255,.3)';ctx.lineWidth=1.2;ctx.stroke()
  }
}

function drawHourglass(ctx,cx,cy,sc,style,ep=.3){
  const bY=cy+sc*.46,tY=cy-sc*.46,oW=sc*.3,mW=sc*.08,fW=sc*.055
  const ey=r=>r*(.18+ep*.46)
  if(style==='shading')_gs(ctx,cx+sc*.06,bY+sc*.02,sc*.36,sc*.07)
  // frame rings
  ;[tY,bY].forEach(fy=>{
    ctx.beginPath();ctx.ellipse(cx,fy,oW,ey(oW),0,0,Math.PI*2)
    if(style!=='outline'){
      if(style==='shading'){const g=ctx.createLinearGradient(cx-oW,0,cx+oW,0);g.addColorStop(0,'#8a8682');g.addColorStop(.3,'#f2ede8');g.addColorStop(1,'#8a8682');ctx.fillStyle=g}
      else ctx.fillStyle=style==='colored'?'hsl(35,40%,84%)':'#cac6be'
      ctx.fill()
    }
    ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  })
  ;[-1,1].forEach(sx=>{
    const px=cx+sx*oW*.88
    if(style!=='outline'){
      ctx.fillStyle=style==='shading'?(sx<0?'#9e9a96':'#f2ede8'):style==='colored'?'hsl(35,36%,80%)':'#c4c0b8'
      ctx.fillRect(px-fW*.5,tY,fW,bY-tY)
    }
    ctx.strokeStyle=SK;ctx.lineWidth=1.2;ctx.strokeRect(px-fW*.5,tY,fW,bY-tY)
  })
  // glass body
  ctx.save();ctx.beginPath()
  ctx.moveTo(cx-oW*.88,tY);ctx.lineTo(cx+oW*.88,tY);ctx.lineTo(cx+mW,cy);ctx.lineTo(cx+oW*.88,bY);ctx.lineTo(cx-oW*.88,bY);ctx.lineTo(cx-mW,cy);ctx.closePath()
  ctx.clip()
  if(style!=='outline'){ctx.fillStyle='rgba(220,230,245,0.09)';ctx.fill()}
  // sand bottom
  if(style!=='outline'){
    ctx.beginPath();ctx.moveTo(cx-mW,cy);ctx.lineTo(cx+mW,cy);ctx.lineTo(cx+oW*.88,bY);ctx.lineTo(cx-oW*.88,bY);ctx.closePath()
    const sg=ctx.createLinearGradient(0,cy,0,bY)
    sg.addColorStop(0,style==='colored'?'hsl(45,55%,84%)':'#e0dace');sg.addColorStop(1,style==='colored'?'hsl(45,40%,68%)':'#b8b2a4')
    ctx.fillStyle=sg;ctx.fill()
    const sandRx=mW+(oW*.88-mW)*Math.min(1,sc*.02/(bY-cy))
    ctx.beginPath();ctx.ellipse(cx,cy+sc*.02,sandRx,sc*.018,0,0,Math.PI*2)
    ctx.fillStyle=style==='colored'?'hsl(45,50%,88%)':'#d8d2c4';ctx.fill()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(cx-oW*.88,tY);ctx.lineTo(cx+oW*.88,tY);ctx.lineTo(cx+mW,cy);ctx.lineTo(cx+oW*.88,bY);ctx.lineTo(cx-oW*.88,bY);ctx.lineTo(cx-mW,cy);ctx.closePath()
  ctx.strokeStyle='#7a7870';ctx.lineWidth=1.8;ctx.stroke()
  if(style!=='outline'){
    for(let i=0;i<3;i++){
      ctx.beginPath();ctx.moveTo(cx+(i-1)*sc*.015,cy-sc*.05);ctx.lineTo(cx+(i-1)*sc*.01,cy+sc*.07)
      ctx.strokeStyle='rgba(180,168,140,0.6)';ctx.lineWidth=1.2;ctx.stroke()
    }
  }
}

function drawCube(ctx,cx,cy,sc,style,ep=.3){
  const s=sc*.28,ey=s*(.14+ep*.54)
  if(style==='shading')_gs(ctx,cx+s*.12,cy+s+ey*.4,s*1.05,s*.1)
  const tb=[cx,cy-s-ey*2],tl=[cx-s,cy-s-ey],tr=[cx+s,cy-s-ey],tf=[cx,cy-s]
  const bf=[cx,cy+s],bl=[cx-s,cy+s-ey],br=[cx+s,cy+s-ey]
  const col=(tone)=>{
    if(style==='outline')return null
    if(style==='shading'){const L=Math.round(tone*72+16);return`hsl(35,6%,${L}%)`}
    if(style==='flat')return'#d0ccc8'
    const L=Math.round(tone*52+28);return`hsl(210,40%,${L}%)`
  }
  const face=(pts,tone)=>{
    ctx.beginPath();pts.forEach((p,i)=>i===0?ctx.moveTo(p[0],p[1]):ctx.lineTo(p[0],p[1]));ctx.closePath()
    const c=col(tone);if(c){ctx.fillStyle=c;ctx.fill()}
    ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  }
  face([tb,tr,tf,tl],1.0)
  face([tr,tf,bf,br],0.68)
  face([tl,tf,bf,bl],0.32)
  if(style==='shading'){
    ctx.beginPath();ctx.moveTo(tf[0],tf[1]);ctx.lineTo(bf[0],bf[1])
    ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=.8;ctx.stroke()
    ctx.beginPath();ctx.moveTo(tb[0],tb[1]);ctx.lineTo(tf[0],tf[1])
    ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=.8;ctx.stroke()
  }
}

function drawSphereShape(ctx,cx,cy,sc,style,ep=.3){
  const r=sc*.38
  if(style==='shading')_gs(ctx,cx+r*.06,cy+r*.96,r*.82,r*.1)
  _sph(ctx,cx,cy,r,style,210)
  if(style==='shading'){
    ctx.beginPath();ctx.arc(cx-r*.28,cy-r*.3,r*.09,0,Math.PI*2)
    ctx.fillStyle='rgba(255,255,255,.72)';ctx.fill()
  }
}

function drawTorus(ctx,cx,cy,sc,style,ep=.3){
  const rx=sc*.32,ry=rx*(.22+ep*.42),tr=sc*.12,tyr=tr*(.18+ep*.42)
  if(style==='shading')_gs(ctx,cx,cy+ry+tyr,rx*.85,tyr*.5)
  ctx.save();ctx.beginPath()
  ctx.ellipse(cx,cy,rx+tr,ry+tyr,0,0,Math.PI*2)
  ctx.ellipse(cx,cy,rx-tr,ry-tyr,0,0,Math.PI*2,true)
  if(style!=='outline'){
    let fill
    if(style==='shading'){
      const g=ctx.createLinearGradient(cx-(rx+tr),cy-(ry+tyr),cx+(rx+tr),cy+(ry+tyr))
      g.addColorStop(0,'#9e9a96');g.addColorStop(.28,'#ffffff');g.addColorStop(.55,'#d8d4ce');g.addColorStop(1,'#8e8a86')
      fill=g
    } else if(style==='flat')fill='#d0ccc8'
    else fill='hsl(180,42%,83%)'
    ctx.fillStyle=fill;ctx.fill('evenodd')
  }
  ctx.restore()
  ctx.strokeStyle=SK;ctx.lineWidth=1.4
  ctx.beginPath();ctx.ellipse(cx,cy,rx+tr,ry+tyr,0,0,Math.PI*2);ctx.stroke()
  ctx.beginPath();ctx.ellipse(cx,cy,rx-tr,ry-tyr,0,0,Math.PI*2);ctx.stroke()
  ctx.beginPath();ctx.ellipse(cx,cy-ry,tr,tyr,0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#f0ece6':style==='colored'?'hsl(180,38%,86%)':'#d4d0cc';ctx.fill()}
  ctx.strokeStyle=SK;ctx.lineWidth=1.1;ctx.stroke()
  ctx.beginPath();ctx.ellipse(cx,cy+ry,tr,tyr*.7,0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#a8a4a0':'#c0bcb8';ctx.fill()}
  ctx.strokeStyle=SK;ctx.lineWidth=.9;ctx.stroke()
}

function drawOctahedron(ctx,cx,cy,sc,style,ep=.3){
  const w=sc*.36,h=sc*.44
  const T=[cx,cy-h],B=[cx,cy+h],L=[cx-w,cy+h*.04],R=[cx+w,cy+h*.04],F=[cx,cy-h*.06]
  if(style==='shading')_gs(ctx,cx,B[1]+sc*.02,w*.82,sc*.06)
  const col=(tone)=>{
    if(style==='outline')return null
    if(style==='shading'){const L2=Math.round(tone*72+14);return`hsl(30,5%,${L2}%)`}
    if(style==='flat')return'#d0ccc8'
    const L2=Math.round(tone*52+28);return`hsl(220,40%,${L2}%)`
  }
  const face=(pts,tone)=>{
    ctx.beginPath();pts.forEach((p,i)=>i===0?ctx.moveTo(p[0],p[1]):ctx.lineTo(p[0],p[1]));ctx.closePath()
    const c=col(tone);if(c){ctx.fillStyle=c;ctx.fill()}
    ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  }
  face([T,L,F],.72)
  face([T,R,F],.96)
  face([B,L,F],.16)
  face([B,R,F],.42)
  ctx.beginPath();ctx.moveTo(T[0],T[1]);ctx.lineTo(L[0],L[1]);ctx.lineTo(B[0],B[1]);ctx.lineTo(R[0],R[1]);ctx.closePath()
  ctx.strokeStyle=SK;ctx.lineWidth=1.8;ctx.stroke()
}

function drawCone(ctx,cx,cy,sc,style,ep=.3){
  const bR=sc*.34,bY=cy+sc*.42,tY=cy-sc*.44
  const ey=r=>r*(.18+ep*.45)
  if(style==='shading')_gs(ctx,cx+bR*.1,bY+sc*.02,bR*.88,bR*.1)
  if(style==='shading'){
    ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx-bR,bY);ctx.lineTo(cx,bY);ctx.closePath()
    const gL=ctx.createLinearGradient(cx-bR,0,cx,0);gL.addColorStop(0,'#7a7672');gL.addColorStop(1,'#c8c4c0')
    ctx.fillStyle=gL;ctx.fill()
    ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx+bR,bY);ctx.lineTo(cx,bY);ctx.closePath()
    const gR=ctx.createLinearGradient(cx,0,cx+bR,0);gR.addColorStop(0,'#ffffff');gR.addColorStop(1,'#d0ccc8')
    ctx.fillStyle=gR;ctx.fill()
  } else if(style!=='outline'){
    ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx-bR,bY);ctx.lineTo(cx+bR,bY);ctx.closePath()
    ctx.fillStyle=style==='flat'?'#d0ccc8':'hsl(30,42%,85%)';ctx.fill()
  }
  ctx.strokeStyle=SK;ctx.lineWidth=1.8
  ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx-bR,bY);ctx.stroke()
  ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx+bR,bY);ctx.stroke()
  ctx.beginPath();ctx.ellipse(cx,bY,bR,ey(bR),0,0,Math.PI*2)
  if(style!=='outline'){ctx.fillStyle=style==='shading'?'#b8b4b0':'#c8c4c0';ctx.fill()}
  ctx.strokeStyle=SK;ctx.lineWidth=1.5;ctx.stroke()
  if(style==='shading'){
    ctx.beginPath();ctx.moveTo(cx+bR*.04,tY);ctx.lineTo(cx+bR*.04,bY)
    ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=.9;ctx.stroke()
  }
}

function clipLineToBBox(x1,y1,x2,y2,minX,minY,maxX,maxY){
  const dx=x2-x1,dy=y2-y1;let t0=0,t1=1
  const clip=(p,q)=>{if(p===0)return q>=0;const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r}else{if(r<t0)return false;if(r<t1)t1=r};return true}
  if(!clip(-dx,x1-minX)||!clip(dx,maxX-x1)||!clip(-dy,y1-minY)||!clip(dy,maxY-y1))return null
  return[x1+t0*dx,y1+t0*dy,x1+t1*dx,y1+t1*dy]
}
function screenToCv(sx,sy,rect){return{x:(sx-rect.left)*(CW/rect.width),y:(sy-rect.top)*(CH/rect.height)}}

// ── LayerThumb ────────────────────────────────────────────────────
function LayerThumb({layerId,layerCanvases,rev}) {
  const ref=useRef(null)
  useEffect(()=>{
    const t=ref.current;if(!t)return
    const s=layerCanvases.current[layerId];if(!s)return
    const ctx=t.getContext('2d');ctx.clearRect(0,0,t.width,t.height);ctx.drawImage(s,0,0,t.width,t.height)
  },[layerId,layerCanvases,rev])
  return <canvas ref={ref} width={44} height={32} className="layer-thumb-canvas"/>
}

// ── RulerOverlay ──────────────────────────────────────────────────
function RulerOverlay({w,h,rulers=[],activeRulerId=null}){
  const ref=useRef(null)
  useEffect(()=>{
    const c=ref.current;if(!c)return
    const ctx=c.getContext('2d');ctx.clearRect(0,0,w,h)
    rulers.forEach(ruler=>{
      const{x1,y1,x2,y2,type='div',divisions=8,color='#2864ff',id}=ruler
      const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy)
      if(len<4)return
      const isActive=id===activeRulerId
      const ux=dx/len,uy=dy/len
      const nx=-uy,ny=ux
      // parse color to rgba
      const alpha=isActive?0.95:0.75
      const alphaL=isActive?0.75:0.55
      const lw=isActive?2:1.5
      // helper: hex/named color -> rgba string
      const toRgba=(col,a)=>{
        const tmp=document.createElement('canvas');tmp.width=1;tmp.height=1
        const t=tmp.getContext('2d');t.fillStyle=col;t.fillRect(0,0,1,1)
        const d=t.getImageData(0,0,1,1).data
        return `rgba(${d[0]},${d[1]},${d[2]},${a})`
      }
      const C=toRgba(color,alpha)
      const CL=toRgba(color,alphaL)
      // main line
      ctx.strokeStyle=C;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()
      // endpoint handles
      const hR=isActive?6:4
      ;[[x1,y1],[x2,y2]].forEach(([px,py])=>{
        ctx.beginPath();ctx.arc(px,py,hR,0,Math.PI*2)
        ctx.fillStyle='#fff';ctx.fill()
        ctx.strokeStyle=C;ctx.lineWidth=isActive?2:1.5;ctx.stroke()
      })
      // tick marks
      const TICK=isActive?13:10
      ctx.lineWidth=isActive?1.4:1.1
      const tick=(d,h2,label)=>{
        const px=x1+ux*d,py=y1+uy*d
        ctx.beginPath()
        ctx.moveTo(px-nx*h2,py-ny*h2)
        ctx.lineTo(px+nx*h2,py+ny*h2)
        ctx.strokeStyle=CL;ctx.stroke()
        if(label!=null){
          ctx.fillStyle=C
          ctx.font=`bold ${isActive?10:9}px sans-serif`
          ctx.fillText(label,px+nx*(TICK+5)-ctx.measureText(label).width/2,py+ny*(TICK+5)+4)
        }
      }
      if(type==='cm'){
        const ppc=96/2.54
        const step=ppc/10
        for(let d=0;d<=len+.5;d+=step){
          const rem=d%ppc
          const isCm=rem<.9||rem>ppc-.9
          const isMm5=d%(ppc/2)<.9
          const h2=isCm?TICK:isMm5?TICK*.6:TICK*.3
          tick(d,h2,isCm&&d>0.5?`${Math.round(d/ppc)}`:null)
        }
        const totalCm=(len/ppc).toFixed(1)
        const mx=(x1+x2)/2,my=(y1+y2)/2
        ctx.font=`bold ${isActive?11:10}px sans-serif`;ctx.fillStyle=C
        ctx.fillText(`${totalCm}cm`,mx+nx*22-ctx.measureText(`${totalCm}cm`).width/2,my+ny*22+4)
      } else if(type==='div'){
        const n=divisions
        for(let i=0;i<=n;i++){
          const d=len*i/n
          const isEnd=i===0||i===n
          tick(d,isEnd?TICK*1.1:TICK*.85,(!isEnd&&i>0)?`${i}`:null)
        }
        ctx.font=`bold ${isActive?10:9}px sans-serif`;ctx.fillStyle=C
        ctx.fillText('0',x1+nx*(TICK+5)-4,y1+ny*(TICK+5)+4)
        ctx.fillText(`${n}`,x2+nx*(TICK+5)-4,y2+ny*(TICK+5)+4)
      }
      // type==='none' -> line and handles only
      ctx.globalAlpha=1
    })
  },[w,h,rulers,activeRulerId])
  return <canvas ref={ref} width={w} height={h} className="ruler-overlay"/>
}

// ── SelectionStrip ─────────────────────────────────────────────────
function SelectionStrip({sel,canvasEl,onDeselect,onDelete,onDeleteOut,onFill,onTransform}) {
  if(!sel||!canvasEl||sel.w<2||sel.h<2)return null
  const r=canvasEl.getBoundingClientRect()
  const left=Math.max(4,r.left+sel.x*(r.width/CW)-38)
  const top=r.top+sel.y*(r.height/CH)
  const items=[
    {icon:<DeselectIcon/>,label:'選択を解除',fn:onDeselect},
    {icon:<DeleteSelIcon/>,label:'消去',fn:onDelete},
    {icon:<DeleteOutIcon/>,label:'選択範囲外を消去',fn:onDeleteOut},
    {icon:<TransformIcon/>,label:'拡大・縮小・回転',fn:onTransform},
    {icon:<FillSelIcon/>,label:'塗りつぶし',fn:onFill},
  ]
  return (
    <div className="sel-strip" style={{left,top}}>
      {items.map((item,i)=>(
        <button key={i} className="sel-strip-btn" onClick={item.fn}>
          {item.icon}<span className="sel-strip-tip">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── TransformOverlay ──────────────────────────────────────────────
function TransformOverlay({xf,canvasEl,onUpdate,onCommit,onCancel}) {
  if(!xf||!canvasEl)return null
  const r=canvasEl.getBoundingClientRect()
  const sx=r.width/CW,sy=r.height/CH
  const {rect,angle}=xf, cx=rect.x+rect.w/2, cy=rect.y+rect.h/2
  const handles=[['tl',rect.x,rect.y],['tc',cx,rect.y],['tr',rect.x+rect.w,rect.y],['ml',rect.x,cy],['mr',rect.x+rect.w,cy],['bl',rect.x,rect.y+rect.h],['bc',cx,rect.y+rect.h],['br',rect.x+rect.w,rect.y+rect.h],['rot',cx,rect.y-36/sy]]
  const onHDown=(e,hid)=>{
    e.preventDefault();e.stopPropagation()
    const sx2=e.clientX,sy2=e.clientY,orig={...rect}
    const onM=ev=>{
      const dx=(ev.clientX-sx2)/sx,dy=(ev.clientY-sy2)/sy
      if(hid==='rot'){const scx=r.left+cx*sx,scy=r.top+cy*sy;onUpdate({angle:Math.atan2(ev.clientY-scy,ev.clientX-scx)+Math.PI/2});return}
      const nr={...orig}
      if(hid.includes('l')){nr.x=orig.x+dx;nr.w=Math.max(8,orig.w-dx)}
      if(hid.includes('r'))nr.w=Math.max(8,orig.w+dx)
      if(hid.includes('t')){nr.y=orig.y+dy;nr.h=Math.max(8,orig.h-dy)}
      if(hid.includes('b'))nr.h=Math.max(8,orig.h+dy)
      onUpdate({rect:nr})
    }
    const onU=()=>{window.removeEventListener('mousemove',onM);window.removeEventListener('mouseup',onU)}
    window.addEventListener('mousemove',onM);window.addEventListener('mouseup',onU)
  }
  const toS=(hx,hy)=>({left:r.left+hx*sx-5,top:r.top+hy*sy-5})
  return(<>
    <div className="xf-outline" style={{left:r.left+rect.x*sx,top:r.top+rect.y*sy,width:rect.w*sx,height:rect.h*sy,transform:`rotate(${angle}rad)`,transformOrigin:`${(cx-rect.x)*sx}px ${(cy-rect.y)*sy}px`}}/>
    {handles.map(([hid,hx,hy])=>{const sp=toS(hx,hy);return <div key={hid} className={`xf-handle${hid==='rot'?' xf-rot':''}`} style={{left:sp.left,top:sp.top}} onMouseDown={e=>onHDown(e,hid)}/>})}
    <div className="xf-btns" style={{left:r.left+rect.x*sx,top:r.top+(rect.y+rect.h)*sy+10}}>
      <button onClick={onCommit}>確定</button><button onClick={onCancel}>取消</button>
    </div>
  </>)
}

// ── App ───────────────────────────────────────────────────────────
export default function App() {
  const [activeTool,setActiveTool]     = useState(TOOLS.PEN)
  const [penColor,setPenColor]         = useState('#000000')
  const [penSize,setPenSize]           = useState(5)
  const [eraserSize,setEraserSize]     = useState(20)
  const [splitRatio,setSplitRatio]     = useState(50)  // percent 15-85
  const [panOffset,setPanOffset]       = useState({x:0,y:0})
  const [refImage,setRefImage]         = useState(null)
  const [refOpacity,setRefOpacity]     = useState(100)
  const [refOverlay,setRefOverlay]     = useState(false)
  const [refOverlayOpacity,setRefOverlayOpacity] = useState(50)
  const [layers,setLayers]             = useState([mkPaper(),mkLayer(1,'レイヤー 1')])
  const [activeLayerId,setActiveLayerId] = useState(1)
  const [showLayerPanel,setShowLayerPanel] = useState(true)
  const [rev,setRev]                   = useState(0)
  const [showGrid,setShowGrid]         = useState(false)
  const [gridSize,setGridSize]         = useState(100)
  const [gridOpacity,setGridOpacity]   = useState(40)
  const [showRuler,setShowRuler]       = useState(false)
  const [rulerType,setRulerType]       = useState('div')   // default for next ruler
  const [rulerDivisions,setRulerDivisions] = useState(8)  // default for next ruler
  const [rulers,setRulers]             = useState([])      // [{id,x1,y1,x2,y2,type,divisions,color}]
  const [activeRulerId,setActiveRulerId] = useState(null)
  const [urlInput,setUrlInput]         = useState('')
  const [urlError,setUrlError]         = useState('')
  const [selPanel,setSelPanel]         = useState(null)
  const [xf,setXf]                     = useState(null)
  const [showMenu,setShowMenu]         = useState(false)
  const [leftHanded,setLeftHanded]     = useState(false)
  const [hardMode,_setHardMode]        = useState(false)
  const [photoLayerIdx,setPhotoLayerIdx] = useState(0)
  const [practiceMode,setPracticeMode] = useState(false)
  const [practiceStyle,setPracticeStyle] = useState('shading')
  const [practiceObject,setPracticeObject] = useState(null)
  const [practiceOrbit,setPracticeOrbit] = useState({rx:.3,ry:.2,rz:0,zoom:1})
  const [refImageSize,setRefImageSize]   = useState(null)    // {w,h}|null
  const [showShortcutPanel,setShowShortcutPanel] = useState(false)
  const [scLearning,setScLearning]       = useState(null)
  const [shortcuts,setShortcuts]         = useState(()=>{
    try{return{...DEFAULT_SHORTCUTS,...JSON.parse(localStorage.getItem('key-shortcuts')||'{}')} }catch{return{...DEFAULT_SHORTCUTS}}
  })

  const setHardMode = v => { if(v&&activeTool!==TOOLS.PEN)setActiveTool(TOOLS.PEN); _setHardMode(v) }

  const [_selRect,_setSel] = useState(null)
  const selRef     = useRef(null)
  const setSel     = v => { const val=typeof v==='function'?v(selRef.current):v; selRef.current=val; _setSel(val) }
  const xfRef      = useRef(null)
  const setXfState = v => { const val=typeof v==='function'?v(xfRef.current):v; xfRef.current=val; setXf(val) }

  const layerCanvases  = useRef({})
  const displayRef     = useRef(null)
  const photoDispRef   = useRef(null)
  const photoCanvas    = useRef(null)
  const bakedImageRef  = useRef(null)
  const panOffsetRef   = useRef({x:0,y:0})
  const panStartRef    = useRef(null)
  const lastClientXY   = useRef(null)
  const refImageEl     = useRef(null)
  const fileInputRef   = useRef(null)
  const practiceObjRef  = useRef(null)
  const orbitDragStart    = useRef(null)
  const placingRulerIdRef = useRef(null)
  const canvasAreaRef     = useRef(null)
  const drawAreaRef       = useRef(null)
  const splitDragRef      = useRef(null)
  const [splitDragging,setSplitDragging] = useState(false)
  const [viewZoom,setViewZoom] = useState(100)
  const [fitDims,setFitDims] = useState(null) // {w,h}|null for fit mode

  // layer drag-to-reorder
  const layerListRef   = useRef(null)
  const layerDragRef   = useRef({srcIdx:null,dropIdx:null,startY:0,moved:false})
  const listItemsRef   = useRef([])
  const [layerDragSrc, setLayerDragSrc] = useState(null)
  const [layerDropIdx, setLayerDropIdx] = useState(null)

  const photoBakedRef = useRef(false)
  const practiceOverlayRef = useRef(null)  // visible DOM canvas on top of 3D
  const [practiceDrawMode, setPracticeDrawMode] = useState(true)

  const [toolPositions,setToolPositions]=useState(()=>{try{return JSON.parse(localStorage.getItem('tool-positions')||'{}')}catch{return{}}})
  const [editToolLayout,setEditToolLayout]=useState(false)

  // ── Tabmate (WebHID) ──────────────────────────────────────────
  const [showTabmatePanel,setShowTabmatePanel] = useState(false)
  const [tabmateConnected,setTabmateConnected] = useState(false)
  const [tabmateLearning,setTabmateLearning]   = useState(null) // action key being learned
  const [tabmateMappings,setTabmateMappings]   = useState(()=>{
    try{return JSON.parse(localStorage.getItem('tabmate-mappings')||'{}')}catch{return {}}
  })
  const tabmateDeviceRef    = useRef(null)
  const tabmateLearningRef  = useRef(null)
  const tabmateLastReport   = useRef(null)
  const tabmateActionsRef   = useRef({})
  const tabmateMappingsRef  = useRef({})
  const shortcutsRef        = useRef(shortcuts)
  const scLearningRef       = useRef(null)

  // history
  const histStacks = useRef({})
  const histPtrs   = useRef({})
  const lastHistKey = useRef(null)

  const isDrawing    = useRef(false)
  const lastPt       = useRef(null)
  const lineStart    = useRef(null)
  const lineStartScreen = useRef(null)
  const penStrokeStart = useRef(null)
  const selPtsRef    = useRef([])
  const selMoveStart = useRef(null)
  const selMoveSnap  = useRef(null)
  const selMoveOrigR = useRef(null)
  const moveOrigin   = useRef(null)
  const moveSnap     = useRef(null)

  const S = useRef({})
  S.current = {activeTool,penColor,penSize,eraserSize,activeLayerId,refOpacity,refOverlay,refOverlayOpacity,layers,showGrid,gridSize,gridOpacity,selPanel,photoLayerIdx,practiceMode,practiceDrawMode,practiceStyle,practiceObject,rulerType,rulerDivisions,splitRatio,hardMode}
  shortcutsRef.current = shortcuts
  scLearningRef.current = scLearning

  const rCompRef = useRef(null)
  const lCompRef = useRef(null)
  const doUndoRef = useRef(null)
  const doRedoRef = useRef(null)
  const threeRef  = useRef(null)   // { renderer, rendered }

  // ── Canvas init ───────────────────────────────────────────────
  useEffect(()=>{
    if(!photoCanvas.current){
      const c=document.createElement('canvas');c.width=CW;c.height=CH;photoCanvas.current=c
      const blank=c.getContext('2d').getImageData(0,0,CW,CH)
      histStacks.current['photo']=[blank];histPtrs.current['photo']=0
    }
  },[])

  // Reset overlay canvas history whenever practice mode is entered
  useEffect(()=>{
    if(!practiceMode)return
    const resetOverlay=()=>{
      const c=practiceOverlayRef.current;if(!c)return
      c.getContext('2d').clearRect(0,0,CW,CH)
      histStacks.current['practiceDraw']=[c.getContext('2d').getImageData(0,0,CW,CH)]
      histPtrs.current['practiceDraw']=0;lastHistKey.current=null
    }
    // Delay one frame so the canvas element is mounted
    const id=requestAnimationFrame(resetOverlay)
    return()=>cancelAnimationFrame(id)
  },[practiceMode])

  useEffect(()=>{
    layers.forEach(l=>{
      if(!layerCanvases.current[l.id]){
        const c=document.createElement('canvas');c.width=CW;c.height=CH
        if(l.isPaper){const cx=c.getContext('2d');cx.fillStyle='#ffffff';cx.fillRect(0,0,CW,CH)}
        layerCanvases.current[l.id]=c
        const key=String(l.id),blank=c.getContext('2d').getImageData(0,0,CW,CH)
        histStacks.current[key]=[blank];histPtrs.current[key]=0
      }
    })
    Object.keys(layerCanvases.current).forEach(id=>{if(!layers.find(l=>l.id===+id))delete layerCanvases.current[id]})
  },[layers])

  useEffect(()=>{
    if(!refImage){refImageEl.current=null;setRefImageSize(null);return}
    const img=new Image();img.crossOrigin='anonymous';img.src=refImage
    img.onload=()=>{
      refImageEl.current=img;setRefImageSize({w:img.naturalWidth,h:img.naturalHeight})
      photoBakedRef.current=false
      if(photoCanvas.current)photoCanvas.current.getContext('2d').clearRect(0,0,CW,CH)
      if(bakedImageRef.current)bakedImageRef.current.getContext('2d').clearRect(0,0,CW,CH)
      setRev(r=>r+1)
    }
  },[refImage])

  // ── History ───────────────────────────────────────────────────
  const saveHist = useCallback((panel)=>{
    const isPractice=panel==='left'&&S.current.practiceMode
    const isPhoto=!isPractice&&(panel==='left'||S.current.activeLayerId==='photo')
    const key=isPractice?'practiceDraw':isPhoto?'photo':String(S.current.activeLayerId)
    const canvas=isPractice?practiceOverlayRef.current:isPhoto?photoCanvas.current:layerCanvases.current[S.current.activeLayerId]
    if(!canvas)return
    const data=canvas.getContext('2d').getImageData(0,0,CW,CH)
    const stack=histStacks.current[key]??[];if(!histStacks.current[key]){histStacks.current[key]=stack;histPtrs.current[key]=-1}
    const ptr=histPtrs.current[key]??-1
    stack.splice(ptr+1);stack.push(data)
    if(stack.length>MAX_HIST)stack.shift()
    histPtrs.current[key]=stack.length-1
    lastHistKey.current=key
  },[])

  // ── Photo layer bake ──────────────────────────────────────────
  const bakePhoto = useCallback(()=>{
    if(!refImageEl.current)return
    const img=refImageEl.current,pAR=img.naturalWidth/img.naturalHeight,cAR=CW/CH
    let dw,dh,dx=0,dy=0
    if(pAR>cAR){dw=CW;dh=CW/pAR;dy=(CH-dh)/2}else{dh=CH;dw=CH*pAR;dx=CW-dw}
    if(!bakedImageRef.current){const c=document.createElement('canvas');c.width=CW;c.height=CH;bakedImageRef.current=c}
    const bctx=bakedImageRef.current.getContext('2d');bctx.clearRect(0,0,CW,CH);bctx.drawImage(img,dx,dy,dw,dh)
    photoBakedRef.current=true
    saveHist('left')
  },[saveHist])

  useEffect(()=>{
    if(activeLayerId==='photo'&&!photoBakedRef.current)bakePhoto()
  },[activeLayerId,bakePhoto])

  // ── Composite ─────────────────────────────────────────────────
  const rightComposite = useCallback(()=>{
    const disp=displayRef.current;if(!disp)return
    const ctx=disp.getContext('2d');ctx.clearRect(0,0,CW,CH)
    const {refOverlay,refOverlayOpacity,layers,showGrid,gridSize,gridOpacity,photoLayerIdx}=S.current
    const dl=layers.filter(l=>!l.isPaper), paper=layers.find(l=>l.isPaper)
    if(paper?.visible){const lc=layerCanvases.current[paper.id];if(lc){ctx.globalAlpha=paper.opacity/100;ctx.drawImage(lc,0,0);ctx.globalAlpha=1}}
    dl.forEach((l,i)=>{
      if(refOverlay&&i===photoLayerIdx){const _rs=photoBakedRef.current?bakedImageRef.current:refImageEl.current;if(_rs){ctx.globalAlpha=refOverlayOpacity/100;ctx.drawImage(_rs,0,0,CW,CH);ctx.globalAlpha=1}}
      if(!l.visible)return;const lc=layerCanvases.current[l.id];if(!lc)return
      ctx.globalAlpha=l.opacity/100;ctx.drawImage(lc,0,0);ctx.globalAlpha=1
    })
    if(refOverlay&&photoLayerIdx>=dl.length){const _rs=photoBakedRef.current?bakedImageRef.current:refImageEl.current;if(_rs){ctx.globalAlpha=refOverlayOpacity/100;ctx.drawImage(_rs,0,0,CW,CH);ctx.globalAlpha=1}}
    if(showGrid){
      ctx.globalAlpha=gridOpacity/100;ctx.strokeStyle='#3366ff';ctx.setLineDash([])
      if(gridSize<0){
        // 分割モード: gridSize=-2/-3/-4
        const n=-gridSize
        ctx.lineWidth=1.5
        for(let i=1;i<n;i++){
          const x=CW*i/n
          ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke()
        }
        for(let i=1;i<n;i++){
          const y=CH*i/n
          ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke()
        }
      } else {
        ctx.lineWidth=1
        for(let x=0;x<=CW;x+=gridSize){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke()}
        for(let y=0;y<=CH;y+=gridSize){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke()}
      }
      ctx.globalAlpha=1
    }
    const sel=selRef.current,xform=xfRef.current
    if(xform&&xform.panel==='right'){
      const {rect,angle,content,origRect:or}=xform,mcx=rect.x+rect.w/2,mcy=rect.y+rect.h/2
      ctx.save();ctx.translate(mcx,mcy);ctx.rotate(angle)
      ctx.drawImage(content,(or||rect).x,(or||rect).y,(or||rect).w,(or||rect).h,-rect.w/2,-rect.h/2,rect.w,rect.h)
      ctx.restore()
    } else if(S.current.selPanel==='right'&&sel){drawSelPath(ctx,sel)}
  },[])

  const leftComposite = useCallback(()=>{
    const disp=photoDispRef.current;if(!disp)return
    const ctx=disp.getContext('2d');ctx.clearRect(0,0,CW,CH)
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,CW,CH)
    const {practiceMode,practiceStyle,practiceObject,refOpacity}=S.current
    if(practiceMode&&threeRef.current?.rendered){
      // Three.js WebGL render → 2D canvas
      ctx.drawImage(threeRef.current.renderer.domElement,0,0,CW,CH)
    } else {
      if(practiceMode){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,CW,CH)}
      if(refImageEl.current&&!photoBakedRef.current){
        ctx.globalAlpha=refOpacity/100
        const img=refImageEl.current
        const pAR=img.naturalWidth/img.naturalHeight,cAR=CW/CH
        let dw,dh,dx=0,dy=0
        if(pAR>cAR){dw=CW;dh=CW/pAR;dy=(CH-dh)/2}
        else{dh=CH;dw=CH*pAR;dx=CW-dw}
        ctx.drawImage(img,dx,dy,dw,dh)
        ctx.globalAlpha=1
      }
      if(practiceMode&&practiceObject){
        drawCompound(ctx,practiceObject,CW/2,CH*.50,Math.min(CW,CH)*.45,practiceStyle)
      }
    }
    if(!S.current.practiceMode){
      if(photoBakedRef.current&&bakedImageRef.current){
        ctx.globalAlpha=S.current.refOpacity/100
        ctx.drawImage(bakedImageRef.current,0,0)
        ctx.globalAlpha=1
      }
      if(photoCanvas.current){ctx.drawImage(photoCanvas.current,0,0)}
    }
    const {showGrid,gridSize,gridOpacity}=S.current
    if(showGrid){
      ctx.globalAlpha=gridOpacity/100;ctx.strokeStyle='#3366ff';ctx.setLineDash([])
      if(gridSize<0){
        const n=-gridSize;ctx.lineWidth=1.5
        for(let i=1;i<n;i++){const x=CW*i/n;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke()}
        for(let i=1;i<n;i++){const y=CH*i/n;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke()}
      } else {
        ctx.lineWidth=1
        for(let x=0;x<=CW;x+=gridSize){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke()}
        for(let y=0;y<=CH;y+=gridSize){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke()}
      }
      ctx.globalAlpha=1
    }
    ctx.save();ctx.globalAlpha=.18;ctx.strokeStyle='#888';ctx.lineWidth=1;ctx.setLineDash([])
    ctx.beginPath();ctx.moveTo(CW/2,0);ctx.lineTo(CW/2,CH);ctx.stroke()
    ctx.beginPath();ctx.moveTo(0,CH/2);ctx.lineTo(CW,CH/2);ctx.stroke();ctx.restore()
    const sel=selRef.current,xform=xfRef.current
    if(xform&&xform.panel==='left'){
      const {rect,angle,content,origRect:or}=xform,mcx=rect.x+rect.w/2,mcy=rect.y+rect.h/2
      ctx.save();ctx.translate(mcx,mcy);ctx.rotate(angle)
      ctx.drawImage(content,(or||rect).x,(or||rect).y,(or||rect).w,(or||rect).h,-rect.w/2,-rect.h/2,rect.w,rect.h)
      ctx.restore()
    } else if(S.current.selPanel==='left'&&sel){drawSelPath(ctx,sel)}
  },[])

  useEffect(()=>{rCompRef.current=rightComposite;lCompRef.current=leftComposite},[rightComposite,leftComposite])
  useEffect(()=>{rightComposite();leftComposite()},[rightComposite,leftComposite,rev])
  useEffect(()=>{rCompRef.current?.()},[photoLayerIdx])
  useEffect(()=>{rCompRef.current?.();lCompRef.current?.()},[showGrid,gridSize,gridOpacity])
  useEffect(()=>{rCompRef.current?.()},[refOpacity,refOverlay,refOverlayOpacity])
  useEffect(()=>{lCompRef.current?.()},[refOpacity])
  useEffect(()=>{lCompRef.current?.()},[practiceStyle,practiceMode,practiceObject])

  useEffect(()=>{
    const el=drawAreaRef.current;if(!el)return
    const onWheel=e=>{
      e.preventDefault()
      setViewZoom(z=>Math.round(Math.min(400,Math.max(20,z*Math.pow(0.999,e.deltaY)))))
    }
    el.addEventListener('wheel',onWheel,{passive:false})
    return()=>el.removeEventListener('wheel',onWheel)
  },[])

  // ── Fit mode: measure canvas-area and compute exact display dims ──
  const calcFitDims = useCallback(()=>{
    const el=canvasAreaRef.current; if(!el||!refImageSize){setFitDims(null);return}
    const aw=el.offsetWidth, ah=el.offsetHeight
    if(!aw||!ah){setFitDims(null);return}
    const pAR=refImageSize.w/refImageSize.h
    const sr=S.current.splitRatio
    const pw=aw*sr/(100-sr)
    const cAR=CW/CH
    let cw,ch
    if(pw/ah>cAR){ch=ah;cw=ah*cAR}else{cw=pw;ch=pw/cAR}
    // fw×fh = photo image display size (container / clip rect)
    // cw×ch = full canvas display size (4:3, no distortion)
    let fw,fh,ftop
    if(pAR<cAR){fh=ch;fw=ch*pAR;ftop=(ah-ch)/2}
    else{fw=cw;fh=cw/pAR;ftop=(ah-fh)/2}
    setFitDims({w:Math.round(fw),h:Math.round(fh),cw:Math.round(cw),ch:Math.round(ch),top:Math.round(ftop)})
  },[refImageSize])

  useEffect(()=>{
    calcFitDims()
    const el=canvasAreaRef.current; if(!el)return
    const ro=new ResizeObserver(calcFitDims)
    ro.observe(el)
    return ()=>ro.disconnect()
  },[calcFitDims])

  useEffect(()=>{ calcFitDims() },[splitRatio, calcFitDims])

  // redraw after canvas remounts when fitDims changes
  useEffect(()=>{rCompRef.current?.();lCompRef.current?.()},[fitDims])

  // ── Three.js scene ────────────────────────────────────────────
  useEffect(()=>{
    if(!practiceMode||!practiceObject){
      if(threeRef.current) threeRef.current.rendered=false
      return
    }
    // Init renderer once
    if(!threeRef.current){
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
      renderer.setSize(CW,CH);renderer.setPixelRatio(1)
      renderer.shadowMap.enabled=true
      renderer.shadowMap.type=THREE.PCFSoftShadowMap
      threeRef.current={renderer,rendered:false}
    }
    const {renderer}=threeRef.current
    // Camera from orbit state
    const {rx=.3,ry=.2,rz=0,zoom=1}=practiceOrbit
    const dist=4.2/Math.max(.2,zoom)
    const camera=new THREE.PerspectiveCamera(38,CW/CH,.1,100)
    camera.position.set(dist*Math.sin(ry)*Math.cos(rx),dist*Math.sin(rx),dist*Math.cos(ry)*Math.cos(rx))
    camera.lookAt(0,0,0)
    // Scene
    const scene=new THREE.Scene()
    const isWire=practiceStyle==='wireframe'
    scene.background=new THREE.Color(isWire?0xffffff:0x878784)
    if(!isWire){
      scene.add(new THREE.AmbientLight(0xffffff,.48))
      const sun=new THREE.DirectionalLight(0xffffff,1.1)
      sun.position.set(3,6,2);sun.castShadow=true
      sun.shadow.mapSize.set(1024,1024)
      sun.shadow.camera.left=-3.5;sun.shadow.camera.right=3.5
      sun.shadow.camera.top=3.5;sun.shadow.camera.bottom=-3.5
      sun.shadow.camera.near=.5;sun.shadow.camera.far=18
      sun.shadow.camera.updateProjectionMatrix()
      scene.add(sun)
      const fill=new THREE.DirectionalLight(0xccd8f0,.32)
      fill.position.set(-2,3,-1);scene.add(fill)
      const gnd=new THREE.Mesh(new THREE.PlaneGeometry(14,14),new THREE.ShadowMaterial({opacity:.2}))
      gnd.rotation.x=-Math.PI/2;gnd.position.y=-1.38;gnd.receiveShadow=true;scene.add(gnd)
    }
    // Object
    const mat=buildThreeMat(practiceStyle)
    const obj3d=buildThreeObj(practiceObject.type,mat,practiceStyle)
    if(obj3d){
      obj3d.rotation.z=rz
      if(!isWire)obj3d.traverse(o=>{if(o.isMesh)o.castShadow=true})
      scene.add(obj3d)
    }
    renderer.render(scene,camera)
    threeRef.current.rendered=true
    lCompRef.current?.();tick()
    return()=>{
      scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}})
    }
  },[practiceObject,practiceStyle,practiceMode,practiceOrbit])

  useEffect(()=>{
    if(!practiceMode&&threeRef.current){
      threeRef.current.renderer.dispose();threeRef.current=null;lCompRef.current?.()
    }
  },[practiceMode])

  const tick=useCallback(()=>setRev(r=>r+1),[])

  const startToolDrag=useCallback((toolId,e,initialPos)=>{
    const startMX=e.clientX,startMY=e.clientY
    let latest=null
    const move=me=>{
      const nx=initialPos.x+(me.clientX-startMX),ny=initialPos.y+(me.clientY-startMY)
      setToolPositions(prev=>{latest={...prev,[toolId]:{x:nx,y:ny}};return latest})
    }
    const up=()=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)
      if(latest)localStorage.setItem('tool-positions',JSON.stringify(latest))
    }
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  },[])

  const makeToolButton=useCallback(id=>{
    switch(id){
      case'pen':return<TB label="ペン" active={activeTool===TOOLS.PEN} onClick={()=>setActiveTool(TOOLS.PEN)}><PenIcon/></TB>
      case'eraser':return<TB label="消しゴム" active={activeTool===TOOLS.ERASER} onClick={()=>setActiveTool(TOOLS.ERASER)}><EraserIcon/></TB>
      case'select':return<TB label="選択範囲" active={activeTool===TOOLS.SELECT} onClick={()=>setActiveTool(TOOLS.SELECT)}><SelectIcon/></TB>
      case'move':return<TB label="レイヤー移動" active={activeTool===TOOLS.MOVE} onClick={()=>setActiveTool(TOOLS.MOVE)}><MoveIcon/></TB>
      case'line':return<TB label="直線" active={activeTool===TOOLS.LINE} onClick={()=>setActiveTool(TOOLS.LINE)}><LineIcon/></TB>
      case'ruler':return<TB label="定規" active={showRuler} onClick={()=>{if(showRuler){setShowRuler(false);setRulers([]);setActiveRulerId(null)}else{setShowRuler(true);setActiveTool(TOOLS.RULER)}}}><RulerIcon/></TB>
      case'grid':return<TB label="マス目" active={showGrid} onClick={()=>setShowGrid(v=>!v)}><GridIcon/></TB>
      case'hand':return<TB label="手のひら移動 (H)" active={activeTool===TOOLS.HAND} onClick={()=>setActiveTool(TOOLS.HAND)}><HandIcon/></TB>
      default:return null
    }
  },[activeTool,showRuler,showGrid])

  const getPR=panel=>({
    disp:panel==='left'
      ?(S.current.practiceMode&&S.current.practiceDrawMode?practiceOverlayRef.current:photoDispRef.current)
      :displayRef.current,
    draw:panel==='left'
      ?(S.current.practiceMode?practiceOverlayRef.current:photoCanvas.current)
      :(S.current.activeLayerId==='photo'?photoCanvas.current:layerCanvases.current[S.current.activeLayerId]),
    comp:()=>panel==='left'?lCompRef.current():rCompRef.current(),
  })
  const toPt=(e,disp)=>{if(!disp)return{x:0,y:0};const r=disp.getBoundingClientRect();return{x:(e.clientX-r.left)*(CW/r.width),y:(e.clientY-r.top)*(CH/r.height)}}

  // ── Handlers ──────────────────────────────────────────────────
  const makeHandlers=panel=>{
    const onPointerDown=e=>{
      if(S.current.activeTool===TOOLS.HAND){
        e.preventDefault()
        panStartRef.current={px:e.clientX,py:e.clientY,ox:panOffsetRef.current.x,oy:panOffsetRef.current.y}
        const onMove=ev=>{
          if(!panStartRef.current)return
          const nx=panStartRef.current.ox+(ev.clientX-panStartRef.current.px)
          const ny=panStartRef.current.oy+(ev.clientY-panStartRef.current.py)
          panOffsetRef.current={x:nx,y:ny};setPanOffset({x:nx,y:ny})
        }
        const onUp=()=>{
          panStartRef.current=null
          window.removeEventListener('pointermove',onMove)
          window.removeEventListener('pointerup',onUp)
          window.removeEventListener('pointercancel',onUp)
        }
        window.addEventListener('pointermove',onMove)
        window.addEventListener('pointerup',onUp)
        window.addEventListener('pointercancel',onUp)
        return
      }
      if(xfRef.current)return;e.preventDefault()
      // Auto-bake photo into bakedImageRef on first interaction with the photo panel
      if(panel==='left'&&!S.current.practiceMode&&!photoBakedRef.current&&refImageEl.current){
        const img=refImageEl.current
        const pAR=img.naturalWidth/img.naturalHeight,cAR=CW/CH
        let dw,dh,dx=0,dy=0
        if(pAR>cAR){dw=CW;dh=CW/pAR;dy=(CH-dh)/2}else{dh=CH;dw=CH*pAR;dx=CW-dw}
        if(!bakedImageRef.current){const c=document.createElement('canvas');c.width=CW;c.height=CH;bakedImageRef.current=c}
        const bctx=bakedImageRef.current.getContext('2d');bctx.clearRect(0,0,CW,CH);bctx.drawImage(img,dx,dy,dw,dh)
        photoBakedRef.current=true
        lCompRef.current?.()
      }
      const {disp,draw,comp}=getPR(panel),pt=toPt(e,disp)
      const {activeTool,penColor,penSize,eraserSize}=S.current
      const activeSize=activeTool===TOOLS.ERASER?eraserSize:penSize
      disp?.setPointerCapture(e.pointerId)
      if(activeTool===TOOLS.RULER){
        isDrawing.current=true
        const nid=Date.now()
        const{rulerType:rt,rulerDivisions:rd,penColor:pc}=S.current
        setRulers(rs=>[...rs,{id:nid,x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y,type:rt,divisions:rd,color:pc}])
        setActiveRulerId(nid);placingRulerIdRef.current=nid
        return
      }
      if(activeTool===TOOLS.SELECT){
        const sel=selRef.current
        if(S.current.selPanel===panel&&sel&&inRect(pt,sel)){
          isDrawing.current=true;selMoveStart.current=pt;selMoveOrigR.current={...sel}
          if(draw){const snap=document.createElement('canvas');snap.width=CW;snap.height=CH;snap.getContext('2d').drawImage(draw,0,0);selMoveSnap.current=snap;const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,sel);ctx.clearRect(0,0,CW,CH);ctx.restore();comp()}
        } else {isDrawing.current=true;selPtsRef.current=[pt];setSel(null);setSelPanel(null);comp()}
        return
      }
      isDrawing.current=true;lastPt.current=pt
      if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){
        const ctx=draw?.getContext('2d');if(!ctx)return
        if(S.current.practiceMode&&S.current.practiceDrawMode){saveHist('left');saveHist('right')}else saveHist(panel)
        penStrokeStart.current=pt
        lastPt.current=pt
        lastClientXY.current={x:e.clientX,y:e.clientY}
        const pr=e.pointerType==='pen'?Math.max(0.05,e.pressure):1
        const sz=Math.max(1,activeSize*pr)
        ctx.globalCompositeOperation=activeTool===TOOLS.ERASER?'destination-out':'source-over'
        ctx.fillStyle=activeTool===TOOLS.ERASER?'rgba(0,0,0,1)':penColor
        ctx.beginPath();ctx.arc(spt.x,spt.y,sz/2,0,Math.PI*2);ctx.fill()
        comp();tick()
      } else if(activeTool===TOOLS.LINE){
        const {showGrid:sg,gridSize:gs}=S.current
        const spt=e.shiftKey&&sg?applySnap(pt,{gridSnap:true,gridSize:gs}):pt
        lineStart.current=spt;lineStartScreen.current={x:e.clientX,y:e.clientY}
        saveHist('left');saveHist('right')
      }
      else if(activeTool===TOOLS.MOVE){
        moveOrigin.current=pt;saveHist(panel)
        if(draw){const s=document.createElement('canvas');s.width=CW;s.height=CH;s.getContext('2d').drawImage(draw,0,0);moveSnap.current=s}
      }
    }

    const onPointerMove=e=>{
      if(!isDrawing.current)return
      const {disp,draw,comp}=getPR(panel),pt=toPt(e,disp)
      const {activeTool,penColor,penSize,eraserSize}=S.current
      const activeSize=activeTool===TOOLS.ERASER?eraserSize:penSize
      if(activeTool===TOOLS.RULER){
        const pid=placingRulerIdRef.current;if(!pid)return
        setRulers(rs=>rs.map(r=>r.id===pid?{...r,x2:pt.x,y2:pt.y}:r))
        return
      }
      if(activeTool===TOOLS.SELECT){
        if(selMoveStart.current&&selMoveSnap.current){
          const dx=pt.x-selMoveStart.current.x,dy=pt.y-selMoveStart.current.y
          const orig=selMoveOrigR.current;if(!draw)return
          const ctx=draw.getContext('2d')
          ctx.clearRect(0,0,CW,CH);ctx.drawImage(selMoveSnap.current,0,0)
          ctx.save();applySelClip(ctx,orig);ctx.clearRect(0,0,CW,CH);ctx.restore()
          ctx.save()
          if(orig.pts){ctx.beginPath();orig.pts.forEach((p,i)=>i===0?ctx.moveTo(p.x+dx,p.y+dy):ctx.lineTo(p.x+dx,p.y+dy));ctx.closePath();ctx.clip()}
          else{ctx.beginPath();ctx.rect(orig.x+dx,orig.y+dy,orig.w,orig.h);ctx.clip()}
          ctx.drawImage(selMoveSnap.current,dx,dy);ctx.restore()
          const ns=orig.pts?{...orig,x:orig.x+dx,y:orig.y+dy,pts:orig.pts.map(p=>({x:p.x+dx,y:p.y+dy}))}:{...orig,x:orig.x+dx,y:orig.y+dy}
          setSel(ns);comp();return
        }
        if(selPtsRef.current.length>0){
          selPtsRef.current=[...selPtsRef.current,pt]
          const pts=selPtsRef.current,xs=pts.map(p=>p.x),ys=pts.map(p=>p.y)
          const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y
          setSel({pts,x,y,w,h});setSelPanel(panel);comp()
        }
        return
      }
      if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){
        if(S.current.practiceMode&&S.current.practiceDrawMode&&lastClientXY.current){
          const ls=lastClientXY.current,cs={x:e.clientX,y:e.clientY}
          const _dtc=(dispEl,drawEl)=>{
            if(!dispEl||!drawEl)return
            const r=dispEl.getBoundingClientRect()
            const seg=clipLineToBBox(ls.x,ls.y,cs.x,cs.y,r.left,r.top,r.right,r.bottom)
            if(!seg)return
            const p1=screenToCv(seg[0],seg[1],r),p2=screenToCv(seg[2],seg[3],r)
            const dctx=drawEl.getContext('2d')
            dctx.globalCompositeOperation=activeTool===TOOLS.ERASER?'destination-out':'source-over'
            dctx.strokeStyle=activeTool===TOOLS.ERASER?'rgba(0,0,0,1)':penColor
            dctx.lineWidth=activeSize;dctx.lineCap='round';dctx.lineJoin='round'
            dctx.beginPath();dctx.moveTo(p1.x,p1.y);dctx.lineTo(p2.x,p2.y);dctx.stroke()
          }
          _dtc(photoDispRef.current,getPR('left').draw)
          _dtc(displayRef.current,getPR('right').draw)
          lastClientXY.current=cs
          lCompRef.current?.();rCompRef.current?.();tick()
        } else {
          const ctx=draw?.getContext('2d');if(!ctx)return
          const pr=e.pointerType==='pen'?Math.max(0.05,e.pressure):1
          const sz=Math.max(1,activeSize*pr)
          ctx.globalCompositeOperation=activeTool===TOOLS.ERASER?'destination-out':'source-over'
          ctx.strokeStyle=activeTool===TOOLS.ERASER?'rgba(0,0,0,1)':penColor
          ctx.lineWidth=sz;ctx.lineCap='round';ctx.lineJoin='round'
          const spt=e.shiftKey&&activeTool===TOOLS.PEN&&penStrokeStart.current
            ?applySnap(pt,{hvFrom:penStrokeStart.current})
            :pt
          ctx.beginPath();ctx.moveTo(lastPt.current.x,lastPt.current.y);ctx.lineTo(spt.x,spt.y);ctx.stroke()
          lastPt.current=spt;comp();tick()
        }
      } else if(activeTool===TOOLS.LINE&&lineStart.current&&lineStartScreen.current){
        let ex=e.clientX,ey=e.clientY
        const sx=lineStartScreen.current.x,sy=lineStartScreen.current.y
        if(e.shiftKey){const a=Math.round(Math.atan2(ey-sy,ex-sx)/(Math.PI/2))*(Math.PI/2);const l=Math.sqrt((ex-sx)**2+(ey-sy)**2);ex=sx+Math.cos(a)*l;ey=sy+Math.sin(a)*l}
        lCompRef.current?.();rCompRef.current?.()
        const _dp=c=>{if(!c)return;const r=c.getBoundingClientRect();const seg=clipLineToBBox(sx,sy,ex,ey,r.left,r.top,r.right,r.bottom);if(!seg)return;const p1=screenToCv(seg[0],seg[1],r),p2=screenToCv(seg[2],seg[3],r);const ctx=c.getContext('2d');ctx.strokeStyle=penColor;ctx.lineWidth=penSize;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()}
        _dp(displayRef.current);_dp(photoDispRef.current)
      } else if(activeTool===TOOLS.MOVE&&moveOrigin.current&&moveSnap.current){
        const ctx=draw?.getContext('2d');if(!ctx)return
        let ox=pt.x-moveOrigin.current.x,oy=pt.y-moveOrigin.current.y
        if(e.shiftKey){
          const {showGrid:sg,gridSize:gs}=S.current
          if(Math.abs(pt.x-moveOrigin.current.x)>=Math.abs(pt.y-moveOrigin.current.y)){oy=0;if(sg)ox=Math.round(ox/gs)*gs}
          else{ox=0;if(sg)oy=Math.round(oy/gs)*gs}
        }
        ctx.clearRect(0,0,CW,CH);ctx.drawImage(moveSnap.current,ox,oy)
        comp();tick()
      }
    }

    const onPointerUp=e=>{
      if(!isDrawing.current)return;isDrawing.current=false
      const {disp,draw,comp}=getPR(panel),pt=toPt(e,disp)
      const {activeTool,penColor,penSize}=S.current
      if(activeTool===TOOLS.RULER){isDrawing.current=false;placingRulerIdRef.current=null;return}
      if(activeTool===TOOLS.SELECT){
        if(selMoveStart.current){selMoveStart.current=null;selMoveSnap.current=null;selMoveOrigR.current=null;comp();tick()}
        else if(selPtsRef.current.length>1){
          const pts=[...selPtsRef.current,selPtsRef.current[0]]
          const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y)
          const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y
          setSel({pts,x,y,w,h});setSelPanel(panel);comp();selPtsRef.current=[]
        }
        return
      }
      if(activeTool===TOOLS.LINE&&lineStart.current&&lineStartScreen.current){
        const {penColor:pc,penSize:ps}=S.current
        const ex0=e.clientX,ey0=e.clientY
        const sx=lineStartScreen.current.x,sy=lineStartScreen.current.y
        const isTap=Math.sqrt((ex0-sx)**2+(ey0-sy)**2)<5
        lineStart.current=null;lineStartScreen.current=null
        if(isTap){
          const ctx=draw?.getContext('2d')
          if(ctx){ctx.globalCompositeOperation='source-over';ctx.strokeStyle=pc;ctx.lineWidth=ps;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,pt.y);ctx.lineTo(CW,pt.y);ctx.stroke()}
          comp();tick()
        } else {
          let ex=ex0,ey=ey0
          if(e.shiftKey){const a=Math.round(Math.atan2(ey-sy,ex-sx)/(Math.PI/2))*(Math.PI/2);const l=Math.sqrt((ex-sx)**2+(ey-sy)**2);ex=sx+Math.cos(a)*l;ey=sy+Math.sin(a)*l}
          const _ds=(dispEl,drawEl)=>{if(!dispEl||!drawEl)return;const r=dispEl.getBoundingClientRect();const seg=clipLineToBBox(sx,sy,ex,ey,r.left,r.top,r.right,r.bottom);if(!seg)return;const p1=screenToCv(seg[0],seg[1],r),p2=screenToCv(seg[2],seg[3],r);const ctx=drawEl.getContext('2d');ctx.globalCompositeOperation='source-over';ctx.strokeStyle=pc;ctx.lineWidth=ps;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()}
          const rdraw=S.current.activeLayerId==='photo'?photoCanvas.current:layerCanvases.current[S.current.activeLayerId]
          _ds(displayRef.current,rdraw)
          if(!S.current.practiceMode||S.current.practiceDrawMode){
            const ldraw=S.current.practiceMode?practiceOverlayRef.current:photoCanvas.current
            _ds(photoDispRef.current,ldraw)
          }
          lCompRef.current?.();rCompRef.current?.();tick()
        }
        saveHist('left');saveHist('right');return
      }
      if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){
        if(S.current.practiceMode&&S.current.practiceDrawMode){saveHist('left');saveHist('right')}else saveHist(panel)
      } else if(activeTool===TOOLS.MOVE){
        saveHist(panel)
      }
      lastClientXY.current=null
      const ctx2=draw?.getContext('2d');if(ctx2)ctx2.globalCompositeOperation='source-over'
      moveSnap.current=null;lastPt.current=null
    }
    return{onPointerDown,onPointerMove,onPointerUp,onPointerLeave:onPointerUp}
  }

  const leftH=makeHandlers('left'), rightH=makeHandlers('right')

  // ── Orbit handlers (practice mode left canvas) ────────────────
  const orbitH = {
    onPointerDown: e=>{
      e.preventDefault()
      const {rx,ry,rz,zoom}=practiceOrbit
      orbitDragStart.current={x:e.clientX,y:e.clientY,rx,ry,rz,zoom}
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: e=>{
      if(!orbitDragStart.current)return
      const dx=e.clientX-orbitDragStart.current.x
      const dy=e.clientY-orbitDragStart.current.y
      const s=orbitDragStart.current
      if(e.shiftKey){
        setPracticeOrbit(o=>({...o,rz:s.rz+dx*.013}))
      } else {
        setPracticeOrbit(o=>({...o,
          rx:Math.max(-Math.PI*.48,Math.min(Math.PI*.48,s.rx-dy*.013)),
          ry:s.ry+dx*.013
        }))
      }
    },
    onPointerUp:   ()=>{ orbitDragStart.current=null },
    onPointerLeave:()=>{ orbitDragStart.current=null },
    onWheel: e=>{
      e.preventDefault()
      setPracticeOrbit(o=>({...o,zoom:Math.max(.25,Math.min(4,o.zoom*(e.deltaY>0?.88:1.14)))}))
    }
  }

  // ── Split pane drag ───────────────────────────────────────────
  const onSplitDragStart = useCallback(e=>{
    e.preventDefault()
    const el=drawAreaRef.current; if(!el)return
    const rect=el.getBoundingClientRect()
    splitDragRef.current={originX:rect.left,areaW:rect.width}
    setSplitDragging(true)
    const onMove=ev=>{
      if(!splitDragRef.current)return
      const {originX,areaW}=splitDragRef.current
      setSplitRatio(Math.max(15,Math.min(85,Math.round((ev.clientX-originX)/areaW*100))))
    }
    const onUp=()=>{
      splitDragRef.current=null;setSplitDragging(false)
      document.removeEventListener('pointermove',onMove)
      document.removeEventListener('pointerup',onUp)
    }
    document.addEventListener('pointermove',onMove)
    document.addEventListener('pointerup',onUp)
  },[])

  // ── Selection helpers ─────────────────────────────────────────
  const applySelClip=(ctx,sel)=>{ctx.beginPath();if(sel.pts){sel.pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.closePath()}else{ctx.rect(sel.x,sel.y,sel.w,sel.h)};ctx.clip()}
  const deselect=()=>{
    const p=selPanel
    setSel(null);setSelPanel(null)
    if(p==='left')lCompRef.current?.()
    else if(p==='right')rCompRef.current?.()
  }
  const deleteInSel=()=>{
    if(!selRef.current||!selPanel)return;const{draw,comp}=getPR(selPanel);if(!draw)return
    saveHist(selPanel);const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,selRef.current);ctx.clearRect(0,0,CW,CH);ctx.restore();comp();tick()
  }
  const deleteOutSel=()=>{
    if(!selRef.current||!selPanel)return;const{draw,comp}=getPR(selPanel);if(!draw)return
    saveHist(selPanel);const ctx=draw.getContext('2d')
    const tmp=document.createElement('canvas');tmp.width=CW;tmp.height=CH;tmp.getContext('2d').drawImage(draw,0,0)
    ctx.clearRect(0,0,CW,CH);ctx.save();applySelClip(ctx,selRef.current);ctx.drawImage(tmp,0,0);ctx.restore();comp();tick()
  }
  const fillSel=()=>{
    if(!selRef.current||!selPanel)return;const{draw,comp}=getPR(selPanel);if(!draw)return
    saveHist(selPanel);const ctx=draw.getContext('2d')
    ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle=S.current.penColor
    applySelClip(ctx,selRef.current);ctx.fillRect(0,0,CW,CH);ctx.restore();comp();tick()
  }
  const startTransform=()=>{
    if(!selRef.current||!selPanel)return;const{draw,comp}=getPR(selPanel);if(!draw)return
    const r=selRef.current;const content=document.createElement('canvas');content.width=CW;content.height=CH
    content.getContext('2d').drawImage(draw,0,0)
    saveHist(selPanel);const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,r);ctx.clearRect(0,0,CW,CH);ctx.restore()
    setXfState({rect:{x:r.x,y:r.y,w:r.w,h:r.h},angle:0,content,panel:selPanel,origRect:{x:r.x,y:r.y,w:r.w,h:r.h},origSel:{...r}});comp()
  }
  const updateXf=useCallback(patch=>{setXfState(prev=>{const next={...prev,...patch};xfRef.current=next;setTimeout(()=>{if(next.panel==='left')lCompRef.current();else rCompRef.current()},0);return next})},[])
  const commitXf=()=>{
    if(!xfRef.current)return;const{rect,angle,content,panel}=xfRef.current;const{draw,comp}=getPR(panel)
    if(draw){
      const ctx=draw.getContext('2d'),mcx=rect.x+rect.w/2,mcy=rect.y+rect.h/2
      const or=xfRef.current.origRect||rect,os=xfRef.current.origSel
      ctx.save();ctx.translate(mcx,mcy);ctx.rotate(angle)
      if(os?.pts&&or){
        const ocx=or.x+or.w/2,ocy=or.y+or.h/2,sx=or.w?rect.w/or.w:1,sy=or.h?rect.h/or.h:1
        ctx.beginPath();os.pts.forEach((p,i)=>{const lx=(p.x-ocx)*sx,ly=(p.y-ocy)*sy;i===0?ctx.moveTo(lx,ly):ctx.lineTo(lx,ly)});ctx.closePath();ctx.clip()
      }
      ctx.drawImage(content,(or||rect).x,(or||rect).y,(or||rect).w,(or||rect).h,-rect.w/2,-rect.h/2,rect.w,rect.h)
      ctx.restore()
    }
    setXfState(null);setSel(null);setSelPanel(null);comp();tick()
  }
  const cancelXf=()=>{
    if(!xfRef.current)return;const{origRect,content,panel}=xfRef.current;const{draw,comp}=getPR(panel)
    if(draw)draw.getContext('2d').drawImage(content,origRect.x,origRect.y,origRect.w,origRect.h,origRect.x,origRect.y,origRect.w,origRect.h)
    setXfState(null);comp();tick()
  }

  // ── Undo / Redo ───────────────────────────────────────────────
  const getHistCanvas=key=>key==='photo'?photoCanvas.current:key==='practiceDraw'?practiceOverlayRef.current:layerCanvases.current[+key]
  const doUndo=()=>{
    const key=lastHistKey.current||String(activeLayerId)
    const _undoOne=k=>{const st=histStacks.current[k];if(!st)return;const p=histPtrs.current[k]??0;if(p<=0)return;histPtrs.current[k]=p-1;const c=getHistCanvas(k);if(c)c.getContext('2d').putImageData(st[p-1],0,0)}
    _undoOne(key)
    if(S.current.practiceMode){_undoOne(key==='practiceDraw'?String(S.current.activeLayerId):'practiceDraw')}
    rightComposite();leftComposite();tick()
  }
  const doRedo=()=>{
    const key=lastHistKey.current||String(activeLayerId)
    const _redoOne=k=>{const st=histStacks.current[k];if(!st)return;const p=histPtrs.current[k]??0;if(p>=st.length-1)return;histPtrs.current[k]=p+1;const c=getHistCanvas(k);if(c)c.getContext('2d').putImageData(st[p+1],0,0)}
    _redoOne(key)
    if(S.current.practiceMode){_redoOne(key==='practiceDraw'?String(S.current.activeLayerId):'practiceDraw')}
    rightComposite();leftComposite();tick()
  }
  doUndoRef.current=doUndo;doRedoRef.current=doRedo

  // Keep Tabmate refs in sync every render
  tabmateLearningRef.current = tabmateLearning
  tabmateMappingsRef.current = tabmateMappings
  tabmateActionsRef.current = {
    pen:    ()=>setActiveTool(TOOLS.PEN),
    eraser: ()=>setActiveTool(TOOLS.ERASER),
    select: ()=>setActiveTool(TOOLS.SELECT),
    move:   ()=>setActiveTool(TOOLS.MOVE),
    line:   ()=>setActiveTool(TOOLS.LINE),
    undo:   ()=>doUndoRef.current?.(),
    redo:   ()=>doRedoRef.current?.(),
    sizeUp: ()=>{const t=S.current.activeTool;if(t===TOOLS.ERASER)setEraserSize(v=>Math.min(200,v+5));else setPenSize(v=>Math.min(100,v+2))},
    sizeDn: ()=>{const t=S.current.activeTool;if(t===TOOLS.ERASER)setEraserSize(v=>Math.max(1,v-5));else setPenSize(v=>Math.max(1,v-1))},
    grid:   ()=>setShowGrid(v=>!v),
  }

  useEffect(()=>{
    const h=e=>{
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();doUndoRef.current();return}
      if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){e.preventDefault();doRedoRef.current();return}
      if(e.target.matches('input,textarea,select'))return
      // Shortcut capture mode
      if(scLearningRef.current){
        if(e.ctrlKey||e.metaKey||e.altKey)return
        e.preventDefault()
        const action=scLearningRef.current
        setShortcuts(prev=>{const nm={...prev,[action]:e.key};localStorage.setItem('key-shortcuts',JSON.stringify(nm));return nm})
        scLearningRef.current=null;setScLearning(null);return
      }
      if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return
      const {activeTool,hardMode}=S.current
      const sc=shortcutsRef.current,k=e.key
      if(k===sc.pen){setActiveTool(TOOLS.PEN)}
      else if(k===sc.eraser&&!hardMode){setActiveTool(TOOLS.ERASER)}
      else if(k===sc.select&&!hardMode){setActiveTool(TOOLS.SELECT)}
      else if(k===sc.move&&!hardMode){setActiveTool(TOOLS.MOVE)}
      else if(k===sc.line&&!hardMode){setActiveTool(TOOLS.LINE)}
      else if(k===sc.hand){setActiveTool(TOOLS.HAND)}
      else if(k===sc.ruler&&!hardMode){
        if(activeTool===TOOLS.RULER){setShowRuler(false);setRulers([]);setActiveRulerId(null)}
        else{setShowRuler(true);setActiveTool(TOOLS.RULER)}
      }
      else if(k===sc.grid){setShowGrid(v=>!v)}
      else if(k===sc.sizeUp){
        if(activeTool===TOOLS.ERASER)setEraserSize(v=>Math.min(200,v+5))
        else setPenSize(v=>Math.min(100,v+1))
      }
      else if(k===sc.sizeDn){
        if(activeTool===TOOLS.ERASER)setEraserSize(v=>Math.max(1,v-5))
        else setPenSize(v=>Math.max(1,v-1))
      }
    }
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)
  },[])

  // ── Tabmate WebHID ────────────────────────────────────────────
  const handleTabmateReport = useCallback(e=>{
    const data = Array.from(new Uint8Array(e.data.buffer))
    const rid  = e.reportId
    const prev = tabmateLastReport.current
    const changes = prev
      ? data.reduce((acc,v,i)=>{ if(v!==prev[i]&&v!==0) acc.push({i,v}); return acc },[])
      : []
    tabmateLastReport.current = data
    if(!changes.length) return
    if(tabmateLearningRef.current){
      const {i,v} = changes[0]
      const key = `${rid}:${i}:${v}`
      const nm = {...tabmateMappingsRef.current, [key]: tabmateLearningRef.current}
      tabmateMappingsRef.current = nm
      setTabmateMappings(nm)
      localStorage.setItem('tabmate-mappings', JSON.stringify(nm))
      tabmateLearningRef.current = null
      setTabmateLearning(null)
      return
    }
    for(const {i,v} of changes){
      const action = tabmateMappingsRef.current[`${rid}:${i}:${v}`]
      if(action) tabmateActionsRef.current[action]?.()
    }
  },[])

  const connectTabmate = useCallback(async()=>{
    if(!navigator.hid){ alert('WebHIDはChrome / Edgeのみ対応しています'); return }
    try{
      const [device] = await navigator.hid.requestDevice({filters:[]})
      if(!device) return
      await device.open()
      device.addEventListener('inputreport', handleTabmateReport)
      tabmateDeviceRef.current = device
      tabmateLastReport.current = null
      setTabmateConnected(true)
    } catch(err){ if(err.name!=='SecurityError') console.error(err) }
  },[handleTabmateReport])

  const disconnectTabmate = useCallback(async()=>{
    const dev = tabmateDeviceRef.current; if(!dev) return
    dev.removeEventListener('inputreport', handleTabmateReport)
    try{ if(dev.opened) await dev.close() } catch{}
    tabmateDeviceRef.current = null
    setTabmateConnected(false)
  },[handleTabmateReport])

  useEffect(()=>()=>{ disconnectTabmate() },[disconnectTabmate])

  // ── URL / file ────────────────────────────────────────────────
  const IMAGE_EXTS=/\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?.*)?$/i
  const loadFromUrl=useCallback(url=>{
    const t=url.trim();if(!t)return
    if(t.startsWith('http')&&!IMAGE_EXTS.test(t)){setUrlError('notimg');return}
    const img=new Image();img.crossOrigin='anonymous'
    img.onload=()=>{setRefImage(t);setUrlInput('');setUrlError('')}
    img.onerror=()=>{const p=new Image();p.onload=()=>setUrlError('cors');p.onerror=()=>setUrlError('fail');p.src=t+(t.includes('?')?'&':'?')+'_t='+Date.now()}
    img.src=t
  },[])
  const onFileInput=e=>{const file=e.target.files?.[0];if(file?.type.startsWith('image/'))setRefImage(URL.createObjectURL(file));e.target.value=''}
  const onRefDrop=useCallback(e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file?.type.startsWith('image/')){setRefImage(URL.createObjectURL(file));return};const text=e.dataTransfer.getData('text/plain')||e.dataTransfer.getData('text/uri-list');if(text){setUrlInput(text.trim());loadFromUrl(text.trim())}},[loadFromUrl])
  const onUrlPaste=useCallback(e=>{const text=e.clipboardData.getData('text/plain');if(text&&(text.startsWith('http')||text.startsWith('data:'))){e.preventDefault();setUrlInput(text.trim());loadFromUrl(text.trim())}},[loadFromUrl])
  const URL_ERR={cors:'CORSエラー：このサイトは外部読み込みをブロックしています。\n画像を保存してドロップしてください。',notimg:'ページのURLではなく画像ファイルのURL（.jpg/.png等）を入力してください。',fail:'URLから画像を読み込めませんでした。'}

  // ── グローバルペースト（Ctrl+V で画像・URL を読み込む）──────────
  useEffect(()=>{
    const onPaste=e=>{
      const items=[...(e.clipboardData?.items||[])]
      // 1. 画像データを優先
      const imgItem=items.find(it=>it.type.startsWith('image/'))
      if(imgItem){
        e.preventDefault()
        const file=imgItem.getAsFile();if(file)setRefImage(URL.createObjectURL(file))
        return
      }
      // 2. テキスト URL（入力欄フォーカス中はスキップ）
      const tag=document.activeElement?.tagName
      if(tag==='INPUT'||tag==='TEXTAREA') return
      const txtItem=items.find(it=>it.type==='text/plain')
      if(txtItem){
        txtItem.getAsString(text=>{
          const t=text.trim()
          if(t.startsWith('http')||t.startsWith('data:')) loadFromUrl(t)
        })
      }
    }
    document.addEventListener('paste',onPaste)
    return ()=>document.removeEventListener('paste',onPaste)
  },[loadFromUrl])

  const deletePhoto=()=>{
    setRefImage(null);setRefOverlay(false)
    photoBakedRef.current=false
    const ctx=photoCanvas.current?.getContext('2d');if(ctx)ctx.clearRect(0,0,CW,CH)
    if(S.current.activeLayerId==='photo')setActiveLayerId(drawingLayers[drawingLayers.length-1]?.id??1)
    lCompRef.current?.()
  }

  // ── Layer ops ─────────────────────────────────────────────────
  const addLayer=useCallback(()=>{
    const id=layerCounter++
    setLayers(p=>{const paper=p.find(l=>l.isPaper);const rest=p.filter(l=>!l.isPaper);return[...(paper?[paper]:[]),...rest,mkLayer(id,`レイヤー ${id}`)]})
    setActiveLayerId(id)
  },[])
  const deleteLayer=useCallback(()=>{
    setLayers(p=>{
      const dl=p.filter(l=>!l.isPaper);if(dl.length<=1)return p
      const paper=p.find(l=>l.isPaper),i=dl.findIndex(l=>l.id===activeLayerId)
      const rest=dl.filter(l=>l.id!==activeLayerId)
      setActiveLayerId(rest[Math.max(0,i-1)]?.id??rest[0]?.id)
      return[...(paper?[paper]:[]),...rest]
    })
  },[activeLayerId])
  const updLayer=useCallback((id,patch)=>setLayers(p=>p.map(l=>l.id===id?{...l,...patch}:l)),[])
  const clearActive=useCallback(()=>{
    const lc=layerCanvases.current[activeLayerId];if(!lc)return
    const ctx=lc.getContext('2d'),isPaper=layers.find(l=>l.id===activeLayerId)?.isPaper
    saveHist('right')
    if(isPaper){ctx.fillStyle='#fff';ctx.fillRect(0,0,CW,CH)}else{ctx.clearRect(0,0,CW,CH)}
    rightComposite();tick()
  },[activeLayerId,layers,rightComposite,tick,saveHist])
  const flatten=useCallback(()=>{
    const m=document.createElement('canvas');m.width=CW;m.height=CH;const ctx=m.getContext('2d')
    layers.filter(l=>!l.isPaper).forEach(l=>{if(!l.visible)return;const lc=layerCanvases.current[l.id];if(!lc)return;ctx.globalAlpha=l.opacity/100;ctx.drawImage(lc,0,0)});ctx.globalAlpha=1
    const nid=layerCounter++;layerCanvases.current={[PAPER_ID]:layerCanvases.current[PAPER_ID],[nid]:m}
    setLayers([mkPaper(),mkLayer(nid,'結合')]);setActiveLayerId(nid)
  },[layers])

  // ── Layer drag-to-reorder ─────────────────────────────────────
  const onLayerPointerDown = useCallback((listIdx, e)=>{
    if(e.button!==undefined&&e.button!==0) return
    if(e.target.closest('.vis-btn')) return        // 表示切替ボタンは除外
    e.preventDefault()
    const startY = e.touches?e.touches[0].clientY:e.clientY
    layerDragRef.current = {srcIdx:listIdx, dropIdx:listIdx, startY, moved:false}
    setLayerDragSrc(listIdx)
    setLayerDropIdx(listIdx)

    const getY = ev => ev.touches?ev.touches[0].clientY:ev.clientY

    const onMove = ev=>{
      const dy = getY(ev) - layerDragRef.current.startY
      if(Math.abs(dy)>4) layerDragRef.current.moved=true
      const listEl = layerListRef.current; if(!listEl) return
      const rows = [...listEl.querySelectorAll('.layer-row')]
      const paperIdx = rows.length-1           // 用紙は常に最下段・移動不可
      let di = paperIdx
      for(let i=0;i<paperIdx;i++){
        const r=rows[i].getBoundingClientRect()
        if(getY(ev)<r.top+r.height/2){di=i;break}
      }
      layerDragRef.current.dropIdx=di
      setLayerDropIdx(di)
    }

    const onEnd = ev=>{
      const {srcIdx,dropIdx:di,moved} = layerDragRef.current
      layerDragRef.current = {srcIdx:null,dropIdx:null,startY:0,moved:false}
      setLayerDragSrc(null); setLayerDropIdx(null)
      // クリック（移動なし）→ 対象レイヤーをアクティブに
      if(!moved){
        const item=listItemsRef.current[srcIdx]
        if(item?.type==='layer'&&!item.layer.isPaper) setActiveLayerId(item.layer.id)
        else if(item?.type==='photo') setActiveLayerId('photo')
      }
      // ドラッグ確定
      if(moved && srcIdx!==null && di!==null && srcIdx!==di){
        const items=[...listItemsRef.current]
        const [moved2]=items.splice(srcIdx,1)
        items.splice(di>srcIdx?di-1:di,0,moved2)
        // listItems（上から下）→ 描画順（下から上）に変換
        const newDrawing=[]; let newPhotoIdx=0
        for(let i=items.length-1;i>=0;i--){
          const it=items[i]
          if(it.type==='photo') newPhotoIdx=newDrawing.length
          else if(!it.layer.isPaper) newDrawing.push(it.layer)
        }
        setLayers(prev=>[prev.find(l=>l.isPaper),...newDrawing])
        setPhotoLayerIdx(newPhotoIdx)
        setTimeout(()=>rCompRef.current?.(),0)
      }
      document.removeEventListener('mousemove',onMove)
      document.removeEventListener('mouseup',onEnd)
      document.removeEventListener('touchmove',onMove)
      document.removeEventListener('touchend',onEnd)
    }

    document.addEventListener('mousemove',onMove)
    document.addEventListener('mouseup',onEnd)
    document.addEventListener('touchmove',onMove,{passive:false})
    document.addEventListener('touchend',onEnd)
  },[setActiveLayerId,setLayers,setPhotoLayerIdx])

  // ── Derived ───────────────────────────────────────────────────
  const drawingLayers=layers.filter(l=>!l.isPaper)
  const paperLayer=layers.find(l=>l.isPaper)
  const activeLayer=layers.find(l=>l.id===activeLayerId)
  const selCanvasEl=selPanel==='left'?photoDispRef.current:displayRef.current
  const xfCanvasEl=xf?.panel==='left'?photoDispRef.current:displayRef.current
  const cursor={[TOOLS.PEN]:'crosshair',[TOOLS.ERASER]:'cell',[TOOLS.MOVE]:'move',[TOOLS.SELECT]:'crosshair',[TOOLS.LINE]:'crosshair',[TOOLS.RULER]:'crosshair',[TOOLS.HAND]:panStartRef.current?'grabbing':'grab'}[activeTool]

  const buildListItems=()=>{
    const items=[],dlRev=[...drawingLayers].reverse()
    const photoPos=drawingLayers.length-photoLayerIdx
    dlRev.forEach((l,i)=>{if(i===photoPos)items.push({type:'photo'});items.push({type:'layer',layer:l})})
    if(photoPos>=dlRev.length)items.push({type:'photo'})
    if(paperLayer)items.push({type:'layer',layer:paperLayer})
    return items
  }
  const listItems=buildListItems()
  listItemsRef.current=listItems

  const startPractice=()=>{
    const obj=genCompound();practiceObjRef.current=obj;setPracticeObject({...obj});setPracticeMode(true)
    const phi=.18+obj.ep*.52, theta=obj.rot*8+obj.skX*3
    setPracticeOrbit({rx:phi,ry:theta,rz:0,zoom:1})
  }

  return (
    <div className={`app${leftHanded?' left-handed':''}`}>

      {showMenu&&(
        <div className="app-menu-overlay" onClick={()=>setShowMenu(false)}>
          <div className="app-menu" onClick={e=>e.stopPropagation()}>
            <div className="app-menu-title">メニュー</div>
            <button className="app-menu-item" onClick={()=>{setLeftHanded(v=>!v);setShowMenu(false)}}>
              {leftHanded?'右利きモード（通常）':'左利きモード（左右反転）'}
            </button>
            <button className="app-menu-item" onClick={()=>{setShowLayerPanel(v=>!v);setShowMenu(false)}}>
              {showLayerPanel?'レイヤーパネルを隠す':'レイヤーパネルを表示'}
            </button>
            <div className="app-menu-sep"/>
            <button className={`app-menu-item${hardMode?' app-menu-item--active':''}`}
              onClick={()=>{setHardMode(v=>!v);setShowMenu(false)}}>
              {hardMode?'▶ 高難易度モード　オン':'　高難易度モード（ペンのみ）'}
            </button>
            <div className="app-menu-sep"/>
            <button className="app-menu-item" onClick={()=>{setShowTabmatePanel(v=>!v);setShowMenu(false)}}>
              {tabmateConnected?'● ':'○ '}Tabmate設定
            </button>
            <button className="app-menu-item" onClick={()=>{setShowShortcutPanel(v=>!v);setShowMenu(false)}}>
              ⌨ ショートカット設定
            </button>
            <div className="app-menu-sep"/>
            <button className="app-menu-item" onClick={()=>{setEditToolLayout(true);setShowMenu(false)}}>
              🔧 ツール配置をカスタマイズ
            </button>
          </div>
        </div>
      )}

      {editToolLayout&&(
        <div className="tool-layout-bar">
          <span>ツール配置編集中 — ドラッグで移動、ダブルクリックでツールバーに戻す</span>
          <button className="tl-btn" onClick={()=>{setToolPositions({});localStorage.setItem('tool-positions','{}')}} title="全てツールバーに戻す">リセット</button>
          <button className="tl-btn tl-btn-done" onClick={()=>setEditToolLayout(false)}>完了</button>
        </div>
      )}

      {Object.entries(toolPositions).map(([id,pos])=>{
        if(id!=='pen'&&hardMode)return null
        return(
          <div key={id} style={{position:'fixed',left:pos.x,top:pos.y,zIndex:1100,
            cursor:editToolLayout?'move':'default',
            outline:editToolLayout?'2px dashed #6af':'none',
            outlineOffset:editToolLayout?'2px':'0',borderRadius:4}}
            onPointerDown={editToolLayout?e=>{e.preventDefault();startToolDrag(id,e,pos)}:undefined}
            onDoubleClick={editToolLayout?()=>setToolPositions(prev=>{const n={...prev};delete n[id];localStorage.setItem('tool-positions',JSON.stringify(n));return n}):undefined}>
            <div style={{position:'relative'}}>
              {makeToolButton(id)}
              {editToolLayout&&<div style={{position:'absolute',inset:0,cursor:'move'}}/>}
            </div>
          </div>
        )
      })}

      {showTabmatePanel&&(
        <div className="tabmate-overlay" onClick={()=>setShowTabmatePanel(false)}>
          <div className="tabmate-panel" onClick={e=>e.stopPropagation()}>
            <div className="tabmate-hdr">
              <span>Tabmate 設定</span>
              <button className="tabmate-close" onClick={()=>setShowTabmatePanel(false)}>✕</button>
            </div>
            <div className="tabmate-conn">
              {tabmateConnected?(
                <>
                  <span className="tabmate-dot"/>
                  <span>接続中：{tabmateDeviceRef.current?.productName||'デバイス'}</span>
                  <button className="tabmate-disc-btn" onClick={disconnectTabmate}>切断</button>
                </>
              ):(
                <button className="tabmate-connect-btn" onClick={connectTabmate}>デバイスを接続（WebHID）</button>
              )}
            </div>
            {tabmateConnected&&(
              <div className="tabmate-map-list">
                <p className="tabmate-hint">各アクションのボタンを押して割り当て。もう一度押すとキャンセル。</p>
                {[
                  {a:'pen',    l:'ペン'},
                  {a:'eraser', l:'消しゴム'},
                  {a:'select', l:'選択範囲'},
                  {a:'move',   l:'レイヤー移動'},
                  {a:'line',   l:'直線'},
                  {a:'undo',   l:'元に戻す'},
                  {a:'redo',   l:'やり直し'},
                  {a:'sizeUp', l:'サイズ大'},
                  {a:'sizeDn', l:'サイズ小'},
                  {a:'grid',   l:'マス目切替'},
                ].map(({a,l})=>{
                  const mapped=Object.entries(tabmateMappings).find(([,v])=>v===a)
                  const learning=tabmateLearning===a
                  return(
                    <div key={a} className="tabmate-row">
                      <span className="tabmate-action">{l}</span>
                      <button
                        className={`tabmate-learn-btn${learning?' learning':''}`}
                        onClick={()=>{
                          const next=learning?null:a
                          setTabmateLearning(next)
                          tabmateLearningRef.current=next
                        }}>
                        {learning?'ボタンを押して…':mapped?'設定済み':'未設定'}
                      </button>
                      {mapped&&!learning&&(
                        <button className="tabmate-clear-btn" title="削除" onClick={()=>{
                          const nm={...tabmateMappings};delete nm[mapped[0]]
                          setTabmateMappings(nm);tabmateMappingsRef.current=nm
                          localStorage.setItem('tabmate-mappings',JSON.stringify(nm))
                        }}>✕</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showShortcutPanel&&(
        <div className="tabmate-overlay" onClick={()=>{setShowShortcutPanel(false);setScLearning(null)}}>
          <div className="tabmate-panel" onClick={e=>e.stopPropagation()} style={{minWidth:340}}>
            <div className="tabmate-hdr">
              ショートカット設定
              <button className="tabmate-close" onClick={()=>{setShowShortcutPanel(false);setScLearning(null)}}>✕</button>
            </div>
            <div className="tabmate-map-list">
              <p className="tabmate-hint">「割り当て」を押してからキーを押すと変更できます。</p>
              {SHORTCUT_ACTIONS.map(({a,l})=>{
                const key=shortcuts[a]??DEFAULT_SHORTCUTS[a]
                const learning=scLearning===a
                return(
                  <div key={a} className="tabmate-row">
                    <span className="tabmate-action">{l}</span>
                    <span className="sc-key">{key}</span>
                    <button className={`tabmate-learn-btn${learning?' learning':''}`}
                      onClick={()=>{const next=learning?null:a;setScLearning(next);scLearningRef.current=next}}>
                      {learning?'キーを押して…':'割り当て'}
                    </button>
                    <button className="tabmate-clear-btn" title="デフォルトに戻す" onClick={()=>{
                      const nm={...shortcuts};delete nm[a]
                      const merged={...DEFAULT_SHORTCUTS,...nm}
                      setShortcuts(merged);localStorage.setItem('key-shortcuts',JSON.stringify(nm))
                    }}>↩</button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <SelectionStrip sel={_selRect} canvasEl={selCanvasEl} onDeselect={deselect}
        onDelete={deleteInSel} onDeleteOut={deleteOutSel} onFill={fillSel} onTransform={startTransform}/>
      {xf&&<TransformOverlay xf={xf} canvasEl={xfCanvasEl} onUpdate={updateXf} onCommit={commitXf} onCancel={cancelXf}/>}

      <header className="toolbar">
        <button className="menu-btn" onClick={()=>setShowMenu(v=>!v)} title="メニュー"><MenuIcon/></button>
        <div className="tb-spacer"/>
        {refImage&&!practiceMode&&(
          <div className="panel-switch-group">
            <button className={`panel-sw-btn${activeLayerId==='photo'?' psw-active':''}`}
              onClick={()=>setActiveLayerId('photo')} title="写真レイヤーを編集">写真</button>
            <button className={`panel-sw-btn${activeLayerId!=='photo'?' psw-active':''}`}
              onClick={()=>setActiveLayerId(drawingLayers[drawingLayers.length-1]?.id??1)} title="描画レイヤーを編集">描画</button>
          </div>
        )}
        <div className="toolbar-right">
          <div className="toolbar-tools">
            {TOOL_IDS.map(id=>{
              if(id!=='pen'&&hardMode)return null
              if(toolPositions[id])return null
              return(
                <div key={id}
                  onPointerDown={editToolLayout?e=>{
                    e.preventDefault()
                    const r=e.currentTarget.getBoundingClientRect()
                    const ip={x:r.left,y:r.top}
                    setToolPositions(prev=>{const n={...prev,[id]:ip};localStorage.setItem('tool-positions',JSON.stringify(n));return n})
                    startToolDrag(id,e,ip)
                  }:undefined}
                  style={editToolLayout?{cursor:'move',outline:'2px dashed #6af',outlineOffset:'2px',borderRadius:4}:undefined}>
                  <div style={{position:'relative'}}>
                    {makeToolButton(id)}
                    {editToolLayout&&<div style={{position:'absolute',inset:0,cursor:'move'}}/>}
                  </div>
                </div>
              )
            })}
            <div className="tool-sep"/>
            <button className="tool-btn" onClick={doUndo} title="取り消し (Ctrl+Z)"><UndoIcon/></button>
            <button className="tool-btn" onClick={doRedo} title="やり直し (Ctrl+Y)"><RedoIcon/></button>
          </div>
          <div className="color-section">
            <input type="color" value={penColor} onChange={e=>setPenColor(e.target.value)} className="color-wheel" title="色選択"/>
            <div className="swatches">
              {PRESET_COLORS.map(c=><button key={c} className={`swatch${penColor===c?' sel':''}`} style={{background:c}} onClick={()=>setPenColor(c)} title={c}/>)}
            </div>
          </div>
        </div>
      </header>

      <div className="main">
        <div className="content">
          <div className="draw-area" ref={drawAreaRef}>
            <div style={{position:'absolute',inset:0,transform:(viewZoom!==100||panOffset.x||panOffset.y)?`translate(${panOffset.x}px,${panOffset.y}px) scale(${viewZoom/100})`:'none',transformOrigin:'center'}}>
            <div className="panel-left"
              style={leftHanded
                ?{right:0,left:`${100-splitRatio}%`,width:`${splitRatio}%`}
                :{left:0,width:`${splitRatio}%`}}
              onDragOver={e=>e.preventDefault()} onDrop={onRefDrop}>
              {practiceMode?(
                <div style={{flex:1,position:'relative',overflow:'hidden'}}>
                  <canvas ref={photoDispRef} width={CW} height={CH}
                    style={{width:'100%',height:'100%',display:'block',cursor:'grab'}}
                    {...orbitH}/>
                  <canvas ref={practiceOverlayRef} width={CW} height={CH}
                    style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block',
                      cursor:practiceDrawMode?cursor:'default',
                      pointerEvents:practiceDrawMode?'auto':'none'}}
                    {...(practiceDrawMode?leftH:{})}/>
                </div>
              ):(
                refImage&&!practiceMode&&fitDims?(
                  <div style={{position:'absolute',right:0,top:'50%',transform:'translateY(-50%)',
                               width:fitDims.w,height:fitDims.h,overflow:'hidden',flexShrink:0,
                               boxShadow:'0 0 30px rgba(0,0,0,.4)'}}>
                    <canvas ref={photoDispRef} width={CW} height={CH}
                      style={{position:'absolute',left:-(fitDims.cw-fitDims.w),top:-(fitDims.ch-fitDims.h)/2,
                              width:fitDims.cw,height:fitDims.ch,display:'block',cursor,touchAction:'none'}}
                      {...leftH}/>
                  </div>
                ):(
                  <canvas ref={photoDispRef} width={CW} height={CH} className="main-canvas"
                    style={{cursor,display:refImage?'block':'none',
                      position:'absolute',left:0,top:'50%',transform:'translateY(-50%)',maxWidth:'100%',maxHeight:'100%'}}
                    {...leftH}/>
                )
              )}

              {practiceMode&&(
                <div className="practice-bar">
                  <button className={`pst-btn${!practiceDrawMode?' pst-active':''}`}
                    onClick={()=>setPracticeDrawMode(false)} title="回転・ズーム">↻ 回転</button>
                  <button className={`pst-btn${practiceDrawMode?' pst-active':''}`}
                    onClick={()=>setPracticeDrawMode(true)} title="上に描画">✎ 描画</button>
                  <div style={{width:1,background:'#444',margin:'0 4px',alignSelf:'stretch'}}/>
                  <div className="practice-styles">
                    {PSTYLES.map(s=>(
                      <button key={s} className={`pst-btn${practiceStyle===s?' pst-active':''}`}
                        onClick={()=>setPracticeStyle(s)}>{PLABELS[s]}</button>
                    ))}
                  </div>
                  <button className="practice-shuffle" onClick={()=>{
                    const o=genCompound();practiceObjRef.current=o;setPracticeObject({...o})
                    const phi=.18+o.ep*.52, theta=o.rot*8+o.skX*3
                    setPracticeOrbit({rx:phi,ry:theta,rz:0,zoom:1})
                  }} title="形を変える"><ShuffleIcon/></button>
                  <button className="practice-reset" onClick={()=>setPracticeOrbit({rx:.3,ry:.2,rz:0,zoom:1})} title="視点をリセット">⟳</button>
                  <button className="practice-close" onClick={()=>{setPracticeMode(false);setPracticeDrawMode(false)}} title="練習モードを終了">✕</button>
                </div>
              )}

              {!practiceMode&&!refImage&&(
                <div className="drop-zone">
                  <DropIcon/>
                  <p>参考画像をドロップ / Ctrl+V で貼り付け</p>
                  <p className="drop-sub">PNG · JPG · GIF · WebP · スクリーンショット可</p>
                  <button className="file-pick-btn" onClick={()=>fileInputRef.current?.click()}>ファイルを選択</button>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={onFileInput}/>
                  <div className="url-row">
                    <input type="text" className={`url-input${urlError?' url-error':''}`} placeholder="画像URLを貼り付け（.jpg/.png等）"
                      value={urlInput} onChange={e=>{setUrlInput(e.target.value);setUrlError('')}}
                      onPaste={onUrlPaste} onKeyDown={e=>e.key==='Enter'&&loadFromUrl(urlInput)}/>
                    <button className="url-btn" onClick={()=>loadFromUrl(urlInput)}>→</button>
                  </div>
                  {urlError&&<div className="url-err-box">{URL_ERR[urlError].split('\n').map((l,i)=><p key={i}>{l}</p>)}</div>}
                  <button className="practice-start-btn" onClick={startPractice}>🔷 幾何学練習モード</button>
                </div>
              )}

            </div>

            <div className="panel-right"
              style={leftHanded?{left:0,width:`${100-splitRatio}%`}:{left:`${splitRatio}%`,width:`${100-splitRatio}%`}}>
              <div className={`canvas-area${refImage&&!practiceMode?' canvas-dual':''}`} ref={canvasAreaRef}>
                {refImage&&!practiceMode&&fitDims?(
                  <div style={{width:fitDims.w,height:fitDims.h,position:'relative',flexShrink:0,overflow:'hidden',marginTop:fitDims.top??0,boxShadow:'0 0 30px rgba(0,0,0,.4)'}}>
                    <div style={{position:'absolute',top:-(fitDims.ch-fitDims.h)/2,left:-(fitDims.cw-fitDims.w),width:fitDims.cw,height:fitDims.ch}}>
                      <canvas ref={displayRef} width={CW} height={CH}
                        style={{width:'100%',height:'100%',display:'block',cursor,touchAction:'none'}}
                        {...rightH}/>
                      {showRuler&&<RulerOverlay w={CW} h={CH} rulers={rulers} activeRulerId={activeRulerId}/>}
                    </div>
                  </div>
                ):(
                  <>
                    <canvas ref={displayRef} width={CW} height={CH} className="main-canvas" style={{cursor}} {...rightH}/>
                    {showRuler&&<RulerOverlay w={CW} h={CH} rulers={rulers} activeRulerId={activeRulerId}/>}
                  </>
                )}
              </div>
            </div>
            </div>
          </div>

          <div className="bottom-bar">
            {refImage&&!practiceMode&&<>
              <label className="bb-label">不透明度</label>
              <input type="range" min="10" max="100" value={refOpacity} onChange={e=>setRefOpacity(+e.target.value)} className="split-slider"/>
              <span className="bb-val">{refOpacity}%</span>
              <span className="bb-sep"/>
            </>}
            <label className="bb-label">表示</label>
            <input type="range" min="20" max="400" value={viewZoom} onChange={e=>setViewZoom(+e.target.value)} className="zoom-slider" title="表示サイズ (二本指スクロールでズーム)"/>
            <span className="bb-val">{viewZoom}%</span>
            {(viewZoom!==100||panOffset.x||panOffset.y)&&<button className="bb-reset-btn" onClick={()=>{setViewZoom(100);setPanOffset({x:0,y:0});panOffsetRef.current={x:0,y:0}}} title="表示位置・ズームをリセット">⟳</button>}
            <div style={{flex:1}}/>
            {refImage&&!practiceMode&&<button className={`sl-btn${refOverlay?' sl-active':''}`} onClick={()=>setRefOverlay(v=>!v)} title="参考画像を描画パネルに重ねて表示"><span className="sl-icon ci"/></button>}
            {refImage&&!practiceMode&&refOverlay&&<>
              <label className="bb-label">重ねて表示</label>
              <input type="range" min="0" max="100" value={refOverlayOpacity} onChange={e=>setRefOverlayOpacity(+e.target.value)} className="split-slider"/>
              <span className="bb-val">{refOverlayOpacity}%</span>
            </>}
            {refImage&&!practiceMode&&<button onClick={deletePhoto} className="bb-del-btn" title="写真を削除">✕ 削除</button>}
          </div>
        </div>

        {showLayerPanel&&(
          <div className="sidebar-col">
            {/* ── ツール設定（上部固定）─────────────────── */}
            <aside className="pen-sidebar">
              {(activeTool===TOOLS.PEN)&&<>
                <div className="pen-sidebar-hdr">ペン設定</div>
                <div className="pen-sidebar-body tool-body">
                  <div className="tool-size-row">
                    <span className="tool-label">太さ</span>
                    <input type="range" min="1" max="80" value={penSize}
                      onChange={e=>setPenSize(+e.target.value)} className="tool-slider"/>
                    <span className="tool-size-val">{penSize}</span>
                  </div>
                </div>
              </>}
              {(activeTool===TOOLS.ERASER)&&<>
                <div className="pen-sidebar-hdr">消しゴム</div>
                <div className="pen-sidebar-body tool-body">
                  <div className="tool-size-row">
                    <span className="tool-label">太さ</span>
                    <input type="range" min="1" max="80" value={eraserSize}
                      onChange={e=>setEraserSize(+e.target.value)} className="tool-slider"/>
                    <span className="tool-size-val">{eraserSize}</span>
                  </div>
                </div>
              </>}
              {showGrid&&!hardMode&&<>
                <div className="pen-sidebar-hdr">マス目</div>
                <div className="pen-sidebar-body">
                  <div className="pen-size-row">
                    <span className="tool-label">{gridSize<0?`${-gridSize}分割`:'サイズ'}</span>
                    <select value={gridSize} onChange={e=>setGridSize(+e.target.value)} className="sel-sm">
                      <optgroup label="サイズ">
                        {[80,100,150,200,300,400,500].map(s=><option key={s} value={s}>{s}px</option>)}
                      </optgroup>
                      <optgroup label="分割">
                        <option value={-2}>縦横2分割</option>
                        <option value={-3}>縦横3分割</option>
                        <option value={-4}>縦横4分割</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="tool-size-row" style={{marginTop:6}}>
                    <span className="tool-label">濃度</span>
                    <input type="range" min="10" max="100" value={gridOpacity}
                      onChange={e=>setGridOpacity(+e.target.value)} className="tool-slider"/>
                    <span className="tool-size-val">{gridOpacity}%</span>
                  </div>
                </div>
              </>}
              {showRuler&&!hardMode&&(()=>{
                const ar=rulers.find(r=>r.id===activeRulerId)
                return<>
                  <div className="pen-sidebar-hdr">
                    定規
                    {activeTool===TOOLS.RULER&&<span className="ruler-add-hint">ドラッグで追加</span>}
                  </div>
                  <div className="pen-sidebar-body">
                    {/* 定規リスト */}
                    {rulers.length>0&&<div className="ruler-list">
                      {rulers.map((r,i)=>(
                        <div key={r.id}
                          className={`ruler-row${activeRulerId===r.id?' ruler-row--active':''}`}
                          onClick={()=>setActiveRulerId(r.id)}>
                          <span className="ruler-color-dot" style={{background:r.color}}/>
                          <span className="ruler-row-label">
                            {i+1}. {r.type==='none'?'線':r.type==='cm'?'cm':`÷${r.divisions}`}
                          </span>
                          <button className="ruler-del-btn" onClick={e=>{
                            e.stopPropagation()
                            setRulers(rs=>rs.filter(x=>x.id!==r.id))
                            if(activeRulerId===r.id)setActiveRulerId(null)
                          }}>✕</button>
                        </div>
                      ))}
                    </div>}
                    {/* 選択中定規の設定 */}
                    {ar&&<div className="ruler-settings">
                      <div className="ruler-settings-title">定規 {rulers.indexOf(ar)+1} の設定</div>
                      <select value={ar.type}
                        onChange={e=>setRulers(rs=>rs.map(r=>r.id===ar.id?{...r,type:e.target.value}:r))}
                        className="sel-sm" style={{width:'100%',marginBottom:5}}>
                        <option value="none">メモリなし</option>
                        <option value="cm">cm メモリ</option>
                        <option value="div">等分割</option>
                      </select>
                      <div className="tool-size-row" style={{marginBottom:5}}>
                        <span className="tool-label">色</span>
                        <input type="color" value={ar.color}
                          onChange={e=>setRulers(rs=>rs.map(r=>r.id===ar.id?{...r,color:e.target.value}:r))}
                          style={{width:36,height:24,padding:2,border:'1px solid #555',borderRadius:3,cursor:'pointer',background:'none'}}/>
                      </div>
                      {ar.type==='div'&&<div className="tool-size-row">
                        <span className="tool-label">分割数</span>
                        <input type="range" min="2" max="24" value={ar.divisions}
                          onChange={e=>setRulers(rs=>rs.map(r=>r.id===ar.id?{...r,divisions:+e.target.value}:r))}
                          className="tool-slider"/>
                        <span className="tool-size-val">{ar.divisions}</span>
                      </div>}
                    </div>}
                    {/* デフォルト（次の定規用）*/}
                    {activeTool===TOOLS.RULER&&<div className="ruler-default-section">
                      <div className="ruler-settings-title">次の定規</div>
                      <select value={rulerType} onChange={e=>setRulerType(e.target.value)}
                        className="sel-sm" style={{width:'100%',marginBottom:5}}>
                        <option value="none">メモリなし</option>
                        <option value="cm">cm メモリ</option>
                        <option value="div">等分割</option>
                      </select>
                      {rulerType==='div'&&<div className="tool-size-row">
                        <span className="tool-label">分割数</span>
                        <input type="range" min="2" max="24" value={rulerDivisions}
                          onChange={e=>setRulerDivisions(+e.target.value)} className="tool-slider"/>
                        <span className="tool-size-val">{rulerDivisions}</span>
                      </div>}
                    </div>}
                    {rulers.length===0&&activeTool!==TOOLS.RULER&&
                      <p className="ruler-hint">定規ツールをONにしてドラッグ</p>}
                  </div>
                </>
              })()}
            </aside>
            {/* ── レイヤーウィンドウ（下部・残スペース）── */}
            <aside className="layer-sidebar">
              <div className="lp-header">
                <span className="lp-title">レイヤー</span>
                <div className="lp-actions">
                  <button onClick={addLayer} title="新規">+</button>
                  <button onClick={deleteLayer} disabled={drawingLayers.length<=1} title="削除">−</button>
                  <button onClick={clearActive} title="クリア" className="btn-warn">🗑</button>
                  <button onClick={flatten} title="統合" className="btn-merge">⊕</button>
                </div>
              </div>
              {activeLayerId==='photo'&&(
                <div className="lp-opacity">
                  <label>不透明度<span>{refOpacity}%</span></label>
                  <input type="range" min="0" max="100" value={refOpacity} onChange={e=>setRefOpacity(+e.target.value)}/>
                </div>
              )}
              {activeLayer&&!activeLayer.isPaper&&(
                <div className="lp-opacity">
                  <label>不透明度<span>{activeLayer.opacity}%</span></label>
                  <input type="range" min="0" max="100" value={activeLayer.opacity} onChange={e=>updLayer(activeLayerId,{opacity:+e.target.value})}/>
                </div>
              )}
              <div className="layer-list" ref={layerListRef}>
                {listItems.map((item,idx)=>{
                  const isDrag = layerDragSrc===idx
                  const isDrop = layerDropIdx===idx && layerDragSrc!==null && layerDropIdx!==layerDragSrc
                  if(item.type==='photo')return(
                    <div key="photo"
                      className={`layer-row photo-layer-row${isDrag?' layer-dragging':''}${isDrop?' layer-drop-here':''}${activeLayerId==='photo'?' active':''}`}
                      onMouseDown={e=>onLayerPointerDown(idx,e)}
                      onTouchStart={e=>onLayerPointerDown(idx,e)}>
                      <span className="vis-btn"><EyeIcon/></span>
                      <div className="layer-thumb-ref">{refImage?<img src={refImage} alt="" style={{opacity:refOpacity/100}}/>:<span style={{fontSize:9,color:'#888',padding:'0 4px'}}>なし</span>}</div>
                      <span className="layer-name">参考画像</span>
                    </div>
                  )
                  const layer=item.layer
                  return(
                    <div key={layer.id}
                      className={`layer-row${layer.id===activeLayerId?' active':''}${layer.isPaper?' paper-row':''}${isDrag?' layer-dragging':''}${isDrop?' layer-drop-here':''}`}
                      onMouseDown={e=>!layer.isPaper&&onLayerPointerDown(idx,e)}
                      onTouchStart={e=>!layer.isPaper&&onLayerPointerDown(idx,e)}>
                      <button className="vis-btn" onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();if(!layer.isPaper)updLayer(layer.id,{visible:!layer.visible})}}>
                        {layer.visible?<EyeIcon/>:<EyeOffIcon/>}
                      </button>
                      <LayerThumb layerId={layer.id} layerCanvases={layerCanvases} rev={rev}/>
                      <span className="layer-name">{layer.name}</span>
                      <span className="layer-op">{layer.isPaper?'用紙':`${layer.opacity}%`}</span>
                    </div>
                  )
                })}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Three.js helpers ──────────────────────────────────────────────
function buildThreeMat(style){
  if(style==='shading')   return new THREE.MeshStandardMaterial({color:0xede9e3,roughness:.62,metalness:0})
  return new THREE.MeshBasicMaterial({color:0xffffff}) // wireframe: white solid for depth occlusion
}

function buildThreeObj(type, mat, style){
  const grp = new THREE.Group()
  const isWire = style==='wireframe'
  const edgeMat = new THREE.LineBasicMaterial({color:0x1a1816})
  const add = (geo, m, pos, rotArr) => {
    const mesh = new THREE.Mesh(geo, m||mat)
    if(pos) mesh.position.set(...pos)
    if(rotArr) mesh.rotation.set(...rotArr)
    grp.add(mesh)
    if(isWire){
      const el=new THREE.LineSegments(new THREE.EdgesGeometry(geo,8),edgeMat)
      if(pos) el.position.set(...pos)
      if(rotArr) el.rotation.set(...rotArr)
      grp.add(el)
    }
  }
  const dark = isWire
    ? new THREE.MeshBasicMaterial({color:0xffffff})
    : new THREE.MeshStandardMaterial({color:0x1e1a18,roughness:.9,metalness:0})
  switch(type){
    case 'sphere':      add(new THREE.SphereGeometry(1.15,48,48)); break
    case 'cube':        add(new THREE.BoxGeometry(1.72,1.72,1.72)); break
    case 'cylinder':    add(new THREE.CylinderGeometry(.78,.78,2.1,48)); break
    case 'cone':        add(new THREE.ConeGeometry(.98,2.2,48)); break
    case 'torus':       add(new THREE.TorusGeometry(.82,.30,24,80)); break
    case 'octahedron':  add(new THREE.OctahedronGeometry(1.35,0)); break
    case 'tetrahedron': add(new THREE.TetrahedronGeometry(1.52,0)); break
    case 'icosahedron': add(new THREE.IcosahedronGeometry(1.25,0)); break
    case 'dodecahedron':add(new THREE.DodecahedronGeometry(1.12,0)); break
    case 'prism':       add(new THREE.CylinderGeometry(.95,.95,1.85,3)); break
    case 'pyramid':     add(new THREE.ConeGeometry(1.1,1.9,4)); break
    case 'capsule':     add(new THREE.CapsuleGeometry(.7,1.2,12,32)); break
    case 'torusknot':   add(new THREE.TorusKnotGeometry(.62,.20,120,16)); break
    case 'gem':
      add(new THREE.CylinderGeometry(.72,.82,.28,8),null,[0,.82])
      add(new THREE.ConeGeometry(.82,1.7,8),null,[0,-.18])
      break
    case 'arrow':
      add(new THREE.CylinderGeometry(.22,.22,1.55,16),null,[0,-.38])
      add(new THREE.ConeGeometry(.54,.92,16),null,[0,.70])
      break
    case 'mushroom':
      add(new THREE.SphereGeometry(1.12,48,32,0,Math.PI*2,0,Math.PI*.62),null,[0,.26])
      add(new THREE.CylinderGeometry(.28,.44,1.22,32),null,[0,-.64])
      break
    case 'rocket':
      add(new THREE.CylinderGeometry(.38,.38,1.8,32))
      add(new THREE.ConeGeometry(.38,.85,32),null,[0,1.32])
      ;[[-1,0],[1,0],[0,-1],[0,1]].forEach(([x,z])=>
        add(new THREE.BoxGeometry(.08,.58,.52),null,[x*.46,-.85,z*.46]))
      break
    case 'snowman':
      add(new THREE.SphereGeometry(.68,32,32),null,[0,-.68])
      add(new THREE.SphereGeometry(.50,32,32),null,[0,.30])
      add(new THREE.SphereGeometry(.35,32,32),null,[0,1.08])
      add(new THREE.CylinderGeometry(.36,.36,.08,32),dark,[0,1.42])
      add(new THREE.CylinderGeometry(.26,.26,.40,32),dark,[0,1.66])
      break
    case 'lamp':
      add(new THREE.CylinderGeometry(.48,.58,.14,48),null,[0,-1.28])
      add(new THREE.CylinderGeometry(.055,.055,1.65,16),null,[0,-.45])
      add(new THREE.CylinderGeometry(.28,.82,.92,32,1,true),null,[0,.57])
      add(new THREE.CircleGeometry(.28,32),null,[0,1.02],[-Math.PI/2,0,0])
      add(new THREE.CircleGeometry(.82,32),null,[0,.11],[Math.PI/2,0,0])
      break
    case 'crystal':
      add(new THREE.CylinderGeometry(.40,.50,1.52,6),null,[0,-.16])
      add(new THREE.ConeGeometry(.40,.68,6),null,[0,.92])
      break
    case 'hourglass':{
      const hg=isWire?mat:new THREE.MeshStandardMaterial({color:0xdce8f4,roughness:.1,metalness:.05,transparent:true,opacity:.55})
      add(new THREE.ConeGeometry(.72,1.28,32),hg,[0,.64])
      add(new THREE.ConeGeometry(.72,1.28,32),hg,[0,-.64],[Math.PI,0,0])
      add(new THREE.TorusGeometry(.74,.065,16,48),null,[0,1.28],[Math.PI/2,0,0])
      add(new THREE.TorusGeometry(.74,.065,16,48),null,[0,-1.28],[Math.PI/2,0,0])
      break
    }
    default: break
  }
  return grp
}

// ── Helpers ───────────────────────────────────────────────────────
function drawSelPath(ctx,sel){
  ctx.strokeStyle='#3399ff';ctx.lineWidth=1;ctx.setLineDash([6,3])
  if(sel.pts){ctx.beginPath();sel.pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.closePath();ctx.stroke()}
  else{ctx.strokeRect(sel.x,sel.y,sel.w,sel.h)}
  ctx.setLineDash([])
}

// ── Icons ─────────────────────────────────────────────────────────
function TB({label,active,onClick,children}){return <button className={`tool-btn${active?' active':''}`} onClick={onClick} title={label}>{children}</button>}
function MenuIcon(){return<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="2" y1="5" x2="18" y2="5"/><line x1="2" y1="10" x2="18" y2="10"/><line x1="2" y1="15" x2="18" y2="15"/></svg>}
function UndoIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>}
function RedoIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>}
function PenIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>}
function EraserIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="8" width="20" height="10" rx="2" fill="#fafaf8" stroke="#666" strokeWidth="1.5"/><rect x="2" y="8" width="9" height="10" rx="2" fill="#f0a0a0" stroke="#666" strokeWidth="1.5"/><line x1="11" y1="8" x2="11" y2="18" stroke="#888" strokeWidth="1.3"/><line x1="3" y1="18" x2="21" y2="18" stroke="#444" strokeWidth="2.2" strokeLinecap="round"/></svg>}
function SelectIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="13" height="12" rx=".5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" fill="none"/><path d="M15 15 L15 23 L17.2 20.2 L19.4 23.4 L20.5 22.6 L18.3 19.4 L21.2 19.4 Z" fill="currentColor"/></svg>}
function MoveIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 12v-7M12 12H5M12 12v7M12 12h7"/></svg>}
function LineIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="2" fill="currentColor" stroke="none"/></svg>}
function RulerIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="8" width="20" height="8" rx="1"/><line x1="6" y1="8" x2="6" y2="13"/><line x1="10" y1="8" x2="10" y2="11"/><line x1="14" y1="8" x2="14" y2="11"/><line x1="18" y1="8" x2="18" y2="13"/></svg>}
function GridIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>}
function SnapIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity=".3"/><path d="M7 7l2.5 2.5M14.5 14.5L17 17M17 7l-2.5 2.5M9.5 14.5L7 17"/></svg>}
function ShuffleIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>}
function DropIcon(){return<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
function HandIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 11V7a2 2 0 00-4 0v4"/><path d="M14 9V5a2 2 0 00-4 0v4"/><path d="M10 9V4a2 2 0 00-4 0v4"/><path d="M6 12v-1a2 2 0 014 0v1"/><path d="M18 11a2 2 0 014 0v3a8 8 0 01-8 8H10a8 8 0 01-8-8v-5a2 2 0 014 0v4"/></svg>}
function EyeIcon(){return<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
function EyeOffIcon(){return<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity=".4"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>}
function DeselectIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/><line x1="8" y1="16" x2="16" y2="8"/><line x1="8" y1="8" x2="16" y2="16"/></svg>}
function DeleteSelIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/><path d="M9 12h6"/></svg>}
function DeleteOutIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10" rx=".5" strokeDasharray="3 2"/></svg>}
function TransformIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="1" strokeDasharray="3 2"/><rect x="2" y="2" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="18" y="2" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="2" y="18" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="18" y="18" width="4" height="4" fill="currentColor" rx="1" stroke="none"/></svg>}
function FillSelIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2" fill="currentColor" fillOpacity=".25"/><path d="M9 12h6M12 9v6" strokeDasharray="none"/></svg>}
