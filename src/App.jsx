import { useState, useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import './App.css'

const TOOLS = { PEN:'pen', ERASER:'eraser', SELECT:'select', MOVE:'move', LINE:'line', RULER:'ruler', HAND:'hand' }
const PRESET_COLORS = ['#000000','#00cc00','#ff6600','#0066ff','#ff00ee','#ff0000']
const DEFAULT_W = 2800, DEFAULT_H = 1050
const PAPER_ID = 0
const PHOTO_ID = 'photo'
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
const FLAT_SHAPES=['circle','ellipse','triangle','rtriangle','square','rect','pentagon','hexagon','star','diamond','trapezoid','parallelogram']
const FLAT_LABELS={circle:'円',ellipse:'楕円',triangle:'正三角形',rtriangle:'直角三角形',square:'正方形',rect:'長方形',pentagon:'正五角形',hexagon:'正六角形',star:'星形',diamond:'菱形',trapezoid:'台形',parallelogram:'平行四辺形'}
const FLAT_STYLES=['filled','outline']
const FLAT_STYLE_LABELS={filled:'塗り',outline:'輪郭'}
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
function genFlat(){
  return{type:FLAT_SHAPES[Math.floor(Math.random()*FLAT_SHAPES.length)],rot:(Math.random()-.5)*.35,aspect:.5+Math.random()*.8}
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
    ctx.beginPath();ctx.moveTo(cx,tY);ctx.lineTo(cx-bR,bY);ctx.lineTo(cx+bR,bY);ctx.closePath()
    const g=ctx.createRadialGradient(cx-bR*.22,tY+sc*.28,sc*.02,cx+bR*.35,bY,bR*1.38)
    g.addColorStop(0,'#ffffff');g.addColorStop(.22,'#ece8e2');g.addColorStop(.54,'#b4b0aa');g.addColorStop(1,'#726e6a')
    ctx.fillStyle=g;ctx.fill()
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
}

function clipLineToBBox(x1,y1,x2,y2,minX,minY,maxX,maxY){
  const dx=x2-x1,dy=y2-y1;let t0=0,t1=1
  const clip=(p,q)=>{if(p===0)return q>=0;const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r}else{if(r<t0)return false;if(r<t1)t1=r};return true}
  if(!clip(-dx,x1-minX)||!clip(dx,maxX-x1)||!clip(-dy,y1-minY)||!clip(dy,maxY-y1))return null
  return[x1+t0*dx,y1+t0*dy,x1+t1*dx,y1+t1*dy]
}
function screenToCv(sx,sy,rect,cw,ch){return{x:(sx-rect.left)*(cw/rect.width),y:(sy-rect.top)*(ch/rect.height)}}

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

// ── ToggleColorPicker — 再タップで閉じる色選択ボタン ─────────────
function ToggleColorPicker({value,onChange,width=36,height=24}){
  const inputRef=useRef(null)
  const openRef=useRef(false)
  const handleClick=e=>{
    e.preventDefault()
    if(openRef.current){openRef.current=false;inputRef.current?.blur();return}
    openRef.current=true
    try{inputRef.current?.showPicker()}catch{inputRef.current?.click()}
  }
  return(
    <span style={{position:'relative',display:'inline-block',width,height,flexShrink:0}}>
      <button style={{width:'100%',height:'100%',background:value,
        border:'1px solid #555',borderRadius:3,cursor:'pointer',display:'block',padding:0}}
        onClick={handleClick}/>
      <input ref={inputRef} type="color" value={value}
        onChange={e=>onChange(e.target.value)}
        onFocus={()=>{openRef.current=true}}
        onBlur={()=>{openRef.current=false}}
        style={{position:'absolute',left:0,top:0,width:0,height:0,opacity:0,
          pointerEvents:'none',border:'none',padding:0}}/>
    </span>
  )
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
      const lw=1.5
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
      const hR=3
      ;[[x1,y1],[x2,y2]].forEach(([px,py])=>{
        ctx.beginPath();ctx.arc(px,py,hR,0,Math.PI*2)
        ctx.fillStyle='#fff';ctx.fill()
        ctx.strokeStyle=C;ctx.lineWidth=1.5;ctx.stroke()
      })
      // tick marks
      const TICK=10
      ctx.lineWidth=1.1
      const tick=(d,h2,label)=>{
        const px=x1+ux*d,py=y1+uy*d
        ctx.beginPath()
        ctx.moveTo(px-nx*h2,py-ny*h2)
        ctx.lineTo(px+nx*h2,py+ny*h2)
        ctx.strokeStyle=CL;ctx.stroke()
        if(label!=null){
          ctx.fillStyle=C
          ctx.font=`9px sans-serif`
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
        ctx.font=`10px sans-serif`;ctx.fillStyle=C
        ctx.fillText(`${totalCm}cm`,mx+nx*22-ctx.measureText(`${totalCm}cm`).width/2,my+ny*22+4)
      } else if(type==='div'){
        const n=divisions
        for(let i=0;i<=n;i++){
          const d=len*i/n
          const isEnd=i===0||i===n
          tick(d,isEnd?TICK*1.1:TICK*.85,(!isEnd&&i>0)?`${i}`:null)
        }
        ctx.font=`9px sans-serif`;ctx.fillStyle=C
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
function SelectionStrip({sel,canvasEl,cvW,cvH,onDeselect,onDelete,onDeleteOut,onFill,onTransform}) {
  if(!sel||!canvasEl||sel.w<2||sel.h<2)return null
  const r=canvasEl.getBoundingClientRect()
  const left=Math.max(4,r.left+sel.x*(r.width/cvW)-38)
  const top=r.top+sel.y*(r.height/cvH)
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
function TransformOverlay({xf,canvasEl,cvW,cvH,onUpdate,onCommit,onCancel}) {
  if(!xf||!canvasEl)return null
  const r=canvasEl.getBoundingClientRect()
  const sx=r.width/cvW,sy=r.height/cvH
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
  const [penSize,setPenSize]           = useState(1)
  const [eraserSize,setEraserSize]     = useState(20)
  const [panOffset,setPanOffset]       = useState({x:0,y:0})
  const [refImage,setRefImage]         = useState(null)
  const [refOpacity,setRefOpacity]     = useState(100)
  const [layers,setLayers]             = useState([mkPaper(),mkLayer(1,'レイヤー 1')])
  const [activeLayerId,setActiveLayerId] = useState(1)
  const [showLayerPanel,setShowLayerPanel] = useState(true)
  const [rev,setRev]                   = useState(0)
  const [showGrid,setShowGrid]         = useState(false)
  const [gridSize,setGridSize]         = useState(100)
  const [gridOpacity,setGridOpacity]   = useState(40)
  const [showRuler,setShowRuler]       = useState(false)
  const [rulerType,setRulerType]       = useState('div')
  const [rulerDivisions,setRulerDivisions] = useState(8)
  const [rulerColor,setRulerColor]     = useState('#2864ff')
  const [rulers,setRulers]             = useState([])
  const [activeRulerId,setActiveRulerId] = useState(null)
  const [urlInput,setUrlInput]         = useState('')
  const [urlError,setUrlError]         = useState('')
  const [xf,setXf]                     = useState(null)
  const [showMenu,setShowMenu]         = useState(false)
  const [leftHanded,setLeftHanded]     = useState(false)
  const [hardMode,_setHardMode]        = useState(false)
  const [practiceMode,setPracticeMode] = useState(false)
  const [practiceStyle,setPracticeStyle] = useState('shading')
  const [practiceObject,setPracticeObject] = useState(null)
  const [practiceOrbit,setPracticeOrbit] = useState({rx:.3,ry:.2,rz:0,zoom:1})
  const [practiceDrawMode,setPracticeDrawMode] = useState(true)
  const [practiceCategory,setPracticeCategory] = useState('3d')  // '3d' | 'flat'
  const [flatStyle,setFlatStyle]               = useState('filled')
  const [refOverlay,setRefOverlay]             = useState(false)
  const [refOverlayOpacity,setRefOverlayOpacity] = useState(50)
  const [practiceOverlay,setPracticeOverlay]   = useState(false)
  const [practiceOverlayOpacity,setPracticeOverlayOpacity] = useState(40)
  const [showShortcutPanel,setShowShortcutPanel] = useState(false)
  const [scLearning,setScLearning]       = useState(null)
  const [shortcuts,setShortcuts]         = useState(()=>{
    try{return{...DEFAULT_SHORTCUTS,...JSON.parse(localStorage.getItem('key-shortcuts')||'{}')} }catch{return{...DEFAULT_SHORTCUTS}}
  })
  const [cvW,setCvW] = useState(DEFAULT_W)
  const [cvH,setCvH] = useState(DEFAULT_H)
  const [dispSize,setDispSize] = useState({w:0,h:0})
  const [viewZoom,setViewZoom] = useState(100)
  const [cropMode,setCropMode] = useState(false)
  const [cropRect,setCropRect] = useState(null)
  const [appliedCrop,setAppliedCrop] = useState(null)
  const [photoAreaDragOver,setPhotoAreaDragOver] = useState(false)

  const setHardMode = v => { if(v&&activeTool!==TOOLS.PEN)setActiveTool(TOOLS.PEN); _setHardMode(v) }

  const [_selRect,_setSel] = useState(null)
  const selRef     = useRef(null)
  const setSel     = v => { const val=typeof v==='function'?v(selRef.current):v; selRef.current=val; _setSel(val) }
  const xfRef      = useRef(null)
  const setXfState = v => { const val=typeof v==='function'?v(xfRef.current):v; xfRef.current=val; setXf(val) }

  const cvRef          = useRef({w:DEFAULT_W,h:DEFAULT_H})
  const layerCanvases  = useRef({})
  const photoLayerCanvas = useRef(null)
  const displayRef     = useRef(null)
  const compRef        = useRef(null)
  const panOffsetRef   = useRef({x:0,y:0})
  const panStartRef    = useRef(null)
  const lastClientXY   = useRef(null)
  const refImageEl     = useRef(null)
  const fileInputRef   = useRef(null)
  const practiceObjRef = useRef(null)
  const orbitDragStart    = useRef(null)
  const placingRulerIdRef  = useRef(null)
  const placingRulerStartRef = useRef(null)
  const drawAreaRef       = useRef(null)
  const cursorDivRef      = useRef(null)
  const [isCursorOnCanvas, setIsCursorOnCanvas] = useState(false)

  // layer drag-to-reorder
  const layerListRef   = useRef(null)
  const layerDragRef   = useRef({srcIdx:null,dropIdx:null,startY:0,moved:false})
  const listItemsRef   = useRef([])
  const [layerDragSrc, setLayerDragSrc] = useState(null)
  const [layerDropIdx, setLayerDropIdx] = useState(null)

  const [toolPositions,setToolPositions]=useState(()=>{try{return JSON.parse(localStorage.getItem('tool-positions')||'{}')}catch{return{}}})
  const [editToolLayout,setEditToolLayout]=useState(false)

  // ── Tabmate (WebHID) ──────────────────────────────────────────
  const [showTabmatePanel,setShowTabmatePanel] = useState(false)
  const [tabmateConnected,setTabmateConnected] = useState(false)
  const [tabmateLearning,setTabmateLearning]   = useState(null)
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
  const shiftKeyRef     = useRef(false)
  const penSnapDirRef   = useRef(null)
  const penShiftSnapRef = useRef(null)

  const S = useRef({})
  S.current = {activeTool,penColor,penSize,eraserSize,activeLayerId,refOpacity,layers,showGrid,gridSize,gridOpacity,practiceMode,practiceDrawMode,practiceStyle,practiceObject,rulerType,rulerDivisions,rulerColor,hardMode,practiceOrbit,practiceCategory,flatStyle,refOverlay,refOverlayOpacity,practiceOverlay,practiceOverlayOpacity}
  shortcutsRef.current = shortcuts
  scLearningRef.current = scLearning

  const doUndoRef = useRef(null)
  const doRedoRef = useRef(null)
  const threeRef  = useRef(null)

  // ── Canvas init ───────────────────────────────────────────────
  useEffect(()=>{
    const {w,h}=cvRef.current
    layers.forEach(l=>{
      if(!layerCanvases.current[l.id]){
        const c=document.createElement('canvas');c.width=w;c.height=h
        if(l.isPaper){const cx=c.getContext('2d');cx.fillStyle='#ffffff';cx.fillRect(0,0,w,h)}
        layerCanvases.current[l.id]=c
        const key=String(l.id),blank=c.getContext('2d').getImageData(0,0,w,h)
        histStacks.current[key]=[blank];histPtrs.current[key]=0
      }
    })
    Object.keys(layerCanvases.current).forEach(id=>{if(!layers.find(l=>l.id===+id))delete layerCanvases.current[id]})
  },[layers])

  // Photo load → resize canvas to 2×photoDisplayWidth × photoDisplayHeight
  useEffect(()=>{
    if(!refImage){refImageEl.current=null;return}
    const img=new Image();img.crossOrigin='anonymous';img.src=refImage
    img.onload=()=>{
      refImageEl.current=img
      const el=drawAreaRef.current;if(!el)return
      const aw=el.offsetWidth,ah=el.offsetHeight;if(!aw||!ah)return
      const pAR=img.naturalWidth/img.naturalHeight
      const halfW=aw/2
      let photoW,photoH
      if(pAR>halfW/ah){photoW=halfW;photoH=halfW/pAR}
      else{photoH=ah;photoW=ah*pAR}
      const nw=Math.round(photoW)*2,nh=Math.round(photoH)
      setCvW(nw);setCvH(nh);cvRef.current={w:nw,h:nh}
      Object.entries(layerCanvases.current).forEach(([id,c])=>{
        c.width=nw;c.height=nh
        const ctx=c.getContext('2d')
        if(+id===PAPER_ID){ctx.fillStyle='#fff';ctx.fillRect(0,0,nw,nh)}
        const blank=ctx.getImageData(0,0,nw,nh)
        histStacks.current[String(id)]=[blank];histPtrs.current[String(id)]=0
      })
      // bake photo into photoLayerCanvas (left half)
      if(!photoLayerCanvas.current)photoLayerCanvas.current=document.createElement('canvas')
      const plc=photoLayerCanvas.current;plc.width=nw;plc.height=nh
      const pctx=plc.getContext('2d');pctx.clearRect(0,0,nw,nh)
      pctx.drawImage(img,0,0,nw/2,nh)
      histStacks.current[PHOTO_ID]=[pctx.getImageData(0,0,nw,nh)];histPtrs.current[PHOTO_ID]=0
      lastHistKey.current=null
      setAppliedCrop(null);setCropMode(false);setCropRect(null)
      setRev(r=>r+1)
    }
  },[refImage])

  // Compute CSS display size: fit cvW×cvH inside draw-area
  useEffect(()=>{
    const el=drawAreaRef.current;if(!el)return
    const update=()=>{
      const aw=el.offsetWidth,ah=el.offsetHeight;if(!aw||!ah)return
      const {w:cw,h:ch}=cvRef.current
      const ar=cw/ch
      let dw=aw,dh=aw/ar
      if(dh>ah){dh=ah;dw=ah*ar}
      setDispSize({w:Math.round(dw),h:Math.round(dh)})
    }
    update()
    const ro=new ResizeObserver(update);ro.observe(el)
    return()=>ro.disconnect()
  },[cvW,cvH])

  // ── History ───────────────────────────────────────────────────
  const saveHist = useCallback(()=>{
    const key=String(S.current.activeLayerId)
    const canvas=S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId];if(!canvas)return
    const {w:cw,h:ch}=cvRef.current
    const data=canvas.getContext('2d').getImageData(0,0,cw,ch)
    const stack=histStacks.current[key]??[]
    if(!histStacks.current[key]){histStacks.current[key]=stack;histPtrs.current[key]=-1}
    const ptr=histPtrs.current[key]??-1
    stack.splice(ptr+1);stack.push(data)
    if(stack.length>MAX_HIST)stack.shift()
    histPtrs.current[key]=stack.length-1
    lastHistKey.current=key
  },[])

  // ── Composite ─────────────────────────────────────────────────
  const comp=useCallback(()=>{
    const disp=displayRef.current;if(!disp)return
    const {w:cw,h:ch}=cvRef.current
    const ctx=disp.getContext('2d')
    ctx.clearRect(0,0,cw,ch)
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,ch)
    const {practiceMode,practiceStyle,practiceObject,refOpacity,layers,showGrid,gridSize,gridOpacity,practiceCategory,flatStyle,refOverlay,refOverlayOpacity,practiceOverlay,practiceOverlayOpacity}=S.current
    // Left half: photo or practice
    if(practiceMode){
      if(practiceCategory==='flat'){
        drawFlatPractice(ctx,practiceObject,cw/2,ch,flatStyle)
      } else if(threeRef.current?.rendered){
        ctx.drawImage(threeRef.current.renderer.domElement,0,0,cw/2,ch)
      } else if(practiceObject){
        const _sc=Math.min(cw/2,ch)*.45
        const _groundOff={mushroom:.48,rocket:.50,snowman:.48,lamp:.48,crystal:.54,hourglass:.46,cube:.28,sphere:.38,torus:.147,octahedron:.44,cone:.42}
        const _gY=ch*.75,_off=_groundOff[practiceObject.type]??0.46,_cy=_gY-_sc*_off
        ctx.beginPath();ctx.moveTo(cw*.04,_gY);ctx.lineTo(cw*.46,_gY)
        ctx.strokeStyle='rgba(100,96,90,0.35)';ctx.lineWidth=1.5;ctx.setLineDash([]);ctx.stroke()
        drawCompound(ctx,practiceObject,cw/4,_cy,_sc,practiceStyle)
      }
    } else if(photoLayerCanvas.current&&refImageEl.current){
      ctx.globalAlpha=refOpacity/100
      ctx.drawImage(photoLayerCanvas.current,0,0)
      ctx.globalAlpha=1
    }
    // Paper: clip to right half so photo shows on left
    const paper=layers.find(l=>l.isPaper)
    if(paper?.visible){
      const lc=layerCanvases.current[paper.id];if(lc){
        ctx.save();ctx.beginPath();ctx.rect(cw/2,0,cw/2,ch);ctx.clip()
        ctx.globalAlpha=paper.opacity/100;ctx.drawImage(lc,0,0);ctx.globalAlpha=1
        ctx.restore()
      }
    }
    // ── Reference / practice overlay on right half (trace guide) ──
    if(!practiceMode&&refOverlay&&photoLayerCanvas.current){
      // src: left half of photoLayerCanvas → dst: right half of display
      ctx.save();ctx.beginPath();ctx.rect(cw/2,0,cw/2,ch);ctx.clip()
      ctx.globalAlpha=refOverlayOpacity/100
      ctx.drawImage(photoLayerCanvas.current,0,0,cw/2,ch,cw/2,0,cw/2,ch)
      ctx.globalAlpha=1;ctx.restore()
    }
    if(practiceMode&&practiceOverlay){
      ctx.save();ctx.beginPath();ctx.rect(cw/2,0,cw/2,ch);ctx.clip()
      ctx.globalAlpha=practiceOverlayOpacity/100
      if(practiceCategory==='flat'){
        drawFlatPractice(ctx,practiceObject,cw/2,ch,flatStyle,cw/2,0)
      } else if(threeRef.current?.rendered){
        ctx.drawImage(threeRef.current.renderer.domElement,cw/2,0,cw/2,ch)
      }
      ctx.globalAlpha=1;ctx.restore()
    }
    // Drawing layers: full canvas, bottom to top
    const dl=layers.filter(l=>!l.isPaper)
    for(const l of dl){
      if(!l.visible)continue
      const lc=layerCanvases.current[l.id];if(!lc)continue
      ctx.globalAlpha=l.opacity/100;ctx.drawImage(lc,0,0);ctx.globalAlpha=1
    }
    // Grid — drawn independently for each half
    if(showGrid){
      ctx.globalAlpha=gridOpacity/100;ctx.strokeStyle='#3366ff';ctx.setLineDash([])
      const drawHalfGrid=(x0,hw)=>{
        ctx.save();ctx.beginPath();ctx.rect(x0,0,hw,ch);ctx.clip()
        if(gridSize<0){
          const n=-gridSize;ctx.lineWidth=1.5
          for(let i=1;i<n;i++){const x=x0+hw*i/n;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,ch);ctx.stroke()}
          for(let i=1;i<n;i++){const y=ch*i/n;ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x0+hw,y);ctx.stroke()}
        } else {
          ctx.lineWidth=1
          for(let x=x0;x<=x0+hw+1;x+=gridSize){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,ch);ctx.stroke()}
          for(let y=0;y<=ch+1;y+=gridSize){ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x0+hw,y);ctx.stroke()}
        }
        ctx.restore()
      }
      drawHalfGrid(0,cw/2)
      drawHalfGrid(cw/2,cw/2)
      ctx.globalAlpha=1
    }
    // Center divider guide
    ctx.save();ctx.globalAlpha=.18;ctx.strokeStyle='#888';ctx.lineWidth=1;ctx.setLineDash([])
    ctx.beginPath();ctx.moveTo(cw/2,0);ctx.lineTo(cw/2,ch);ctx.stroke();ctx.restore()
    // Selection / transform preview
    const xform=xfRef.current
    if(xform){
      const {rect,angle,content,origRect:or}=xform,mcx=rect.x+rect.w/2,mcy=rect.y+rect.h/2
      ctx.save();ctx.translate(mcx,mcy);ctx.rotate(angle)
      ctx.drawImage(content,(or||rect).x,(or||rect).y,(or||rect).w,(or||rect).h,-rect.w/2,-rect.h/2,rect.w,rect.h)
      ctx.restore()
    } else if(selRef.current){drawSelPath(ctx,selRef.current)}
    // Pen/eraser shift guide: + and ×
    if(isDrawing.current&&shiftKeyRef.current&&penStrokeStart.current){
      const {activeTool:at}=S.current
      if(at===TOOLS.PEN||at===TOOLS.ERASER){
        const {x:gx,y:gy}=penStrokeStart.current
        const gl=Math.max(cw,ch)*2,gd=gl*Math.SQRT1_2
        ctx.save();ctx.beginPath();ctx.rect(cw/2,0,cw/2,ch);ctx.clip()
        ctx.strokeStyle='rgba(80,120,255,0.28)';ctx.lineWidth=1;ctx.setLineDash([4,8])
        ctx.beginPath()
        ctx.moveTo(gx-gl,gy);ctx.lineTo(gx+gl,gy)
        ctx.moveTo(gx,gy-gl);ctx.lineTo(gx,gy+gl)
        ctx.moveTo(gx-gd,gy-gd);ctx.lineTo(gx+gd,gy+gd)
        ctx.moveTo(gx+gd,gy-gd);ctx.lineTo(gx-gd,gy+gd)
        ctx.stroke();ctx.restore()
      }
    }
  },[])

  useEffect(()=>{compRef.current=comp},[comp])
  useEffect(()=>{comp()},[comp,rev])
  useEffect(()=>{comp()},[comp,showGrid,gridSize,gridOpacity])
  useEffect(()=>{comp()},[comp,refOpacity])
  useEffect(()=>{comp()},[comp,layers])
  useEffect(()=>{comp()},[comp,practiceStyle,practiceMode,practiceObject,practiceCategory,flatStyle,refOverlay,refOverlayOpacity,practiceOverlay,practiceOverlayOpacity])
  useEffect(()=>{
    if(activeTool!==TOOLS.RULER&&placingRulerIdRef.current){
      setRulers(rs=>rs.filter(r=>r.id!==placingRulerIdRef.current))
      placingRulerIdRef.current=null;placingRulerStartRef.current=null
    }
  },[activeTool])
  const prevCvRef=useRef({w:DEFAULT_W,h:DEFAULT_H})
  useEffect(()=>{
    const{w:pw,h:ph}=prevCvRef.current
    if(pw!==cvW||ph!==cvH){
      const sx=cvW/pw,sy=cvH/ph
      setRulers(rs=>rs.map(r=>({...r,x1:r.x1*sx,y1:r.y1*sy,x2:r.x2*sx,y2:r.y2*sy})))
      prevCvRef.current={w:cvW,h:cvH}
    }
  },[cvW,cvH])

  useEffect(()=>{
    const el=drawAreaRef.current;if(!el)return
    const onWheel=e=>{
      e.preventDefault()
      const disp=displayRef.current
      if(disp&&S.current.practiceMode&&!S.current.practiceDrawMode){
        const r=disp.getBoundingClientRect()
        if(e.clientX<r.left+r.width/2){
          setPracticeOrbit(o=>({...o,zoom:Math.max(.25,Math.min(4,o.zoom*(e.deltaY>0?.88:1.14)))}))
          return
        }
      }
      setViewZoom(z=>Math.round(Math.min(400,Math.max(20,z*Math.pow(0.999,e.deltaY)))))
    }
    el.addEventListener('wheel',onWheel,{passive:false})
    return()=>el.removeEventListener('wheel',onWheel)
  },[])

  // ── Three.js scene ────────────────────────────────────────────
  useEffect(()=>{
    if(!practiceMode||!practiceObject||practiceCategory==='flat'){
      if(threeRef.current)threeRef.current.rendered=false
      compRef.current?.();return
    }
    const {w:cw,h:ch}=cvRef.current
    if(!threeRef.current){
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
      renderer.setSize(Math.round(cw/2),ch);renderer.setPixelRatio(1)
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap
      threeRef.current={renderer,rendered:false}
    } else {
      threeRef.current.renderer.setSize(Math.round(cw/2),ch)
    }
    const {renderer}=threeRef.current
    const {rx=.3,ry=.2,rz=0,zoom=1}=practiceOrbit
    const dist=4.2/Math.max(.2,zoom)
    const camera=new THREE.PerspectiveCamera(38,(cw/2)/ch,.1,100)
    camera.position.set(dist*Math.sin(ry)*Math.cos(rx),dist*Math.sin(rx),dist*Math.cos(ry)*Math.cos(rx))
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
    const mat=buildThreeMat(practiceStyle)
    const obj3d=buildThreeObj(practiceObject.type,mat,practiceStyle)
    if(obj3d){
      obj3d.rotation.z=rz
      if(!isWire)obj3d.traverse(o=>{if(o.isMesh)o.castShadow=true})
      obj3d.updateMatrixWorld(true)
      const box=new THREE.Box3().setFromObject(obj3d)
      obj3d.position.y=-1.38-box.min.y
      obj3d.updateMatrixWorld(true)
      const box2=new THREE.Box3().setFromObject(obj3d)
      // pyramid: look at lower 30% so tip is prominent; others: bounding box center
      const lookY=practiceObject.type==='pyramid'
        ?box2.min.y+(box2.max.y-box2.min.y)*.3
        :box2.getCenter(new THREE.Vector3()).y
      camera.lookAt(0,lookY,0)
      scene.add(obj3d)
    }
    renderer.render(scene,camera)
    threeRef.current.rendered=true
    compRef.current?.();tick()
    return()=>{
      scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}})
    }
  },[practiceObject,practiceStyle,practiceMode,practiceOrbit,practiceCategory,cvW,cvH])

  useEffect(()=>{
    if(!practiceMode&&threeRef.current){
      threeRef.current.renderer.dispose();threeRef.current=null;compRef.current?.()
    }
  },[practiceMode])

  const tick=useCallback(()=>setRev(r=>r+1),[])

  const TOOL_SNAP=4
  const MOVE_SHIFT_STEP=8
  const startToolDrag=useCallback((toolId,e,initialPos)=>{
    const startMX=e.clientX,startMY=e.clientY
    let latest=null
    const move=me=>{
      const raw_x=initialPos.x+(me.clientX-startMX),raw_y=initialPos.y+(me.clientY-startMY)
      const nx=Math.round(raw_x/TOOL_SNAP)*TOOL_SNAP,ny=Math.round(raw_y/TOOL_SNAP)*TOOL_SNAP
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
      case'ruler':return<TB label="定規" active={showRuler} onClick={()=>{if(showRuler){setShowRuler(false);setRulers([]);setActiveRulerId(null);placingRulerIdRef.current=null;placingRulerStartRef.current=null}else{setShowRuler(true);setActiveTool(TOOLS.RULER)}}}><RulerIcon/></TB>
      case'grid':return<TB label="マス目" active={showGrid} onClick={()=>setShowGrid(v=>!v)}><GridIcon/></TB>
      case'hand':return<TB label="手のひら移動 (H)" active={activeTool===TOOLS.HAND} onClick={()=>setActiveTool(TOOLS.HAND)}><HandIcon/></TB>
      default:return null
    }
  },[activeTool,showRuler,showGrid])

  const toPt=e=>{
    const disp=displayRef.current;if(!disp)return{x:0,y:0}
    const r=disp.getBoundingClientRect()
    const {w:cw,h:ch}=cvRef.current
    return{x:(e.clientX-r.left)*(cw/r.width),y:(e.clientY-r.top)*(ch/r.height)}
  }

  // ── Handlers ──────────────────────────────────────────────────
  const onPointerDown=e=>{
    const disp=displayRef.current;if(!disp)return
    const r=disp.getBoundingClientRect()
    const isLeftHalf=e.clientX<r.left+r.width/2
    // Orbit: practice mode, not draw mode, left half
    if(S.current.practiceMode&&!S.current.practiceDrawMode&&isLeftHalf){
      e.preventDefault()
      const {rx,ry,rz,zoom}=S.current.practiceOrbit
      orbitDragStart.current={x:e.clientX,y:e.clientY,rx,ry,rz,zoom}
      disp.setPointerCapture(e.pointerId);return
    }
    // Hand tool pan
    if(S.current.activeTool===TOOLS.HAND){
      e.preventDefault()
      panStartRef.current={px:e.clientX,py:e.clientY,ox:panOffsetRef.current.x,oy:panOffsetRef.current.y}
      disp.setPointerCapture(e.pointerId);return
    }
    if(xfRef.current)return;e.preventDefault()
    const pt=toPt(e)
    const {activeTool,penColor,penSize,eraserSize}=S.current
    const activeSize=activeTool===TOOLS.ERASER?eraserSize:penSize
    const draw=S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId]
    disp.setPointerCapture(e.pointerId)
    if(activeTool===TOOLS.RULER){
      if(placingRulerIdRef.current){
        // 2nd tap: finalize end point
        const rsnap=e.shiftKey&&placingRulerStartRef.current
          ?applySnap(pt,{angleSnap:true,lineFrom:placingRulerStartRef.current}):pt
        setRulers(rs=>rs.map(r=>r.id===placingRulerIdRef.current?{...r,x2:rsnap.x,y2:rsnap.y}:r))
        placingRulerIdRef.current=null;placingRulerStartRef.current=null
      } else {
        // 1st tap: set start point
        const nid=Date.now()
        const{rulerType:rt,rulerDivisions:rd,rulerColor:rc}=S.current
        setRulers(rs=>[...rs,{id:nid,x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y,type:rt,divisions:rd,color:rc}])
        setActiveRulerId(nid);placingRulerIdRef.current=nid;placingRulerStartRef.current={x:pt.x,y:pt.y}
      }
      return
    }
    if(activeTool===TOOLS.SELECT){
      const sel=selRef.current
      if(sel&&inRect(pt,sel)){
        isDrawing.current=true;selMoveStart.current=pt;selMoveOrigR.current={...sel}
        if(draw){
          const {w:cw,h:ch}=cvRef.current
          const snap=document.createElement('canvas');snap.width=cw;snap.height=ch
          snap.getContext('2d').drawImage(draw,0,0);selMoveSnap.current=snap
          const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,sel);ctx.clearRect(0,0,cw,ch);ctx.restore();comp()
        }
      } else {isDrawing.current=true;selPtsRef.current=[pt];setSel(null);comp()}
      return
    }
    isDrawing.current=true;lastPt.current=pt
    if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){
      const ctx=draw?.getContext('2d');if(!ctx)return
      saveHist()
      penStrokeStart.current=pt;penSnapDirRef.current=null;lastClientXY.current={x:e.clientX,y:e.clientY}
      const pr=e.pointerType==='pen'?Math.max(0.05,e.pressure):1
      const sz=Math.max(1,activeSize*pr)
      ctx.globalCompositeOperation=activeTool===TOOLS.ERASER?'destination-out':'source-over'
      ctx.fillStyle=activeTool===TOOLS.ERASER?'rgba(0,0,0,1)':penColor
      ctx.beginPath();ctx.arc(pt.x,pt.y,sz/2,0,Math.PI*2);ctx.fill()
      const {w:_cw,h:_ch}=cvRef.current
      const _snap=document.createElement('canvas');_snap.width=_cw;_snap.height=_ch
      _snap.getContext('2d').drawImage(draw,0,0);penShiftSnapRef.current=_snap
      comp();tick()
    } else if(activeTool===TOOLS.LINE){
      const {showGrid:sg,gridSize:gs}=S.current
      const spt=e.shiftKey&&sg?applySnap(pt,{gridSnap:true,gridSize:gs}):pt
      lineStart.current=spt;lineStartScreen.current={x:e.clientX,y:e.clientY}
      saveHist()
    } else if(activeTool===TOOLS.MOVE){
      const {w:cw,h:ch}=cvRef.current
      moveOrigin.current=pt;saveHist()
      if(draw){const s=document.createElement('canvas');s.width=cw;s.height=ch;s.getContext('2d').drawImage(draw,0,0);moveSnap.current=s}
    }
  }

  const onPointerMove=e=>{
    // Custom cursor update
    if(cursorDivRef.current&&displayRef.current){
      const at=S.current.activeTool
      if(at===TOOLS.PEN||at===TOOLS.ERASER){
        const r=displayRef.current.getBoundingClientRect()
        const scale=r.width/cvRef.current.w
        const sz=at===TOOLS.ERASER?S.current.eraserSize:S.current.penSize
        const radius=Math.max(0.5,sz/2*scale)
        const d=cursorDivRef.current
        d.style.left=e.clientX+'px';d.style.top=e.clientY+'px'
        d.style.width=(radius*2)+'px';d.style.height=(radius*2)+'px'
        const cross=d.querySelector('.cur-cross')
        if(cross)cross.style.opacity=radius<5?'1':'0'
      }
    }
    // Orbit drag
    if(orbitDragStart.current){
      const dx=e.clientX-orbitDragStart.current.x,dy=e.clientY-orbitDragStart.current.y
      const s=orbitDragStart.current
      if(e.shiftKey){setPracticeOrbit(o=>({...o,rz:s.rz+dx*.013}))}
      else{setPracticeOrbit(o=>({...o,rx:Math.max(-Math.PI*.48,Math.min(Math.PI*.48,s.rx-dy*.013)),ry:s.ry+dx*.013}))}
      return
    }
    // Pan drag
    if(panStartRef.current){
      let nx=panStartRef.current.ox+(e.clientX-panStartRef.current.px)
      let ny=panStartRef.current.oy+(e.clientY-panStartRef.current.py)
      if(e.shiftKey){
        const ddx=nx-panStartRef.current.ox,ddy=ny-panStartRef.current.oy
        if(Math.abs(ddx)>=Math.abs(ddy)){ny=panStartRef.current.oy;nx=panStartRef.current.ox+Math.round(ddx/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
        else{nx=panStartRef.current.ox;ny=panStartRef.current.oy+Math.round(ddy/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
      }
      panOffsetRef.current={x:nx,y:ny};setPanOffset({x:nx,y:ny});return
    }
    // Ruler preview: runs before isDrawing check (tap-based, no drag needed)
    if(placingRulerIdRef.current&&S.current.activeTool===TOOLS.RULER){
      const pid=placingRulerIdRef.current,pt0=toPt(e)
      const rsnap=e.shiftKey&&placingRulerStartRef.current
        ?applySnap(pt0,{angleSnap:true,lineFrom:placingRulerStartRef.current}):pt0
      setRulers(rs=>rs.map(r=>r.id===pid?{...r,x2:rsnap.x,y2:rsnap.y}:r));return
    }
    if(!isDrawing.current)return
    const pt=toPt(e)
    const {activeTool,penColor,penSize,eraserSize}=S.current
    const activeSize=activeTool===TOOLS.ERASER?eraserSize:penSize
    const draw=S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId]
    if(activeTool===TOOLS.SELECT){
      if(selMoveStart.current&&selMoveSnap.current){
        const {w:cw,h:ch}=cvRef.current
        let dx=pt.x-selMoveStart.current.x,dy=pt.y-selMoveStart.current.y
        if(e.shiftKey){
          if(Math.abs(dx)>=Math.abs(dy)){dy=0;dx=Math.round(dx/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
          else{dx=0;dy=Math.round(dy/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
        }
        const orig=selMoveOrigR.current;if(!draw)return
        const ctx=draw.getContext('2d')
        ctx.clearRect(0,0,cw,ch);ctx.drawImage(selMoveSnap.current,0,0)
        ctx.save();applySelClip(ctx,orig);ctx.clearRect(0,0,cw,ch);ctx.restore()
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
        setSel({pts,x,y,w,h});comp()
      }
      return
    }
    if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){
      const ctx=draw?.getContext('2d');if(!ctx)return
      const pr=e.pointerType==='pen'?Math.max(0.05,e.pressure):1
      const sz=Math.max(1,activeSize*pr)
      ctx.globalCompositeOperation=activeTool===TOOLS.ERASER?'destination-out':'source-over'
      ctx.strokeStyle=activeTool===TOOLS.ERASER?'rgba(0,0,0,1)':penColor
      ctx.lineWidth=sz;ctx.lineCap='round';ctx.lineJoin='round'
      if(e.shiftKey&&penStrokeStart.current&&penShiftSnapRef.current){
        const snapped=applySnap(pt,{angleSnap:true,lineFrom:penStrokeStart.current})
        const {w:cw2,h:ch2}=cvRef.current
        const prevComp=ctx.globalCompositeOperation
        ctx.globalCompositeOperation='source-over'
        ctx.clearRect(0,0,cw2,ch2);ctx.drawImage(penShiftSnapRef.current,0,0)
        ctx.globalCompositeOperation=prevComp
        ctx.beginPath();ctx.moveTo(penStrokeStart.current.x,penStrokeStart.current.y);ctx.lineTo(snapped.x,snapped.y);ctx.stroke()
        lastPt.current=snapped
      } else {
        ctx.beginPath();ctx.moveTo(lastPt.current.x,lastPt.current.y);ctx.lineTo(pt.x,pt.y);ctx.stroke()
        lastPt.current=pt
      }
      lastClientXY.current={x:e.clientX,y:e.clientY}
      comp();tick()
    } else if(activeTool===TOOLS.LINE&&lineStart.current&&lineStartScreen.current){
      comp()
      const disp=displayRef.current;if(!disp)return
      const {w:cw,h:ch}=cvRef.current
      let ex=e.clientX,ey=e.clientY
      const sx=lineStartScreen.current.x,sy=lineStartScreen.current.y
      if(e.shiftKey){const a=Math.round(Math.atan2(ey-sy,ex-sx)/(Math.PI/4))*(Math.PI/4);const l=Math.sqrt((ex-sx)**2+(ey-sy)**2);ex=sx+Math.cos(a)*l;ey=sy+Math.sin(a)*l}
      const rr=disp.getBoundingClientRect()
      const seg=clipLineToBBox(sx,sy,ex,ey,rr.left,rr.top,rr.right,rr.bottom)
      if(seg){
        const p1=screenToCv(seg[0],seg[1],rr,cw,ch),p2=screenToCv(seg[2],seg[3],rr,cw,ch)
        const ctx=disp.getContext('2d')
        ctx.strokeStyle=S.current.penColor;ctx.lineWidth=S.current.penSize;ctx.lineCap='round'
        ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()
      }
    } else if(activeTool===TOOLS.MOVE&&moveOrigin.current&&moveSnap.current){
      const {w:cw,h:ch}=cvRef.current
      const ctx=draw?.getContext('2d');if(!ctx)return
      let ox=pt.x-moveOrigin.current.x,oy=pt.y-moveOrigin.current.y
      if(e.shiftKey){
        if(Math.abs(ox)>=Math.abs(oy)){oy=0;ox=Math.round(ox/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
        else{ox=0;oy=Math.round(oy/MOVE_SHIFT_STEP)*MOVE_SHIFT_STEP}
      }
      ctx.clearRect(0,0,cw,ch);ctx.drawImage(moveSnap.current,ox,oy)
      comp();tick()
    }
  }

  const onPointerUp=e=>{
    if(orbitDragStart.current){orbitDragStart.current=null;return}
    if(panStartRef.current){panStartRef.current=null;return}
    if(!isDrawing.current)return;isDrawing.current=false
    const pt=toPt(e)
    const {activeTool}=S.current
    const draw=S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId]
    if(activeTool===TOOLS.RULER){return}
    if(activeTool===TOOLS.SELECT){
      if(selMoveStart.current){selMoveStart.current=null;selMoveSnap.current=null;selMoveOrigR.current=null;comp();tick()}
      else if(selPtsRef.current.length>1){
        const pts=[...selPtsRef.current,selPtsRef.current[0]]
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y)
        const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y
        setSel({pts,x,y,w,h});comp();selPtsRef.current=[]
      }
      return
    }
    if(activeTool===TOOLS.LINE&&lineStart.current&&lineStartScreen.current){
      const {penColor:pc,penSize:ps}=S.current
      const ex0=e.clientX,ey0=e.clientY
      const sx=lineStartScreen.current.x,sy=lineStartScreen.current.y
      const isTap=Math.sqrt((ex0-sx)**2+(ey0-sy)**2)<5
      lineStart.current=null;lineStartScreen.current=null
      const disp=displayRef.current;const {w:cw,h:ch}=cvRef.current
      if(isTap){
        if(draw){const ctx=draw.getContext('2d');ctx.globalCompositeOperation='source-over';ctx.strokeStyle=pc;ctx.lineWidth=ps;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,pt.y);ctx.lineTo(cw,pt.y);ctx.stroke()}
        comp();tick()
      } else {
        let ex=ex0,ey=ey0
        if(e.shiftKey){const a=Math.round(Math.atan2(ey-sy,ex-sx)/(Math.PI/4))*(Math.PI/4);const l=Math.sqrt((ex-sx)**2+(ey-sy)**2);ex=sx+Math.cos(a)*l;ey=sy+Math.sin(a)*l}
        if(disp&&draw){
          const rr=disp.getBoundingClientRect()
          const seg=clipLineToBBox(sx,sy,ex,ey,rr.left,rr.top,rr.right,rr.bottom)
          if(seg){
            const p1=screenToCv(seg[0],seg[1],rr,cw,ch),p2=screenToCv(seg[2],seg[3],rr,cw,ch)
            const ctx=draw.getContext('2d')
            ctx.globalCompositeOperation='source-over';ctx.strokeStyle=pc;ctx.lineWidth=ps;ctx.lineCap='round'
            ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()
          }
        }
        comp();tick()
      }
      saveHist();return
    }
    if(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER){saveHist()}
    else if(activeTool===TOOLS.MOVE){saveHist()}
    penSnapDirRef.current=null;penShiftSnapRef.current=null;lastClientXY.current=null
    const ctx2=draw?.getContext('2d');if(ctx2)ctx2.globalCompositeOperation='source-over'
    moveSnap.current=null;lastPt.current=null
  }
  const onPointerEnter=e=>{setIsCursorOnCanvas(true);if(!e.buttons||isDrawing.current)return;onPointerDown(e)}
  const onPointerLeave=()=>setIsCursorOnCanvas(false)

  // ── Selection helpers ─────────────────────────────────────────
  const applySelClip=(ctx,sel)=>{ctx.beginPath();if(sel.pts){sel.pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.closePath()}else{ctx.rect(sel.x,sel.y,sel.w,sel.h)};ctx.clip()}
  const deselect=()=>{setSel(null);comp()}
  const getActiveCanvas=()=>S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId]
  const deleteInSel=()=>{
    const {w:cw,h:ch}=cvRef.current
    if(!selRef.current)return;const draw=getActiveCanvas();if(!draw)return
    saveHist();const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,selRef.current);ctx.clearRect(0,0,cw,ch);ctx.restore();comp();tick()
  }
  const deleteOutSel=()=>{
    const {w:cw,h:ch}=cvRef.current
    if(!selRef.current)return;const draw=getActiveCanvas();if(!draw)return
    saveHist();const ctx=draw.getContext('2d')
    const tmp=document.createElement('canvas');tmp.width=cw;tmp.height=ch;tmp.getContext('2d').drawImage(draw,0,0)
    ctx.clearRect(0,0,cw,ch);ctx.save();applySelClip(ctx,selRef.current);ctx.drawImage(tmp,0,0);ctx.restore();comp();tick()
  }
  const fillSel=()=>{
    const {w:cw,h:ch}=cvRef.current
    if(!selRef.current)return;const draw=getActiveCanvas();if(!draw)return
    saveHist();const ctx=draw.getContext('2d')
    ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle=S.current.penColor
    applySelClip(ctx,selRef.current);ctx.fillRect(0,0,cw,ch);ctx.restore();comp();tick()
  }
  const startTransform=()=>{
    const {w:cw,h:ch}=cvRef.current
    if(!selRef.current)return;const draw=getActiveCanvas();if(!draw)return
    const r=selRef.current;const content=document.createElement('canvas');content.width=cw;content.height=ch
    content.getContext('2d').drawImage(draw,0,0)
    saveHist();const ctx=draw.getContext('2d');ctx.save();applySelClip(ctx,r);ctx.clearRect(0,0,cw,ch);ctx.restore()
    setXfState({rect:{x:r.x,y:r.y,w:r.w,h:r.h},angle:0,content,origRect:{x:r.x,y:r.y,w:r.w,h:r.h},origSel:{...r}});comp()
  }
  const updateXf=useCallback(patch=>{setXfState(prev=>{const next={...prev,...patch};xfRef.current=next;setTimeout(()=>compRef.current?.(),0);return next})},[])
  const commitXf=()=>{
    const {w:cw,h:ch}=cvRef.current
    if(!xfRef.current)return;const{rect,angle,content,origRect:or}=xfRef.current
    const draw=getActiveCanvas()
    if(draw){
      const ctx=draw.getContext('2d'),mcx=rect.x+rect.w/2,mcy=rect.y+rect.h/2
      const os=xfRef.current.origSel
      ctx.save();ctx.translate(mcx,mcy);ctx.rotate(angle)
      if(os?.pts&&or){
        const ocx=or.x+or.w/2,ocy=or.y+or.h/2,sx=or.w?rect.w/or.w:1,sy=or.h?rect.h/or.h:1
        ctx.beginPath();os.pts.forEach((p,i)=>{const lx=(p.x-ocx)*sx,ly=(p.y-ocy)*sy;i===0?ctx.moveTo(lx,ly):ctx.lineTo(lx,ly)});ctx.closePath();ctx.clip()
      }
      ctx.drawImage(content,(or||rect).x,(or||rect).y,(or||rect).w,(or||rect).h,-rect.w/2,-rect.h/2,rect.w,rect.h)
      ctx.restore()
    }
    setXfState(null);setSel(null);comp();tick()
  }
  const cancelXf=()=>{
    if(!xfRef.current)return;const{origRect,content}=xfRef.current
    const draw=S.current.activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[S.current.activeLayerId]
    if(draw)draw.getContext('2d').drawImage(content,origRect.x,origRect.y,origRect.w,origRect.h,origRect.x,origRect.y,origRect.w,origRect.h)
    setXfState(null);comp();tick()
  }

  // ── Undo / Redo ───────────────────────────────────────────────
  const getCanvas=key=>key===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[+key]
  const doUndo=()=>{
    const key=lastHistKey.current||String(activeLayerId)
    const st=histStacks.current[key];if(!st)return
    const p=histPtrs.current[key]??0;if(p<=0)return
    histPtrs.current[key]=p-1
    const c=getCanvas(key);if(c)c.getContext('2d').putImageData(st[p-1],0,0)
    comp();tick()
  }
  const doRedo=()=>{
    const key=lastHistKey.current||String(activeLayerId)
    const st=histStacks.current[key];if(!st)return
    const p=histPtrs.current[key]??0;if(p>=st.length-1)return
    histPtrs.current[key]=p+1
    const c=getCanvas(key);if(c)c.getContext('2d').putImageData(st[p+1],0,0)
    comp();tick()
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
    const onShiftDn=e=>{if(e.key==='Shift'){shiftKeyRef.current=true;compRef.current?.()}}
    const onShiftUp=e=>{if(e.key==='Shift'){shiftKeyRef.current=false;penSnapDirRef.current=null;penShiftSnapRef.current=null;compRef.current?.()}}
    window.addEventListener('keydown',h)
    window.addEventListener('keydown',onShiftDn)
    window.addEventListener('keyup',onShiftUp)
    return()=>{window.removeEventListener('keydown',h);window.removeEventListener('keydown',onShiftDn);window.removeEventListener('keyup',onShiftUp)}
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
  // 写真読み込み済み時に左半分へのドラッグで写真を置き換え
  const onCanvasDragOver=e=>{
    if(!refImage||practiceMode){return}
    const r=displayRef.current?.getBoundingClientRect();if(!r)return
    if(e.clientX<r.left+r.width/2){e.preventDefault();setPhotoAreaDragOver(true)}
    else setPhotoAreaDragOver(false)
  }
  const onCanvasDragLeave=()=>setPhotoAreaDragOver(false)
  const onCanvasDrop=e=>{
    setPhotoAreaDragOver(false)
    if(!refImage||practiceMode)return
    const r=displayRef.current?.getBoundingClientRect();if(!r)return
    if(e.clientX<r.left+r.width/2)onRefDrop(e)
  }
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
    setRefImage(null);refImageEl.current=null
    setAppliedCrop(null);setCropMode(false);setCropRect(null)
    if(photoLayerCanvas.current){photoLayerCanvas.current.width=1;photoLayerCanvas.current=null}
    delete histStacks.current[PHOTO_ID];delete histPtrs.current[PHOTO_ID]
    if(activeLayerId===PHOTO_ID)setActiveLayerId(1)
    const nw=DEFAULT_W,nh=DEFAULT_H
    setCvW(nw);setCvH(nh);cvRef.current={w:nw,h:nh}
    Object.entries(layerCanvases.current).forEach(([id,c])=>{
      c.width=nw;c.height=nh
      const ctx=c.getContext('2d');ctx.clearRect(0,0,nw,nh)
      if(+id===PAPER_ID){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,nw,nh)}
      const blank=ctx.getImageData(0,0,nw,nh)
      histStacks.current[String(id)]=[blank];histPtrs.current[String(id)]=0
    })
    lastHistKey.current=null;setRev(r=>r+1)
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
  const resetAllLayers=useCallback(()=>{
    if(!photoLayerCanvas.current||!histStacks.current[PHOTO_ID]?.[0])return
    photoLayerCanvas.current.getContext('2d').putImageData(histStacks.current[PHOTO_ID][0],0,0)
    histStacks.current[PHOTO_ID]=[histStacks.current[PHOTO_ID][0]];histPtrs.current[PHOTO_ID]=0
    lastHistKey.current=null;comp()
  },[comp])
  const clearActive=useCallback(()=>{
    const {w:cw,h:ch}=cvRef.current
    const lc=activeLayerId===PHOTO_ID?photoLayerCanvas.current:layerCanvases.current[activeLayerId];if(!lc)return
    const ctx=lc.getContext('2d'),isPaper=layers.find(l=>l.id===activeLayerId)?.isPaper
    saveHist()
    if(isPaper){ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,ch)}else{ctx.clearRect(0,0,cw,ch)}
    comp();tick()
  },[activeLayerId,layers,tick,saveHist,comp])
  const flatten=useCallback(()=>{
    const {w:cw,h:ch}=cvRef.current
    const m=document.createElement('canvas');m.width=cw;m.height=ch;const ctx=m.getContext('2d')
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
      // 用紙行(paper-row)を基準にする。写真行は最下段で移動不可
      const paperRow = listEl.querySelector('.paper-row')
      const paperIdx = paperRow ? rows.indexOf(paperRow) : rows.length-1
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
        if(item?.type==='photo') setActiveLayerId(PHOTO_ID)
        else if(item?.type==='layer'&&!item.layer.isPaper) setActiveLayerId(item.layer.id)
      }
      // ドラッグ確定（写真行は対象外）
      if(moved && srcIdx!==null && di!==null && srcIdx!==di){
        const srcItem=listItemsRef.current[srcIdx]
        if(srcItem?.type==='photo'){/* 写真行は並べ替え不可 */}else{
          const items=[...listItemsRef.current]
          const [moved2]=items.splice(srcIdx,1)
          items.splice(di>srcIdx?di-1:di,0,moved2)
          const newDrawing=[]
          for(let i=items.length-1;i>=0;i--){
            const it=items[i]
            if(it.type==='photo') continue  // 写真行はスキップ
            if(!it.layer.isPaper) newDrawing.push(it.layer)
          }
          setLayers(prev=>[prev.find(l=>l.isPaper),...newDrawing])
          setTimeout(()=>compRef.current?.(),0)
        }
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
  },[setActiveLayerId,setLayers])

  // ── Crop helpers ──────────────────────────────────────────────
  const startCrop=()=>{
    const {w:cw,h:ch}=cvRef.current
    setCropRect({x1:0,y1:0,x2:cw/2,y2:ch});setCropMode(true)
  }
  const cancelCrop=()=>{setCropMode(false);setCropRect(null)}
  const applyCrop=()=>{
    if(!cropRect||!refImageEl.current)return
    const img=refImageEl.current
    const {w:oldW,h:oldH}=cvRef.current
    const {x1,y1,x2,y2}=cropRect
    const cropW=x2-x1,cropH=y2-y1
    if(cropW<10||cropH<10)return
    const newW=cropW*2,newH=cropH
    // source region in image natural coords (photo fills left half: 0,0 → oldW/2,oldH)
    const sx=x1*img.naturalWidth/(oldW/2)
    const sy=y1*img.naturalHeight/oldH
    const sw=cropW*img.naturalWidth/(oldW/2)
    const sh=cropH*img.naturalHeight/oldH
    setCvW(newW);setCvH(newH);cvRef.current={w:newW,h:newH}
    Object.entries(layerCanvases.current).forEach(([id,c])=>{
      c.width=newW;c.height=newH
      const ctx=c.getContext('2d')
      if(+id===PAPER_ID){ctx.fillStyle='#fff';ctx.fillRect(0,0,newW,newH)}
      const blank=ctx.getImageData(0,0,newW,newH)
      histStacks.current[String(id)]=[blank];histPtrs.current[String(id)]=0
    })
    if(!photoLayerCanvas.current)photoLayerCanvas.current=document.createElement('canvas')
    const plc=photoLayerCanvas.current;plc.width=newW;plc.height=newH
    const pctx=plc.getContext('2d');pctx.clearRect(0,0,newW,newH)
    pctx.drawImage(img,sx,sy,sw,sh,0,0,newW/2,newH)
    histStacks.current[PHOTO_ID]=[pctx.getImageData(0,0,newW,newH)];histPtrs.current[PHOTO_ID]=0
    setAppliedCrop({origW:oldW,origH:oldH})
    setCropMode(false);setCropRect(null)
    setRev(r=>r+1)
  }
  const resetCrop=()=>{
    if(!appliedCrop||!refImageEl.current)return
    const img=refImageEl.current
    const {origW,origH}=appliedCrop
    setCvW(origW);setCvH(origH);cvRef.current={w:origW,h:origH}
    Object.entries(layerCanvases.current).forEach(([id,c])=>{
      c.width=origW;c.height=origH
      const ctx=c.getContext('2d')
      if(+id===PAPER_ID){ctx.fillStyle='#fff';ctx.fillRect(0,0,origW,origH)}
      const blank=ctx.getImageData(0,0,origW,origH)
      histStacks.current[String(id)]=[blank];histPtrs.current[String(id)]=0
    })
    if(!photoLayerCanvas.current)photoLayerCanvas.current=document.createElement('canvas')
    const plc=photoLayerCanvas.current;plc.width=origW;plc.height=origH
    const pctx=plc.getContext('2d');pctx.clearRect(0,0,origW,origH)
    pctx.drawImage(img,0,0,origW/2,origH)
    histStacks.current[PHOTO_ID]=[pctx.getImageData(0,0,origW,origH)];histPtrs.current[PHOTO_ID]=0
    setAppliedCrop(null)
    setRev(r=>r+1)
  }
  const onCropHandleDown=(handle,initRect,e)=>{
    e.preventDefault();e.stopPropagation()
    const startX=e.clientX,startY=e.clientY
    const {w:cw,h:ch}=cvRef.current
    const r=displayRef.current?.getBoundingClientRect()
    const scale=r?r.width/cw:1
    const fw=cw/2,fh=ch,MIN=10
    const onMove=ev=>{
      const dx=(ev.clientX-startX)/scale,dy=(ev.clientY-startY)/scale
      let {x1,y1,x2,y2}=initRect
      if(handle==='tl'||handle==='l'||handle==='bl')x1=Math.min(initRect.x2-MIN,Math.max(0,initRect.x1+dx))
      if(handle==='tr'||handle==='r'||handle==='br')x2=Math.max(initRect.x1+MIN,Math.min(fw,initRect.x2+dx))
      if(handle==='tl'||handle==='t'||handle==='tr')y1=Math.min(initRect.y2-MIN,Math.max(0,initRect.y1+dy))
      if(handle==='bl'||handle==='b'||handle==='br')y2=Math.max(initRect.y1+MIN,Math.min(fh,initRect.y2+dy))
      if(handle==='c'){
        const w=initRect.x2-initRect.x1,h=initRect.y2-initRect.y1
        x1=Math.max(0,Math.min(fw-w,initRect.x1+dx));x2=x1+w
        y1=Math.max(0,Math.min(fh-h,initRect.y1+dy));y2=y1+h
      }
      setCropRect({x1:Math.round(x1),y1:Math.round(y1),x2:Math.round(x2),y2:Math.round(y2)})
    }
    const onUp=()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp)}
    document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp)
  }

  // ── Derived ───────────────────────────────────────────────────
  const drawingLayers=layers.filter(l=>!l.isPaper)
  const paperLayer=layers.find(l=>l.isPaper)
  const activeLayer=layers.find(l=>l.id===activeLayerId)
  const selCanvasEl=displayRef.current
  const xfCanvasEl=displayRef.current
  const cursor={[TOOLS.PEN]:'none',[TOOLS.ERASER]:'none',[TOOLS.MOVE]:'move',[TOOLS.SELECT]:'crosshair',[TOOLS.LINE]:'crosshair',[TOOLS.RULER]:'crosshair',[TOOLS.HAND]:panStartRef.current?'grabbing':'grab'}[activeTool]

  const buildListItems=()=>{
    const items=[],dlRev=[...drawingLayers].reverse()
    dlRev.forEach(l=>items.push({type:'layer',layer:l}))
    if(refImage)items.push({type:'photo'})
    if(paperLayer)items.push({type:'layer',layer:paperLayer})
    return items
  }
  const listItems=buildListItems()
  listItemsRef.current=listItems

  const resizePracticeCanvas=useCallback((nw,nh)=>{
    setCvW(nw);setCvH(nh);cvRef.current={w:nw,h:nh}
    Object.entries(layerCanvases.current).forEach(([id,c])=>{
      c.width=nw;c.height=nh
      const ctx=c.getContext('2d')
      if(+id===PAPER_ID){ctx.fillStyle='#fff';ctx.fillRect(0,0,nw,nh)}
      const blank=ctx.getImageData(0,0,nw,nh)
      histStacks.current[String(id)]=[blank];histPtrs.current[String(id)]=0
    })
    lastHistKey.current=null;setRev(r=>r+1)
  },[])
  const startPractice=()=>{
    setPracticeCategory('3d')
    const obj=genCompound();practiceObjRef.current=obj;setPracticeObject({...obj});setPracticeMode(true)
    const phi=.18+obj.ep*.52, theta=obj.rot*8+obj.skX*3
    setPracticeOrbit({rx:phi,ry:theta,rz:0,zoom:1})
    // default canvas size for practice if still at initial default
    if(cvRef.current.w===DEFAULT_W&&cvRef.current.h===DEFAULT_H){
      resizePracticeCanvas(1200,600)
    }
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

      <SelectionStrip sel={_selRect} canvasEl={selCanvasEl} cvW={cvW} cvH={cvH} onDeselect={deselect}
        onDelete={deleteInSel} onDeleteOut={deleteOutSel} onFill={fillSel} onTransform={startTransform}/>
      {xf&&<TransformOverlay xf={xf} canvasEl={xfCanvasEl} cvW={cvW} cvH={cvH} onUpdate={updateXf} onCommit={commitXf} onCancel={cancelXf}/>}

      <header className="toolbar">
        <button className="menu-btn" onClick={()=>setShowMenu(v=>!v)} title="メニュー"><MenuIcon/></button>
        <div className="tb-spacer"/>
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
            <button className="tool-btn" onClick={clearActive} title="レイヤーをクリア"><ClearLayerIcon/></button>
            <button className="tool-btn" onClick={resetAllLayers} title="参考画像を初期状態にリセット" style={{color:'#e07070'}}><ResetIcon/></button>
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
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
              <div style={{position:'relative',flexShrink:0,
                width:dispSize.w||cvW,height:dispSize.h||cvH,
                transform:(viewZoom!==100||panOffset.x||panOffset.y)?`translate(${panOffset.x}px,${panOffset.y}px) scale(${viewZoom/100})`:'none',
                transformOrigin:'center'}}>
                <canvas ref={displayRef} width={cvW} height={cvH}
                  style={{width:'100%',height:'100%',display:'block',cursor,touchAction:'none'}}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerEnter={onPointerEnter}
                  onPointerLeave={onPointerLeave}
                  onDragOver={onCanvasDragOver}
                  onDragLeave={onCanvasDragLeave}
                  onDrop={onCanvasDrop}/>
                {showRuler&&<RulerOverlay w={cvW} h={cvH} rulers={rulers} activeRulerId={activeRulerId}/>}
                {cropMode&&cropRect&&(
                  <div style={{position:'absolute',top:0,left:0,width:'50%',height:'100%',pointerEvents:'none',zIndex:8}}>
                    <svg width="100%" height="100%" viewBox={`0 0 ${cvW/2} ${cvH}`}
                      style={{position:'absolute',inset:0,overflow:'visible',pointerEvents:'auto'}}>
                      <rect x={0} y={0} width={cvW/2} height={cropRect.y1} fill="rgba(0,0,0,.5)" style={{pointerEvents:'none'}}/>
                      <rect x={0} y={cropRect.y2} width={cvW/2} height={cvH-cropRect.y2} fill="rgba(0,0,0,.5)" style={{pointerEvents:'none'}}/>
                      <rect x={0} y={cropRect.y1} width={cropRect.x1} height={cropRect.y2-cropRect.y1} fill="rgba(0,0,0,.5)" style={{pointerEvents:'none'}}/>
                      <rect x={cropRect.x2} y={cropRect.y1} width={cvW/2-cropRect.x2} height={cropRect.y2-cropRect.y1} fill="rgba(0,0,0,.5)" style={{pointerEvents:'none'}}/>
                      <rect x={cropRect.x1} y={cropRect.y1} width={cropRect.x2-cropRect.x1} height={cropRect.y2-cropRect.y1}
                        fill="none" stroke="#4a9eff" strokeWidth={3}
                        style={{cursor:'move',pointerEvents:'auto',touchAction:'none'}}
                        onPointerDown={e=>onCropHandleDown('c',{...cropRect},e)}/>
                      {[['tl',cropRect.x1,cropRect.y1,'nwse-resize'],['tr',cropRect.x2,cropRect.y1,'nesw-resize'],
                        ['bl',cropRect.x1,cropRect.y2,'nesw-resize'],['br',cropRect.x2,cropRect.y2,'nwse-resize'],
                        ['t',(cropRect.x1+cropRect.x2)/2,cropRect.y1,'ns-resize'],
                        ['b',(cropRect.x1+cropRect.x2)/2,cropRect.y2,'ns-resize'],
                        ['l',cropRect.x1,(cropRect.y1+cropRect.y2)/2,'ew-resize'],
                        ['r',cropRect.x2,(cropRect.y1+cropRect.y2)/2,'ew-resize'],
                      ].map(([h,hx,hy,cur])=>(
                        <rect key={h} x={hx-7} y={hy-7} width={14} height={14}
                          fill="#4a9eff" stroke="white" strokeWidth={1.5} rx={2}
                          style={{cursor:cur,pointerEvents:'auto',touchAction:'none'}}
                          onPointerDown={e=>onCropHandleDown(h,{...cropRect},e)}/>
                      ))}
                    </svg>
                  </div>
                )}
                {!practiceMode&&refImage&&photoAreaDragOver&&(
                  <div style={{position:'absolute',top:0,left:0,width:'50%',height:'100%',
                    pointerEvents:'none',zIndex:20,
                    background:'rgba(74,158,255,0.13)',
                    outline:'3px dashed #4a9eff',outlineOffset:'-3px',
                    display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div style={{textAlign:'center',color:'#4a9eff',fontWeight:700,fontSize:13,
                      background:'rgba(255,255,255,0.85)',borderRadius:8,padding:'8px 16px'}}>
                      <DropIcon/>
                      <p style={{margin:'4px 0 0'}}>写真を置き換える</p>
                    </div>
                  </div>
                )}
                {!practiceMode&&!refImage&&(
                  <div className="drop-zone"
                    style={{position:'absolute',top:0,left:0,width:'50%',height:'100%'}}
                    onDragOver={e=>e.preventDefault()} onDrop={onRefDrop}>
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
            </div>
            {practiceMode&&dispSize.w>0&&(
              <div className="practice-bar" style={{
                position:'absolute',
                left:`calc(50% - ${dispSize.w/2}px)`,
                top:`calc(50% + ${dispSize.h/2}px)`,
                bottom:'auto',
                width:dispSize.w/2
              }}>
                {/* カテゴリ切替 */}
                <button className={`pst-btn${practiceCategory==='3d'?' pst-active':''}`}
                  onClick={()=>{if(practiceCategory==='3d')return;setPracticeCategory('3d');const o=genCompound();practiceObjRef.current=o;setPracticeObject({...o});const phi=.18+o.ep*.52,theta=o.rot*8+o.skX*3;setPracticeOrbit({rx:phi,ry:theta,rz:0,zoom:1})}}>立体</button>
                <button className={`pst-btn${practiceCategory==='flat'?' pst-active':''}`}
                  onClick={()=>{if(practiceCategory==='flat')return;setPracticeCategory('flat');const o=genFlat();practiceObjRef.current=o;setPracticeObject({...o});setPracticeDrawMode(true)}}>平面</button>
                <div style={{width:1,background:'#444',margin:'0 4px',alignSelf:'stretch'}}/>
                {/* 立体モード専用: 回転/描画 */}
                {practiceCategory==='3d'&&<>
                  <button className={`pst-btn${!practiceDrawMode?' pst-active':''}`}
                    onClick={()=>setPracticeDrawMode(false)} title="回転・ズーム">↻ 回転</button>
                  <button className={`pst-btn${practiceDrawMode?' pst-active':''}`}
                    onClick={()=>setPracticeDrawMode(true)} title="上に描画">✎ 描画</button>
                  <div style={{width:1,background:'#444',margin:'0 4px',alignSelf:'stretch'}}/>
                </>}
                {/* スタイル選択 */}
                <div className="practice-styles">
                  {(practiceCategory==='3d'?PSTYLES:FLAT_STYLES).map(s=>(
                    <button key={s}
                      className={`pst-btn${(practiceCategory==='3d'?practiceStyle:flatStyle)===s?' pst-active':''}`}
                      onClick={()=>practiceCategory==='3d'?setPracticeStyle(s):setFlatStyle(s)}>
                      {practiceCategory==='3d'?PLABELS[s]:FLAT_STYLE_LABELS[s]}
                    </button>
                  ))}
                </div>
                <div style={{width:1,background:'#444',margin:'0 4px',alignSelf:'stretch'}}/>
                {[['小',800,400],['中',1200,600],['大',1800,900]].map(([label,w,h])=>(
                  <button key={label} className={`pst-btn${cvW===w&&cvH===h?' pst-active':''}`}
                    onClick={()=>resizePracticeCanvas(w*2,h)} title={`${w}×${h}`}>{label}</button>
                ))}
                {practiceCategory==='3d'&&<button className="practice-reset" onClick={()=>setPracticeOrbit({rx:.3,ry:.2,rz:0,zoom:1})} title="視点をリセット">⟳</button>}
                <button className="practice-close" onClick={()=>{setPracticeMode(false);setPracticeDrawMode(false)}} title="練習モードを終了">✕</button>
              </div>
            )}
            {/* 描画パネル下サブバー: 重ねて表示 + 形を変える */}
            {dispSize.w>0&&(refImage||practiceMode)&&(
              <div className="practice-bar" style={{
                position:'absolute',
                left:`calc(50%)`,
                top:`calc(50% + ${dispSize.h/2}px)`,
                bottom:'auto',
                width:dispSize.w/2,
                justifyContent:'flex-end'
              }}>
                {/* 不透明度スライダー（ボタンの左に、ONのとき表示） */}
                {(practiceMode?practiceOverlay:refOverlay)&&<>
                  <input type="range" min="0" max="100"
                    value={practiceMode?practiceOverlayOpacity:refOverlayOpacity}
                    onChange={e=>practiceMode?setPracticeOverlayOpacity(+e.target.value):setRefOverlayOpacity(+e.target.value)}
                    className="split-slider" style={{width:72}}/>
                  <span style={{color:'#aaa',fontSize:11,flexShrink:0,minWidth:26}}>
                    {practiceMode?practiceOverlayOpacity:refOverlayOpacity}%
                  </span>
                </>}
                {/* 重ねて表示ボタン（常に右端近くで位置固定） */}
                <button
                  className={`pst-btn${(practiceMode?practiceOverlay:refOverlay)?' pst-active':''}`}
                  onClick={()=>practiceMode?setPracticeOverlay(v=>!v):setRefOverlay(v=>!v)}
                  title="描画パネルに重ねて表示"><OverlayIcon/></button>
                {/* 形を変える（練習モードのみ） */}
                {practiceMode&&<button className="practice-shuffle" onClick={()=>{
                  if(practiceCategory==='3d'){
                    const o=genCompound();practiceObjRef.current=o;setPracticeObject({...o})
                    const phi=.18+o.ep*.52,theta=o.rot*8+o.skX*3
                    setPracticeOrbit({rx:phi,ry:theta,rz:0,zoom:1})
                  } else {
                    const o=genFlat();practiceObjRef.current=o;setPracticeObject({...o})
                  }
                }} title="形を変える"><ShuffleIcon/></button>}
              </div>
            )}
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
            {(refImage||practiceMode)&&(practiceMode?practiceOverlay:refOverlay)&&<>
              <input type="range" min="0" max="100"
                value={practiceMode?practiceOverlayOpacity:refOverlayOpacity}
                onChange={e=>practiceMode?setPracticeOverlayOpacity(+e.target.value):setRefOverlayOpacity(+e.target.value)}
                className="split-slider" style={{width:72}}/>
              <span style={{color:'#aaa',fontSize:11,flexShrink:0,minWidth:26}}>
                {practiceMode?practiceOverlayOpacity:refOverlayOpacity}%
              </span>
            </>}
            {(refImage||practiceMode)&&<button className={`bb-crop-btn${(practiceMode?practiceOverlay:refOverlay)?' bb-crop-reset':''}`} onClick={()=>practiceMode?setPracticeOverlay(v=>!v):setRefOverlay(v=>!v)} title="描画パネルに重ねて表示"><OverlayIcon/></button>}
            {refImage&&!practiceMode&&(appliedCrop?(
              <button className="bb-crop-btn bb-crop-reset" onClick={resetCrop} title="切り取りを解除">切り取り解除</button>
            ):cropMode?(
              <>
                <button className="bb-crop-btn bb-crop-apply" onClick={applyCrop} title="切り取りを適用">適用</button>
                <button className="bb-crop-btn bb-crop-cancel" onClick={cancelCrop} title="キャンセル">キャンセル</button>
              </>
            ):(
              <button className="bb-crop-btn" onClick={startCrop} title="切り取り">切り取り</button>
            ))}
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
                    <input type="range" min="1" max="100" value={penSize}
                      onChange={e=>setPenSize(+e.target.value)} className="tool-slider"/>
                    <input type="number" min="1" max="100" value={penSize}
                      onChange={e=>{const v=Math.max(1,Math.min(100,+e.target.value||1));setPenSize(v)}}
                      className="tool-size-input"/>
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
                    <input type="number" min="1" max="999" value={eraserSize}
                      onChange={e=>{const v=Math.max(1,Math.min(999,+e.target.value||1));setEraserSize(v)}}
                      className="tool-size-input"/>
                  </div>
                </div>
              </>}
              {showGrid&&!hardMode&&<>
                <div className="pen-sidebar-hdr">マス目</div>
                <div className="pen-sidebar-body">
                  <div className="pen-size-row" style={{gap:4,marginBottom:4}}>
                    <button className={`grid-mode-btn${gridSize>0?' gm-active':''}`} onClick={()=>{if(gridSize<0)setGridSize(100)}}>サイズ</button>
                    <button className={`grid-mode-btn${gridSize<0?' gm-active':''}`} onClick={()=>{if(gridSize>0)setGridSize(-4)}}>分割</button>
                  </div>
                  {gridSize>0?(
                    <div className="tool-size-row">
                      <span className="tool-label">px</span>
                      <input type="range" min="20" max="500" value={gridSize}
                        onChange={e=>setGridSize(+e.target.value)} className="tool-slider"/>
                      <input type="number" min="1" max="2000" value={gridSize}
                        onChange={e=>{const v=Math.max(1,+e.target.value||1);setGridSize(v)}}
                        className="tool-size-input"/>
                    </div>
                  ):(
                    <div className="tool-size-row">
                      <span className="tool-label">分割</span>
                      <input type="range" min="2" max="20" value={-gridSize}
                        onChange={e=>setGridSize(-e.target.value)} className="tool-slider"/>
                      <input type="number" min="1" max="32" value={-gridSize}
                        onChange={e=>{const v=Math.max(1,Math.min(32,+e.target.value||1));setGridSize(-v)}}
                        className="tool-size-input"/>
                    </div>
                  )}
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
                      <div className="tool-size-row" style={{marginBottom:5,flexWrap:'wrap',gap:4}}>
                        <span className="tool-label">色</span>
                        <div style={{display:'flex',gap:3,alignItems:'center',flexWrap:'wrap'}}>
                          {PRESET_COLORS.map(c=>(
                            <button key={c} className={`swatch${ar.color===c?' sel':''}`}
                              style={{background:c,width:18,height:18}}
                              onClick={()=>setRulers(rs=>rs.map(r=>r.id===ar.id?{...r,color:c}:r))}/>
                          ))}
                          <ToggleColorPicker value={ar.color}
                            onChange={c=>setRulers(rs=>rs.map(r=>r.id===ar.id?{...r,color:c}:r))}/>
                        </div>
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
                      <div className="tool-size-row" style={{marginBottom:5,flexWrap:'wrap',gap:4}}>
                        <span className="tool-label">色</span>
                        <div style={{display:'flex',gap:3,alignItems:'center',flexWrap:'wrap'}}>
                          {PRESET_COLORS.map(c=>(
                            <button key={c} className={`swatch${rulerColor===c?' sel':''}`}
                              style={{background:c,width:18,height:18}}
                              onClick={()=>setRulerColor(c)}/>
                          ))}
                          <ToggleColorPicker value={rulerColor} onChange={setRulerColor}/>
                        </div>
                      </div>
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
                  <button onClick={clearActive} title="クリア" className="btn-warn"><ClearLayerIcon/></button>
                  <button onClick={flatten} title="統合" className="btn-merge">⊕</button>
                </div>
              </div>
              {activeLayerId===PHOTO_ID&&(
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
                      className={`layer-row photo-layer-row${isDrag?' layer-dragging':''}${isDrop?' layer-drop-here':''}${activeLayerId===PHOTO_ID?' active':''}`}
                      onMouseDown={e=>onLayerPointerDown(idx,e)}
                      onTouchStart={e=>onLayerPointerDown(idx,e)}>
                      <span className="vis-btn"><EyeIcon/></span>
                      <div className="layer-thumb-ref"><img src={refImage} alt="" style={{opacity:refOpacity/100}}/></div>
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
      {/* custom cursor */}
      {(activeTool===TOOLS.PEN||activeTool===TOOLS.ERASER)&&isCursorOnCanvas&&(
        <div ref={cursorDivRef} style={{
          position:'fixed',left:0,top:0,
          width:20,height:20,
          transform:'translate(-50%,-50%)',
          borderRadius:'50%',
          border:'1px solid rgba(0,0,0,0.85)',
          boxShadow:'0 0 0 0.75px rgba(255,255,255,0.7)',
          pointerEvents:'none',zIndex:9999
        }}>
          <div className="cur-cross" style={{position:'absolute',inset:0,opacity:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="black" strokeWidth="1">
              <line x1="4" y1="0" x2="4" y2="8"/><line x1="0" y1="4" x2="8" y2="4"/>
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Flat 2D practice shapes ────────────────────────────────────────
function _ngon(ctx,cx,cy,r,n,a0=-Math.PI/2){
  for(let i=0;i<=n;i++){const a=a0+(i/n)*Math.PI*2;i===0?ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a))}
}
function drawFlatPractice(ctx,obj,areaW,areaH,style,x0=0,y0=0){
  if(!obj)return
  const{type='circle',rot=0,aspect=.65}=obj
  const sc=Math.min(areaW,areaH)*.34
  const cx=x0+areaW/2,cy=y0+areaH/2
  ctx.save()
  ctx.translate(cx,cy);ctx.rotate(rot);ctx.translate(-cx,-cy)
  // center guide lines: + and × (not for diamond — its axes overlap the shape)
  if(type!=='diamond'){
    const gl=sc*1.8,gd=gl*Math.SQRT1_2
    ctx.save();ctx.strokeStyle='rgba(140,140,180,.22)';ctx.lineWidth=.8;ctx.setLineDash([3,6])
    ctx.beginPath()
    ctx.moveTo(cx-gl,cy);ctx.lineTo(cx+gl,cy)
    ctx.moveTo(cx,cy-gl);ctx.lineTo(cx,cy+gl)
    ctx.moveTo(cx-gd,cy-gd);ctx.lineTo(cx+gd,cy+gd)
    ctx.moveTo(cx+gd,cy-gd);ctx.lineTo(cx-gd,cy+gd)
    ctx.stroke();ctx.restore()
  }
  // shape path
  ctx.beginPath()
  switch(type){
    case 'circle': ctx.arc(cx,cy,sc,0,Math.PI*2);break
    case 'ellipse': ctx.ellipse(cx,cy,sc,sc*Math.max(.38,aspect*.72),0,0,Math.PI*2);break
    case 'triangle': _ngon(ctx,cx,cy,sc,3,-Math.PI/2);break
    case 'rtriangle':{const h=sc*Math.max(.5,aspect*1.2);ctx.moveTo(cx-sc,cy+h*.5);ctx.lineTo(cx+sc,cy+h*.5);ctx.lineTo(cx-sc,cy-h*.5);ctx.closePath();break}
    case 'square': ctx.rect(cx-sc,cy-sc,sc*2,sc*2);break
    case 'rect':{const rh=sc*Math.max(.42,aspect*.82);ctx.rect(cx-sc,cy-rh,sc*2,rh*2);break}
    case 'pentagon': _ngon(ctx,cx,cy,sc,5,-Math.PI/2);break
    case 'hexagon': _ngon(ctx,cx,cy,sc,6,0);break
    case 'star':{const ir=sc*.4;for(let i=0;i<=10;i++){const a=-Math.PI/2+(i/10)*Math.PI*2,r=i%2===0?sc:ir;i===0?ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a))};ctx.closePath();break}
    case 'diamond': _ngon(ctx,cx,cy,sc,4,0);break
    case 'trapezoid':{const tw=sc*.52,bw=sc*.92,h=sc*Math.max(.45,aspect*.72);ctx.moveTo(cx-tw,cy-h);ctx.lineTo(cx+tw,cy-h);ctx.lineTo(cx+bw,cy+h);ctx.lineTo(cx-bw,cy+h);ctx.closePath();break}
    case 'parallelogram':{const pw=sc,ph=sc*Math.max(.38,aspect*.6),off=sc*.3;ctx.moveTo(cx-pw+off,cy-ph);ctx.lineTo(cx+pw+off,cy-ph);ctx.lineTo(cx+pw-off,cy+ph);ctx.lineTo(cx-pw-off,cy+ph);ctx.closePath();break}
  }
  const isFill=style!=='outline'
  if(isFill){
    const g=ctx.createLinearGradient(cx-sc,cy-sc,cx+sc,cy+sc)
    g.addColorStop(0,'#f5f1ed');g.addColorStop(.55,'#e6e2dc');g.addColorStop(1,'#cdc9c3')
    ctx.fillStyle=g;ctx.fill()
  }
  ctx.shadowColor='rgba(50,40,30,.18)';ctx.shadowBlur=isFill?18:0;ctx.shadowOffsetX=sc*.05;ctx.shadowOffsetY=sc*.07
  ctx.strokeStyle='#4a4540';ctx.lineWidth=2.2;ctx.stroke()
  ctx.shadowColor='transparent'
  // center dot
  ctx.beginPath();ctx.arc(cx,cy,2.5,0,Math.PI*2);ctx.fillStyle='rgba(100,90,80,.38)';ctx.fill()
  ctx.restore()
  // shape name label — drawn outside rotation transform, using absolute coordinates
  ctx.save()
  ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillStyle='rgba(80,70,60,.45)'
  ctx.fillText(FLAT_LABELS[type]||type,x0+areaW/2,y0+areaH*.88)
  ctx.restore()
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
  const flatMat = !isWire ? new THREE.MeshStandardMaterial({color:0xede9e3,roughness:.62,metalness:0,flatShading:true}) : mat
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
    case 'prism':       add(new THREE.CylinderGeometry(.95,.95,1.85,3),flatMat); break
    case 'pyramid':     add(new THREE.ConeGeometry(1.1,1.9,4),flatMat); break
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
    case 'mushroom': {
      const capR=1.12,capTheta=Math.PI*.62
      const openY=0.26+capR*Math.cos(capTheta)   // ≈ -0.150 (global y of opening)
      const openR=capR*Math.sin(capTheta)          // ≈ 1.042 (radius of opening)
      add(new THREE.SphereGeometry(capR,48,32,0,Math.PI*2,0,capTheta),null,[0,.26])
      if(!isWire)
        add(new THREE.CircleGeometry(openR,48),
            new THREE.MeshStandardMaterial({color:0xede9e3,roughness:.62,metalness:0,side:THREE.DoubleSide}),
            [0,openY,0],[Math.PI/2,0,0])
      add(new THREE.CylinderGeometry(.28,.44,1.22,32),null,[0,-.64])
      break
    }
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
      add(new THREE.CylinderGeometry(.40,.50,1.52,6),flatMat,[0,-.16])
      add(new THREE.ConeGeometry(.40,.68,6),flatMat,[0,.92])
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
function ClearLayerIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>}
function ResetIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>}
function RedoIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>}
function PenIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>}
function EraserIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7z"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>}
function SelectIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" strokeDasharray="4 2.5"/></svg>}
function MoveIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 12v-7M12 12H5M12 12v7M12 12h7"/></svg>}
function LineIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="2" fill="currentColor" stroke="none"/></svg>}
function RulerIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="8" width="20" height="8" rx="1"/><line x1="6" y1="8" x2="6" y2="13"/><line x1="10" y1="8" x2="10" y2="11"/><line x1="14" y1="8" x2="14" y2="11"/><line x1="18" y1="8" x2="18" y2="13"/></svg>}
function GridIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>}
function SnapIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity=".3"/><path d="M7 7l2.5 2.5M14.5 14.5L17 17M17 7l-2.5 2.5M9.5 14.5L7 17"/></svg>}
function ShuffleIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>}
function DropIcon(){return<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
function HandIcon(){return<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V8a2 2 0 00-4 0v3"/><path d="M14 10.5V6a2 2 0 00-4 0v4.5"/><path d="M10 10V5a2 2 0 00-4 0v9"/><path d="M6 14v1a6 6 0 006 6h2a6 6 0 006-6v-5a2 2 0 00-4 0v2"/></svg>}
function OverlayIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="13" height="13" rx="1.5"/><rect x="9" y="6" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity=".15"/></svg>}
function EyeIcon(){return<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
function EyeOffIcon(){return<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity=".4"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>}
function DeselectIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/><line x1="8" y1="16" x2="16" y2="8"/><line x1="8" y1="8" x2="16" y2="16"/></svg>}
function DeleteSelIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/><path d="M9 12h6"/></svg>}
function DeleteOutIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10" rx=".5" strokeDasharray="3 2"/></svg>}
function TransformIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="1" strokeDasharray="3 2"/><rect x="2" y="2" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="18" y="2" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="2" y="18" width="4" height="4" fill="currentColor" rx="1" stroke="none"/><rect x="18" y="18" width="4" height="4" fill="currentColor" rx="1" stroke="none"/></svg>}
function FillSelIcon(){return<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2" fill="currentColor" fillOpacity=".25"/><path d="M9 12h6M12 9v6" strokeDasharray="none"/></svg>}
