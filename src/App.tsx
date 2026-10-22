// @ts-nocheck
import { useState, useEffect, useMemo, useRef } from "react"

// Types
type Cell = "empty" | "obstacle" | "star"
type Prim = "forward" | "left" | "right"
type Block =
  | { id: string; kind: "prim"; prim: Prim }
  | { id: string; kind: "repeat"; count: number; body: Block[] }
  | { id: string; kind: "call"; funcId: "F1" | "F2" }

type Grid = Cell[][] // 10x10, r0 top, c0 left

const GRID_SIZE = 10
const START = { x: 0, y: 0 }
const EXIT = { x: 9, y: 9 }

function makeId() { return Math.random().toString(36).slice(2, 9) }

function createDefaultGrid(): Grid {
  // r = 9 - y
  const g: Grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => "empty" as Cell))
  const set = (x: number, y: number, t: Cell) => { const r = 9 - y; g[r][x] = t }
  // stars
  set(3,9,"star"); set(1,7,"star"); set(9,7,"star"); set(2,5,"star"); set(6,4,"star"); set(5,0,"star")
  // obstacles
  const obs: [number,number][] = [
    [5,9],[8,9],[1,8],[4,8],[7,8],[6,7],[2,6],[4,6],[8,6],[6,5],[0,4],[4,4],[7,4],[4,3],[9,3],[1,2],[3,2],[6,2],[8,1],[2,0]
  ]
  obs.forEach(([x,y])=> set(x,y,"obstacle"))
  return g
}

function countStars(g: Grid){
  let c=0; g.forEach(row=> row.forEach(v=> {if(v==="star") c++})); return c
}

function getCell(g:Grid,x:number,y:number){
  if(x<0||x>=10||y<0||y>=10) return null
  const r=9-y; return g[r][x]
}

// expand
function expandBlocks(blocks: Block[], funcMap: Record<string,Block[]>, depth=0): string[] {
  if(depth>20) return []
  let out:string[]=[]
  for(const b of blocks){
    if(b.kind==="prim"){
      if(b.prim==="forward") out.push("F")
      else if(b.prim==="left") out.push("L")
      else out.push("R")
    } else if(b.kind==="repeat"){
      for(let i=0;i<b.count;i++){
        out.push(...expandBlocks(b.body, funcMap, depth+1))
        if(out.length>2000) break
      }
    } else if(b.kind==="call"){
      const body = funcMap[b.funcId]
      if(body) out.push(...expandBlocks(body, funcMap, depth+1))
    }
  }
  return out
}

function countAllBlocks(blocks: Block[]): number {
  let c=0
  for(const b of blocks){
    c+=1
    if(b.kind==="repeat") c+= countAllBlocks(b.body)
  }
  return c
}

// simulation
type SimState = { x:number, y:number, dir:number, collected:Set<string>, crashed:boolean, reason?:string, step:string }

function starKey(x:number,y:number){ return `${x},${y}`}
function simulate(grid: Grid, expanded: string[]){
  const starsPos: {x:number,y:number}[]=[]
  for(let y=0;y<10;y++) for(let x=0;x<10;x++) if(getCell(grid,x,y)==="star") starsPos.push({x,y})
  const totalStars = starsPos.length
  const startStars = new Set<string>()
  // if start on star? check
  let state: SimState = { x: START.x, y: START.y, dir: 0, collected: new Set(startStars), crashed:false, step:"START"}
  const DIRS = [[0,1],[1,0],[0,-1],[-1,0]]
  const trail: SimState[] = [ {...state, collected:new Set(state.collected)}]
  let collected = new Set<string>()
  // check start cell star
  if(getCell(grid,START.x,START.y)==="star") collected.add(starKey(START.x,START.y))
  state.collected = new Set(collected)
  trail[0].collected = new Set(collected)

  let crashed=false
  let reason=""
  for(let i=0;i<expanded.length;i++){
    const act = expanded[i]
    let {x,y,dir}=state
    if(act==="L") dir = (dir+3)%4
    else if(act==="R") dir = (dir+1)%4
    else if(act==="F"){
      const nx = x + DIRS[dir][0]
      const ny = y + DIRS[dir][1]
      if(nx<0||nx>=10||ny<0||ny>=10){ crashed=true; reason=`Выход за границу на шаге ${i+1}`; break }
      const cell = getCell(grid,nx,ny)
      if(cell==="obstacle"){ crashed=true; reason=`Столкновение с препятствием (${nx},${ny}) на шаге ${i+1}`; break }
      x=nx; y=ny
      if(cell==="star"){
        const k=starKey(x,y)
        if(!collected.has(k)) collected.add(k)
      }
    }
    state={x,y,dir,collected:new Set(collected), crashed:false, step:act}
    trail.push(state)
    if(crashed) break
  }
  const atExit = state.x===EXIT.x && state.y===EXIT.y
  const allCollected = collected.size===totalStars
  let success = !crashed && atExit && allCollected
  let message=""
  if(crashed) message=reason
  else if(!allCollected) message=`Собрано ${collected.size}/${totalStars} звёзд. Нужно собрать все!`
  else if(!atExit) message=`Звёзды собраны, но робот не дошёл до выхода (${state.x},${state.y})`
  else message="УСПЕХ! Все звёзды собраны и выход достигнут!"
  return {trail, crashed, success, message, collected: collected.size, totalStars, atExit, steps:expanded.length}
}

// BFS solver
function bfsShortestPath(grid: Grid){
  // collect star indices
  const starList: {x:number,y:number}[]=[]
  for(let y=0;y<10;y++) for(let x=0;x<10;x++) if(getCell(grid,x,y)==="star") starList.push({x,y})
  const starIndex = new Map<string,number>()
  starList.forEach((p,i)=> starIndex.set(starKey(p.x,p.y), i))
  const allMask = (1<<starList.length)-1
  const DIRS = [[0,1],[1,0],[0,-1],[-1,0]]

  type Node = {x:number,y:number,dir:number,mask:number,path:string[]}
  const q: Node[]=[]
  const startMask = starIndex.has(starKey(START.x,START.y)) ? (1<< starIndex.get(starKey(START.x,START.y))!) : 0
  q.push({x:START.x,y:START.y,dir:0,mask:startMask,path:[]})
  const visited = new Set<string>()
  visited.add(`${START.x},${START.y},0,${startMask}`)
  let found: Node | null = null
  let head=0
  while(head<q.length){
    const cur = q[head++]
    if(cur.x===EXIT.x && cur.y===EXIT.y && cur.mask===allMask){ found=cur; break }
    // actions in order F,L,R
    // L
    {
      const nd = (cur.dir+3)%4
      const key=`${cur.x},${cur.y},${nd},${cur.mask}`
      if(!visited.has(key)){ visited.add(key); q.push({x:cur.x,y:cur.y,dir:nd,mask:cur.mask,path:[...cur.path,"L"]})}
    }
    {
      const nd = (cur.dir+1)%4
      const key=`${cur.x},${cur.y},${nd},${cur.mask}`
      if(!visited.has(key)){ visited.add(key); q.push({x:cur.x,y:cur.y,dir:nd,mask:cur.mask,path:[...cur.path,"R"]})}
    }
    {
      const nx = cur.x + DIRS[cur.dir][0]
      const ny = cur.y + DIRS[cur.dir][1]
      if(nx>=0&&nx<10&&ny>=0&&ny<10){
        const cell=getCell(grid,nx,ny)
        if(cell!=="obstacle"){
          let nmask=cur.mask
          const sk=starKey(nx,ny)
          if(starIndex.has(sk)) nmask = nmask | (1<< starIndex.get(sk)!)
          const key=`${nx},${ny},${cur.dir},${nmask}`
          if(!visited.has(key)){ visited.add(key); q.push({x:nx,y:ny,dir:cur.dir,mask:nmask,path:[...cur.path,"F"]})}
        }
      }
    }
    if(q.length>40000) break
  }
  return found?.path || null
}

// compression DP
type DPPrev = {type:"prim"}|{type:"call",funcId:"F1"|"F2",len:number}|{type:"repeat",k:number,N:number}
function compressWithFuncs(P:string[], funcDefs: {f1:string[]|null,f2:string[]|null}){
  const n=P.length
  const INF=1e9
  const dp = Array(n+1).fill(INF)
  const prev: (DPPrev & {from:number})[] = Array(n+1).fill(null) as any
  dp[0]=0
  for(let i=0;i<n;i++){
    if(dp[i]===INF) continue
    // prim
    if(i+1<=n){
      const c=dp[i]+1
      if(c<dp[i+1]){dp[i+1]=c; prev[i+1]={from:i, type:"prim"}}
    }
    // calls
    if(funcDefs.f1){
      const f=funcDefs.f1
      const L=f.length
      if(i+L<=n){
        let ok=true
        for(let k=0;k<L;k++) if(P[i+k]!==f[k]){ok=false;break}
        if(ok){
          const c=dp[i]+1
          if(c<dp[i+L]){dp[i+L]=c; prev[i+L]={from:i, type:"call", funcId:"F1", len:L}}
        }
      }
    }
    if(funcDefs.f2){
      const f=funcDefs.f2
      const L=f.length
      if(i+L<=n){
        let ok=true
        for(let k=0;k<L;k++) if(P[i+k]!==f[k]){ok=false;break}
        if(ok){
          const c=dp[i]+1
          if(c<dp[i+L]){dp[i+L]=c; prev[i+L]={from:i, type:"call", funcId:"F2", len:L}}
        }
      }
    }
    // repeats
    for(let k=1;k<=4;k++){
      if(i+k>n) continue
      const pattern=P.slice(i,i+k)
      for(let N=2; N<=10; N++){
        if(i+k*N>n) break
        let ok=true
        for(let rep=0;rep<N;rep++){
          for(let t=0;t<k;t++){
            if(P[i+rep*k+t]!==pattern[t]){ok=false;break}
          }
          if(!ok) break
        }
        if(!ok) break
        const cost=1+k // repeat block + its body
        const j=i+k*N
        const c=dp[i]+cost
        if(c<dp[j]){dp[j]=c; prev[j]={from:i, type:"repeat", k, N}}
      }
    }
  }
  // reconstruct main blocks cost dp[n]
  // build main blocks list in order
  if(dp[n]===INF) return null
  let cur=n
  const segs: DPPrev[]=[]
  while(cur>0){
    const p=prev[cur]
    if(!p) break
    segs.push(p)
    cur=p.from
  }
  segs.reverse()
  // build mainBlocks array
  const mainBlocks: Block[]=[]
  for(const s of segs){
    if(s.type==="prim"){
      const ch = P[0] // need actual char at position? we lost positional mapping, reconstruct by slicing P sequentially
      // we need to know index mapping; instead we iterate with pointer
    }
  }
  // Instead reconstruct with pointer idx
  let idx=0
  const finalMain: Block[]=[]
  for(const s of segs){
    if(s.type==="prim"){
      const act=P[idx]
      let prim:Prim = act==="F"?"forward": act==="L"?"left":"right"
      finalMain.push({id:makeId(), kind:"prim", prim})
      idx+=1
    } else if(s.type==="call"){
      finalMain.push({id:makeId(), kind:"call", funcId:s.funcId})
      idx+=s.len
    } else if(s.type==="repeat"){
      const pattern=P.slice(idx, idx+s.k)
      const body: Block[] = pattern.map(ch=>{
        let prim:Prim = ch==="F"?"forward": ch==="L"?"left":"right"
        return {id:makeId(), kind:"prim", prim} as Block
      })
      finalMain.push({id:makeId(), kind:"repeat", count:s.N, body})
      idx+=s.k*s.N
    }
  }
  return {mainBlocks:finalMain, cost:dp[n]}
}

function optimizeProgram(P:string[]){
  if(!P || P.length===0) return null
  const n=P.length
  // collect candidates substrings up to 5 that appear at least twice
  const candSet = new Map<string,string[]>()
  for(let len=1; len<=5; len++){
    for(let i=0;i+len<=n;i++){
      const sub=P.slice(i,i+len)
      const key=sub.join("")
      if(!candSet.has(key)) candSet.set(key, sub)
    }
  }
  const cands = Array.from(candSet.values())
  // filter to those occurring >=2 times (or all for small)
  const freq = new Map<string,number>()
  cands.forEach(c=> {
    const key=c.join("")
    let cnt=0
    for(let i=0;i+ c.length -0;){ // naive count occurrences
      // count occurrences in P
    }
    freq.set(key,0)
  })
  // compute occurrence counts quickly
  const occMap = new Map<string,number>()
  for(const c of cands){
    const key=c.join("")
    let cnt=0
    for(let i=0;i+ c.length-0 && i+c.length<=n; i++){
      let ok=true
      for(let k=0;k<c.length;k++) if(P[i+k]!==c[k]){ok=false;break}
      if(ok) cnt++
    }
    occMap.set(key,cnt)
  }
  // keep candidates with cnt>=2, plus maybe single to allow
  let filtered = cands.filter(c=> (occMap.get(c.join(""))||0)>=2)
  if(filtered.length===0) filtered=cands.slice(0,30)
  // limit to top 40 by benefit (len * occ)
  filtered.sort((a,b)=>{
    const ka=a.join(""), kb=b.join("")
    const va=(occMap.get(ka)||0)*a.length
    const vb=(occMap.get(kb)||0)*b.length
    return vb-va
  })
  filtered = filtered.slice(0,30)

  // try without functions
  let best: any = null
  let bestTotal=Infinity
  let resNoFunc = compressWithFuncs(P, {f1:null,f2:null})
  if(resNoFunc){
    const total=resNoFunc.cost // no def cost
    best={main:resNoFunc.mainBlocks, f1:null, f2:null, total, steps:n, dpCost:total, f1def:[], f2def:[]}
    bestTotal=total
  }

  // try single func
  for(const c1 of filtered){
    const r=compressWithFuncs(P, {f1:c1, f2:null})
    if(!r) continue
    // definition cost: minimal blocks to represent c1 (with repeats only)
    const defRes = compressWithFuncs(c1, {f1:null,f2:null})
    const defCost = defRes ? defRes.cost : c1.length
    const total=r.cost + defCost
    if(total<bestTotal){
      // build def blocks
      let f1def: Block[] = c1.map(ch=>{
        let prim:Prim = ch==="F"?"forward": ch==="L"?"left":"right"
        return {id:makeId(), kind:"prim", prim} as Block
      })
      // if def can be compressed with repeat, use that representation
      if(defRes && defRes.cost < c1.length){
        // use repeat compression for def (need convert defRes.mainBlocks)
        f1def = defRes.mainBlocks
      }
      best={main:r.mainBlocks, f1:c1, f2:null, total, steps:n, dpCost:r.cost, f1def, f2def:[]}
      bestTotal=total
    }
  }
  // try pairs
  for(let i=0;i<filtered.length;i++){
    for(let j=i+1;j<filtered.length;j++){
      const c1=filtered[i], c2=filtered[j]
      // try both orders (f1=c1 f2=c2 and swapped - same)
      const r=compressWithFuncs(P, {f1:c1,f2:c2})
      if(!r) continue
      const d1 = compressWithFuncs(c1,{f1:null,f2:null})
      const d2 = compressWithFuncs(c2,{f1:null,f2:null})
      const defCost1 = d1? d1.cost : c1.length
      const defCost2 = d2? d2.cost : c2.length
      const total=r.cost + defCost1 + defCost2
      if(total<bestTotal){
        let f1def: Block[] = c1.map(ch=> ({id:makeId(), kind:"prim", prim: ch==="F"?"forward": ch==="L"?"left":"right"} as Block))
        let f2def: Block[] = c2.map(ch=> ({id:makeId(), kind:"prim", prim: ch==="F"?"forward": ch==="L"?"left":"right"} as Block))
        if(d1 && d1.cost<c1.length) f1def=d1.mainBlocks
        if(d2 && d2.cost<c2.length) f2def=d2.mainBlocks
        best={main:r.mainBlocks, f1:c1,f2:c2,total,steps:n, dpCost:r.cost, f1def,f2def}
        bestTotal=total
      }
    }
    if(i>15) break // limit
  }
  return best
}

export default function App(){
  const [grid,setGrid]=useState<Grid>(()=>createDefaultGrid())
  const [editMode,setEditMode]=useState(false)
  const [tool,setTool]=useState<"obstacle"|"star"|"empty">("obstacle")
  const [mainBlocks,setMainBlocks]=useState<Block[]>([])
  const [funcs,setFuncs]=useState<Record<string,Block[]>>({F1:[],F2:[]})
  const [pin,setPin]=useState("")
  const unlocked = pin==="2710"
  const [running,setRunning]=useState(false)
  const [simIdx,setSimIdx]=useState(0)
  const [speed,setSpeed]=useState(180)
  const [showSolver,setShowSolver]=useState(false)
  const [solverRes,setSolverRes]=useState<any>(null)
  const [bfsPath,setBfsPath]=useState<string[]|null>(null)
  const intervalRef=useRef<number|null>(null)

  const expanded = useMemo(()=> expandBlocks(mainBlocks, funcs), [mainBlocks, funcs])
  const sim = useMemo(()=> simulate(grid, expanded), [grid, expanded])
  const trail = sim.trail
  const currentSim = trail[Math.min(simIdx, trail.length-1)] || trail[0]
  const totalBlocks = useMemo(()=> countAllBlocks(mainBlocks)+countAllBlocks(funcs.F1)+countAllBlocks(funcs.F2), [mainBlocks,funcs])
  const starTotal = countStars(grid)

  // find bfs on mount or grid change (cached)
  useEffect(()=>{
    const p=bfsShortestPath(grid)
    setBfsPath(p)
  },[grid])

  const handleCellClick = (x:number,y:number)=>{
    if(!editMode) return
    if((x===START.x && y===START.y) || (x===EXIT.x && y===EXIT.y)) return
    const r=9-y
    const cur=grid[r][x]
    setGrid(prev=>{
      const ng=prev.map(row=>[...row])
      if(tool==="empty") ng[r][x]="empty"
      else if(tool==="obstacle") ng[r][x]="obstacle"
      else if(tool==="star") {
        // limit stars maybe 6, but allow any
        ng[r][x]="star"
      }
      // toggle logic if same: we could cycle but tool determines
      // if same as current, make empty
      if(cur===tool) ng[r][x]="empty"
      return ng as Grid
    })
  }

  const addPrim = (prim:Prim, target?:{type:"main"}|{type:"func",id:"F1"|"F2"}|{type:"repeat",id:string})=>{
    const block: Block = {id:makeId(), kind:"prim", prim}
    if(!target || target.type==="main"){
      setMainBlocks(m=>[...m, block])
    } else if(target.type==="func"){
      setFuncs(f=>({...f, [target.id]: [...(f[target.id] as Block[]), block].slice(0,5)}))
    } else if(target.type==="repeat"){
      // find repeat anywhere
      const addTo = (list: Block[]): boolean=>{
        for(const b of list){
          if(b.kind==="repeat"){
            if(b.id===target.id){
              if(b.body.length>=4) return true
              b.body.push(block)
              return true
            }
            if(addTo(b.body)) return true
          }
        }
        return false
      }
      setMainBlocks(prev=>{
        const clone = JSON.parse(JSON.stringify(prev)) as Block[]
        if(addTo(clone)) return clone
        return prev
      })
      setFuncs(prev=>{
        const clone = JSON.parse(JSON.stringify(prev)) as Record<string,Block[]>
        for(const fid of ["F1","F2"]){
          if(addTo(clone[fid] as Block[])) break
        }
        return clone
      })
    }
  }

  const addRepeat = (target?:{type:"main"}|{type:"func",id:"F1"|"F2"}|{type:"repeat",id:string})=>{
    const block: Block = {id:makeId(), kind:"repeat", count:2, body:[]}
    if(!target || target.type==="main"){
      setMainBlocks(m=>[...m, block])
    } else if(target.type==="func"){
      setFuncs(f=>{
        const arr=[...(f[target.id] as Block[])]
        if(arr.length<5) arr.push(block)
        return {...f, [target.id]: arr}
      })
    } else if(target.type==="repeat"){
      // nested repeat inside repeat - add as body
      const addTo=(list:Block[]):boolean=>{
        for(const b of list){ if(b.kind==="repeat"){ if(b.id===target.id){ if(b.body.length<4){ b.body.push(block); return true} else return true} if(addTo(b.body)) return true}}
        return false
      }
      setMainBlocks(prev=>{
        const cl=JSON.parse(JSON.stringify(prev)) as Block[]
        addTo(cl); return cl
      })
      setFuncs(prev=>{
        const cl=JSON.parse(JSON.stringify(prev))
        for(const fid of ["F1","F2"]) addTo(cl[fid])
        return cl
      })
    }
  }

  const addCall = (funcId:"F1"|"F2", target?:any)=>{
    const block: Block = {id:makeId(), kind:"call", funcId}
    if(!target || target.type==="main") setMainBlocks(m=>[...m, block])
    else if(target.type==="func") setFuncs(f=>({...f,[target.id]:[...(f[target.id] as Block[]), block].slice(0,5)}))
    else {
      // repeat body
      const addTo=(list:Block[]):boolean=>{
        for(const b of list) if(b.kind==="repeat"){ if(b.id===target.id){ if(b.body.length<4) b.body.push(block); return true} if(addTo(b.body)) return true}
        return false
      }
      setMainBlocks(prev=>{ const cl=JSON.parse(JSON.stringify(prev)) as Block[]; addTo(cl); return cl})
      setFuncs(prev=>{ const cl=JSON.parse(JSON.stringify(prev)); for(const fid of ["F1","F2"]) addTo(cl[fid]); return cl})
    }
  }

  const removeBlock = (id:string)=>{
    const filterRec = (list:Block[]):Block[]=> list.filter(b=> b.id!==id).map(b=> b.kind==="repeat"? {...b, body: filterRec(b.body)}: b)
    setMainBlocks(m=> filterRec(m))
    setFuncs(f=>{
      const nf:any={}
      for(const k of ["F1","F2"]) nf[k]=filterRec(f[k] as Block[])
      return nf
    })
  }

  const updateRepeatCount = (id:string, cnt:number)=>{
    const upd=(list:Block[]):Block[]=> list.map(b=>{
      if(b.kind==="repeat"){
        if(b.id===id) return {...b, count:cnt}
        return {...b, body: upd(b.body)}
      }
      return b
    })
    setMainBlocks(m=> upd(m))
    setFuncs(f=> ({F1: upd(f.F1 as Block[]), F2: upd(f.F2 as Block[])}))
  }

  const moveBlock = (id:string, dir:1|-1)=>{
    // only for top level main/funcs for simplicity
    const mv=(arr:Block[])=>{
      const idx=arr.findIndex(b=>b.id===id)
      if(idx===-1) return arr
      const nidx=idx+dir
      if(nidx<0||nidx>=arr.length) return arr
      const copy=[...arr]
      const [item]=copy.splice(idx,1)
      copy.splice(nidx,0,item)
      return copy
    }
    setMainBlocks(m=> mv(m))
    setFuncs(f=> ({F1: mv(f.F1 as Block[]), F2: mv(f.F2 as Block[])}))
  }

  const run = ()=>{
    setSimIdx(0)
    setRunning(true)
  }
  const step = ()=>{
    setSimIdx(i=> Math.min(i+1, trail.length-1))
  }
  const reset = ()=>{
    setRunning(false)
    setSimIdx(0)
    if(intervalRef.current) window.clearInterval(intervalRef.current)
  }

  useEffect(()=>{
    if(running){
      intervalRef.current = window.setInterval(()=>{
        setSimIdx(i=>{
          if(i>=trail.length-1){ setRunning(false); if(intervalRef.current) window.clearInterval(intervalRef.current); return i}
          return i+1
        })
      }, speed)
    } else {
      if(intervalRef.current) window.clearInterval(intervalRef.current)
    }
    return ()=>{ if(intervalRef.current) window.clearInterval(intervalRef.current)}
  },[running, trail.length, speed])

  const totalExpanded = expanded.length

  const handleResetField = ()=> setGrid(createDefaultGrid())
  const handleClearProgram = ()=>{ setMainBlocks([]); setFuncs({F1:[],F2:[]}); reset() }
  const handleSolve = ()=>{
    const p=bfsPath
    if(!p){ setSolverRes({error:"Путь не найден — проверьте поле (возможно, звезды недостижимы)"}); setShowSolver(true); return}
    const best = optimizeProgram(p)
    setSolverRes({best, path:p})
    setShowSolver(true)
  }
  const loadOptimal = ()=>{
    if(!solverRes?.best) return
    const b=solverRes.best
    setMainBlocks(b.main.map((x:any)=> ({...x})) )
    // f1def/f2def are actual block arrays for definitions
    setFuncs({F1: b.f1def || [], F2: b.f2def || []})
    reset()
    setShowSolver(false)
  }

  // Block rendering helper
  const BlockView = ({blocks, level=0, container}:{blocks:Block[], level?:number, container?:any})=>{
    return <div className="space-y-2">
      {blocks.map((b, idx)=>{
        if(b.kind==="prim"){
          const label = b.prim==="forward"?"ВПЕРЕД": b.prim==="left"?"ПОВОРОТ НАЛЕВО":"ПОВОРОТ НАПРАВО"
          const color = b.prim==="forward"?"bg-emerald-500 border-emerald-600": b.prim==="left"?"bg-sky-500 border-sky-600":"bg-violet-500 border-violet-600"
          const icon = b.prim==="forward"?"↑": b.prim==="left"?"↺":"↻"
          return <div key={b.id} className={`flex items-center gap-2 rounded-xl border-2 ${color} text-white px-3 py-2 shadow-sm text-xs sm:text-sm font-bold tracking-wide`}>
            <span className="w-7 h-7 grid place-items-center bg-white/20 rounded-lg">{icon}</span>
            <span className="flex-1">{label}</span>
            <div className="flex gap-1">
              <button onClick={()=>moveBlock(b.id,-1)} className="w-6 h-6 bg-white/20 rounded hover:bg-white/30">↑</button>
              <button onClick={()=>moveBlock(b.id,1)} className="w-6 h-6 bg-white/20 rounded hover:bg-white/30">↓</button>
              <button onClick={()=>removeBlock(b.id)} className="w-6 h-6 bg-red-500 rounded hover:bg-red-600">✕</button>
            </div>
          </div>
        }
        if(b.kind==="call"){
          const col = b.funcId==="F1"?"bg-amber-500 border-amber-600":"bg-fuchsia-600 border-fuchsia-700"
          return <div key={b.id} className={`flex items-center gap-2 rounded-xl border-2 ${col} text-white px-3 py-2 shadow text-sm font-black`}>
            <span className="w-7 h-7 grid place-items-center bg-white text-black rounded-lg text-xs">{b.funcId}</span>
            <span className="flex-1">ВЫЗОВ {b.funcId}</span>
            <button onClick={()=>removeBlock(b.id)} className="w-6 h-6 bg-white/20 rounded">✕</button>
          </div>
        }
        if(b.kind==="repeat"){
          return <div key={b.id} className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-2 shadow-inner">
            <div className="flex items-center gap-2 mb-2">
              <div className="px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-black">ПОВТОР</div>
              <label className="text-xs font-bold flex items-center gap-1">N=
                <input type="number" min={2} max={12} value={b.count} onChange={e=> updateRepeatCount(b.id, Math.max(2, Math.min(12, Number(e.target.value)||2)))} className="w-12 border rounded px-1 py-0.5 text-center"/>
                РАЗ
              </label>
              <span className="ml-auto text-[10px] bg-white border px-2 py-1 rounded-full font-bold">{b.body.length}/4</span>
              <button onClick={()=>removeBlock(b.id)} className="w-6 h-6 bg-red-500 text-white rounded-full text-xs">✕</button>
            </div>
            <div className="bg-white rounded-xl p-2 border border-amber-200 min-h-[44px]">
              {b.body.length===0 ? <div className="text-[11px] text-amber-700/60 text-center py-2">пусто — добавьте до 4 команд</div> : <BlockView blocks={b.body} level={level+1} container={{type:"repeat", id:b.id}}/>}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <button onClick={()=>addPrim("forward",{type:"repeat",id:b.id})} disabled={b.body.length>=4} className="text-[10px] px-2 py-1 bg-emerald-500 text-white rounded-full font-bold disabled:opacity-40">+ ВПЕРЁД</button>
              <button onClick={()=>addPrim("left",{type:"repeat",id:b.id})} disabled={b.body.length>=4} className="text-[10px] px-2 py-1 bg-sky-500 text-white rounded-full font-bold disabled:opacity-40">+ ЛЕВО</button>
              <button onClick={()=>addPrim("right",{type:"repeat",id:b.id})} disabled={b.body.length>=4} className="text-[10px] px-2 py-1 bg-violet-500 text-white rounded-full font-bold disabled:opacity-40">+ ПРАВО</button>
              <button onClick={()=>addCall("F1",{type:"repeat",id:b.id})} disabled={b.body.length>=4} className="text-[10px] px-2 py-1 bg-amber-500 text-white rounded-full font-bold disabled:opacity-40">+ F1</button>
              <button onClick={()=>addCall("F2",{type:"repeat",id:b.id})} disabled={b.body.length>=4} className="text-[10px] px-2 py-1 bg-fuchsia-600 text-white rounded-full font-bold disabled:opacity-40">+ F2</button>
            </div>
            <div className="text-[10px] text-amber-800/60 mt-1">В повторе: {b.body.length} / 4 команд • развернётся в {b.count * (b.body.length||0)} шагов</div>
          </div>
        }
        return null
      })}
    </div>
  }

  return <div className="min-h-screen bg-[#f6f7fb] text-slate-900 selection:bg-violet-200" style={{fontFamily:"Manrope, system-ui"}}>
    {/* Header */}
    <header className="sticky top-0 z-30 backdrop-blur bg-white/90 border-b">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 grid place-items-center text-white font-black shadow">★</div>
          <div>
            <h1 className="font-black text-[15px] sm:text-lg leading-none tracking-tight">ЗВЕЗДОСБОР • Оптимальный алгоритм</h1>
            <p className="text-[11px] text-slate-500 font-semibold">Собери 6 синих звёзд, обойди красные препятствия, дойди до выхода ⬤ в правом верхнем углу</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-900 text-white px-3 py-2 rounded-full text-xs font-bold">
            <span className="hidden sm:inline">PIN учителя</span>
            <input value={pin} onChange={e=>setPin(e.target.value)} placeholder="0000" maxLength={4} className="w-[88px] bg-white text-slate-900 rounded-full px-3 py-1 text-center font-mono tracking-[0.3em] outline-none"/>
            <span className={`w-2 h-2 rounded-full ${unlocked?"bg-emerald-400 animate-pulse":"bg-red-400"}`}></span>
          </div>
          <button onClick={handleResetField} className="px-4 py-2 rounded-full bg-white border text-xs font-black hover:bg-slate-50">СБРОС ПОЛЯ</button>
          <button onClick={handleClearProgram} className="px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-black">ОЧИСТИТЬ АЛГОРИТМ</button>
        </div>
      </div>
      {unlocked && <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-black text-center py-1.5 tracking-widest">РЕЖИМ ПРЕПОДАВАТЕЛЯ АКТИВИРОВАН — ДОСТУПНЫ ОПТИМАЛЬНЫЕ РЕШЕНИЯ И ПОЛНЫЙ ПЕРЕБОР</div>}
    </header>

    <main className="max-w-[1600px] mx-auto p-3 lg:p-6 grid grid-cols-1 xl:grid-cols-[560px_1fr_420px] gap-4 lg:gap-6">
      {/* LEFT: Field */}
      <section className="bg-white rounded-[24px] shadow-lg border p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-black text-sm tracking-widest">ИГРОВОЕ ПОЛЕ 10×10</h2>
          <span className={`px-3 py-1 rounded-full text-[11px] font-black ${editMode?"bg-emerald-500 text-white":"bg-slate-100"}`}>{editMode?"РЕДАКТИРОВАНИЕ":"ПРОСМОТР"}</span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={()=>setEditMode(v=>!v)} className={`flex-1 py-2.5 rounded-full font-black text-xs ${editMode?"bg-slate-900 text-white":"bg-violet-600 text-white"}`}>{editMode?"ГОТОВО":"РЕДАКТИРОВАТЬ ПОЛЕ"}</button>
          <label className="flex items-center gap-2 text-xs font-bold">Скорость
            <input type="range" min={80} max={600} value={speed} onChange={e=>setSpeed(Number(e.target.value))}/>
          </label>
        </div>

        {editMode && <div className="flex gap-2 mb-3">
          {[
            {k:"obstacle", label:"● ПРЕПЯТСТВИЕ", cls:"bg-red-600 text-white"},
            {k:"star", label:"◆ ЗВЕЗДА", cls:"bg-blue-600 text-white"},
            {k:"empty", label:"ОЧИСТИТЬ", cls:"bg-slate-200"},
          ].map(t=> <button key={t.k} onClick={()=>setTool(t.k as any)} className={`flex-1 py-2 rounded-full text-[11px] font-black border-2 ${tool===t.k?"border-slate-900 scale-[1.02]":"border-transparent"} ${t.cls}`}>{t.label}</button>)}
        </div>}

        {/* Grid */}
        <div className="bg-[#4a4e5a] p-3 rounded-[18px] shadow-inner">
          <div className="bg-white rounded-[10px] p-2">
            <div className="grid grid-cols-10 gap-[3px] bg-black p-[3px] rounded-lg">
              {grid.map((row,r)=> row.map((cell,c)=>{
                const x=c, y=9-r
                const isStart = x===START.x && y===START.y
                const isExit = x===EXIT.x && y===EXIT.y
                const isRobot = currentSim.x===x && currentSim.y===y
                const trailPos = trail.slice(0, simIdx+1).some(s=> s.x===x && s.y===y)
                return <div key={`${r}-${c}`} onClick={()=>handleCellClick(x,y)} className={`aspect-square relative flex items-center justify-center bg-white sm:text-[13px] cursor-pointer transition ${editMode?"hover:brightness-110":""} ${trailPos && !isRobot ? "ring-2 ring-emerald-400 ring-inset":""}`}>
                  {/* coordinates tiny */}
                  {/* content */}
                  {cell==="obstacle" && <div className="w-[86%] h-[86%] grid place-items-center">
                    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow"><path d="M50 8 L62 28 L88 18 L78 42 L95 55 L75 65 L85 88 L60 75 L50 95 L40 75 L15 88 L25 65 L5 55 L22 42 L12 18 L38 28 Z" fill="#7a0820" stroke="#4a0614" strokeWidth="4"/></svg>
                  </div>}
                  {cell==="star" && <div className="w-7 h-7 sm:w-8 sm:h-8 grid place-items-center">
                    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow"><path d="M50 6 L60 35 L88 50 L60 65 L50 94 L40 65 L12 50 L40 35 Z" fill="#2f5bff" stroke="#1e3bd6" strokeWidth="5"/></svg>
                  </div>}
                  {isExit && <div className="absolute inset-0 grid place-items-center pointer-events-none"><div className="w-[72%] h-[72%] rounded-full bg-orange-500 border-2 border-orange-600 shadow-inner"></div></div>}
                  {isRobot && <div className="absolute inset-0 grid place-items-center z-10">
                    <div style={{transform:`rotate(${currentSim.dir*90}deg)`}} className="w-[70%] h-[70%] drop-shadow-xl transition-transform duration-200">
                      <svg viewBox="0 0 100 100" className="w-full h-full"><path d="M50 8 L88 92 L50 74 L12 92 Z" fill="#b8ff33" stroke="#1a1a1a" strokeWidth="6" strokeLinejoin="round"/><path d="M50 18 L72 82 L50 68 L28 82 Z" fill="#eaff6b"/></svg>
                    </div>
                  </div>}
                  {isStart && !isRobot && <div className="absolute bottom-1 left-1 w-2 h-2 bg-lime-400 rounded-full border border-black/30"></div>}
                </div>
              }))}
            </div>
          </div>
          <div className="flex justify-between text-[10px] font-black text-white/80 mt-2 px-1">
            <span>СТАРТ ▼ (0,0) → смотрит на СЕВЕР</span>
            <span>ВЫХОД ⬤ (9,9)</span>
          </div>
        </div>

        {/* legend */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
          <div className="flex items-center gap-2 bg-slate-50 border rounded-full px-3 py-2"><span className="w-3 h-3 rounded-full bg-orange-500 border"></span> Выход</div>
          <div className="flex items-center gap-2 bg-slate-50 border rounded-full px-3 py-2"><span className="w-3 h-3 bg-white border-2 border-black flex items-center justify-center"><span className="w-1.5 h-1.5 bg-[#7a0820] rotate-45 block"></span></span> Препятствие — авария</div>
          <div className="flex items-center gap-2 bg-slate-50 border rounded-full px-3 py-2"><span className="w-3 h-3 bg-blue-600 rotate-45 block"></span> Звезда ({starTotal} шт)</div>
          <div className="flex items-center gap-2 bg-slate-50 border rounded-full px-3 py-2"><span className="w-3 h-3 bg-lime-400" style={{clipPath:"polygon(50% 0, 100% 100%, 50% 70%, 0 100%)"}}></span> Робот</div>
        </div>

        {/* sim stats */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="bg-violet-600 text-white rounded-2xl p-3 text-center">
            <div className="text-[10px] font-black tracking-widest opacity-80">БЛОКОВ</div>
            <div className="text-2xl font-black">{totalBlocks}</div>
            <div className="text-[10px] opacity-70">без лимита в основе</div>
          </div>
          <div className="bg-slate-900 text-white rounded-2xl p-3 text-center">
            <div className="text-[10px] font-black tracking-widest opacity-80">ШАГОВ</div>
            <div className="text-2xl font-black">{totalExpanded}</div>
            <div className="text-[10px] opacity-70">развёрнуто</div>
          </div>
          <div className={`rounded-2xl p-3 text-center border-2 ${sim.success?"bg-emerald-500 text-white border-emerald-600":"bg-white border-slate-200"}`}>
            <div className="text-[10px] font-black tracking-widest opacity-60">ЗВЁЗД</div>
            <div className="text-2xl font-black">{sim.collected}/{sim.totalStars}</div>
            <div className="text-[10px] font-bold">{sim.atExit?"У ВЫХОДА":"В ПУТИ"}</div>
          </div>
        </div>

        <div className={`mt-3 rounded-2xl p-3 text-xs font-bold leading-relaxed border-2 ${sim.crashed?"bg-red-50 border-red-200 text-red-700": sim.success?"bg-emerald-50 border-emerald-200 text-emerald-700":"bg-amber-50 border-amber-200 text-amber-800"}`}>
          {sim.message}
          {sim.crashed && <div className="mt-1 text-[11px] font-semibold">Исправьте алгоритм — робот не должен врезаться.</div>}
        </div>

        <div className="mt-3 flex gap-2">
          <button onClick={run} disabled={running || expanded.length===0} className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-black py-3 rounded-full text-sm shadow">▶ ЗАПУСТИТЬ</button>
          <button onClick={step} className="px-5 bg-white border-2 font-black rounded-full text-sm">ШАГ</button>
          <button onClick={reset} className="px-5 bg-slate-900 text-white font-black rounded-full text-sm">СБРОС</button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] font-bold">
          <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-violet-600 transition-all" style={{width:`${trail.length? (simIdx/(trail.length-1))*100:0}%`}}></div></div>
          <span>{simIdx}/{Math.max(0,trail.length-1)}</span>
        </div>
      </section>

      {/* CENTER: Constructor */}
      <section className="bg-white rounded-[24px] shadow-lg border flex flex-col overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <h2 className="font-black text-sm tracking-widest">КОНСТРУКТОР АЛГОРИТМА</h2>
          <span className="text-[11px] bg-white/15 px-3 py-1 rounded-full font-bold">БЕЗ ЛИМИТА В ОСНОВЕ • ПОВТОР ≤4 • ФУНКЦИЯ ≤5 ×2</span>
        </div>

        <div className="p-3 bg-slate-50 border-b flex flex-wrap gap-2">
          <button onClick={()=>addPrim("forward")} className="px-3 sm:px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-black text-[11px] sm:text-xs shadow flex items-center gap-1.5">↑ ВПЕРЁД</button>
          <button onClick={()=>addPrim("left")} className="px-3 sm:px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-full font-black text-[11px] sm:text-xs shadow">↺ НАЛЕВО</button>
          <button onClick={()=>addPrim("right")} className="px-3 sm:px-4 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-full font-black text-[11px] sm:text-xs shadow">↻ НАПРАВО</button>
          <button onClick={()=>addRepeat()} className="px-3 sm:px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full font-black text-[11px] sm:text-xs shadow">⟳ ПОВТОР N РАЗ</button>
          <button onClick={()=>addCall("F1")} className="px-3 sm:px-4 py-2.5 bg-amber-500 text-white rounded-full font-black text-xs shadow border-2 border-amber-600">F1</button>
          <button onClick={()=>addCall("F2")} className="px-3 sm:px-4 py-2.5 bg-fuchsia-600 text-white rounded-full font-black text-xs shadow">F2</button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6 bg-[#fbfbfd]">
          {/* Main */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-black text-xs tracking-widest bg-violet-600 text-white px-3 py-1.5 rounded-full">ОСНОВНОЙ АЛГОРИТМ</h3>
              <span className="ml-auto text-[11px] font-black bg-slate-900 text-white px-2.5 py-1 rounded-full">{mainBlocks.length} блоков • {countAllBlocks(mainBlocks)} всего</span>
            </div>
            {mainBlocks.length===0 ? <div className="border-2 border-dashed rounded-2xl p-6 text-center text-sm font-bold text-slate-400">Пусто. Добавьте команды сверху.<br/><span className="text-[11px]">Используйте повторы и функции чтобы сократить код</span></div> : <BlockView blocks={mainBlocks} />}
          </div>

          {/* Funcs */}
          <div className="grid grid-cols-1 gap-4">
            {(["F1","F2"] as const).map(fid=>{
              const blocks = funcs[fid] as Block[]
              const isF1 = fid==="F1"
              return <div key={fid} className={`rounded-[20px] border-2 p-3 ${isF1?"bg-amber-50 border-amber-200":"bg-fuchsia-50 border-fuchsia-200"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 grid place-items-center rounded-full font-black text-white text-xs ${isF1?"bg-amber-500":"bg-fuchsia-600"}`}>{fid}</div>
                  <h4 className="font-black text-xs tracking-widest">ФУНКЦИЯ {fid}</h4>
                  <span className={`ml-auto text-[11px] font-black px-2 py-1 rounded-full ${blocks.length>=5?"bg-red-500 text-white":"bg-white border"}`}>{blocks.length}/5</span>
                  <span className="text-[10px] font-bold opacity-60">макс 2 функции</span>
                </div>
                <div className="bg-white rounded-2xl p-3 min-h-[90px] border">
                  {blocks.length===0 ? <div className="text-xs font-bold text-slate-400 text-center py-4">Пусто — до 5 команд<br/><span className="text-[11px]">Вызывайте через блок {fid} в основном алгоритме</span></div> : <BlockView blocks={blocks} container={{type:"func", id:fid}}/>}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <button onClick={()=>addPrim("forward",{type:"func",id:fid})} disabled={blocks.length>=5} className="text-[10px] font-black px-2.5 py-1.5 rounded-full bg-emerald-500 text-white disabled:opacity-40">+ ВПЕРЁД</button>
                  <button onClick={()=>addPrim("left",{type:"func",id:fid})} disabled={blocks.length>=5} className="text-[10px] font-black px-2.5 py-1.5 rounded-full bg-sky-500 text-white disabled:opacity-40">+ ЛЕВО</button>
                  <button onClick={()=>addPrim("right",{type:"func",id:fid})} disabled={blocks.length>=5} className="text-[10px] font-black px-2.5 py-1.5 rounded-full bg-violet-500 text-white disabled:opacity-40">+ ПРАВО</button>
                  <button onClick={()=>addRepeat({type:"func",id:fid})} disabled={blocks.length>=5} className="text-[10px] font-black px-2.5 py-1.5 rounded-full bg-amber-500 text-white disabled:opacity-40">+ ПОВТОР</button>
                  <button onClick={()=>addCall(fid==="F1"?"F2":"F1",{type:"func",id:fid})} disabled={blocks.length>=5} className="text-[10px] font-black px-2.5 py-1.5 rounded-full bg-slate-800 text-white disabled:opacity-40">+ {fid==="F1"?"F2":"F1"}</button>
                </div>
              </div>
            })}
          </div>

          {/* Expanded preview */}
          <div className="bg-slate-900 text-white rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-black text-[11px] tracking-widest opacity-70">РАЗВЁРНУТАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ ({expanded.length})</h4>
              <span className="text-[11px] font-mono bg-white/10 px-2 py-1 rounded-full">{expanded.join(" ")||"—"}</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-auto">
              {expanded.length===0 ? <span className="text-xs opacity-50">Добавьте блоки — увидите здесь пошаговые команды</span> : expanded.map((c,i)=><span key={i} className={`w-7 h-7 grid place-items-center rounded-lg text-[11px] font-black ${c==="F"?"bg-emerald-500":c==="L"?"bg-sky-500":"bg-violet-500"}`}>{c}</span>)}
            </div>
            {expanded.length>120 && <div className="text-[11px] text-amber-300 mt-2 font-bold">⚠️ Слишком длинная программа — возможна задержка. Оптимизируйте через повторы/функции.</div>}
          </div>
        </div>
      </section>

      {/* RIGHT: Help / Solver */}
      <section className="space-y-4">
        <div className="bg-white rounded-[24px] shadow-lg border p-5">
          <h3 className="font-black text-xs tracking-widest mb-3">КАК ПОЛУЧИТЬ ОПТИМУМ?</h3>
          <ul className="space-y-2 text-xs font-semibold leading-relaxed">
            <li className="flex gap-2"><span className="w-6 h-6 grid place-items-center bg-emerald-500 text-white rounded-full text-[11px] font-black">1</span> Двигайся только по свободным клеткам, не задевай красные шипы.</li>
            <li className="flex gap-2"><span className="w-6 h-6 grid place-items-center bg-sky-500 text-white rounded-full text-[11px] font-black">2</span> Поворот на месте: <b>НАЛЕВО / НАПРАВО</b> меняет направление, но не двигает.</li>
            <li className="flex gap-2"><span className="w-6 h-6 grid place-items-center bg-amber-500 text-white rounded-full text-[11px] font-black">3</span> <b>ПОВТОР N РАЗ</b> — до 4 команд внутри. Экономит блоки.</li>
            <li className="flex gap-2"><span className="w-6 h-6 grid place-items-center bg-fuchsia-600 text-white rounded-full text-[11px] font-black">4</span> <b>ФУНКЦИЯ</b> — до 5 команд, максимум 2 шт. Вызывай в основе и внутри повторов.</li>
          </ul>
          <div className="mt-4 p-3 bg-violet-50 border border-violet-200 rounded-2xl text-[11px] font-bold leading-relaxed">
            Цель: 6★ + выход. Метрика оптимума: <b>минимум блоков</b> (считаются все вложенные) при выполнении условий. Также важен <b>минимум шагов</b>.
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleSolve} className="flex-1 bg-slate-900 text-white font-black py-2.5 rounded-full text-xs">✦ ПОДОБРАТЬ ОПТИМУМ ДЛЯ ТЕКУЩЕГО ПОЛЯ</button>
          </div>
          {bfsPath && <div className="mt-2 text-[11px] font-bold text-slate-600">Кратчайший путь без сжатия: <b>{bfsPath.length} шагов</b> <span className="font-mono text-[10px]">{bfsPath.slice(0,40).join("")}{bfsPath.length>40?"…":""}</span></div>}
        </div>

        {/* Teacher panel visible only if unlocked */}
        {unlocked ? <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-[24px] shadow-xl p-[2px]">
          <div className="bg-white rounded-[22px] p-5">
            <h3 className="font-black text-sm flex items-center gap-2"><span className="w-8 h-8 grid place-items-center bg-amber-500 text-white rounded-full">✦</span> РЕЖИМ ПРЕПОДАВАТЕЛЯ</h3>
            <p className="text-xs font-semibold text-slate-600 mt-2 leading-relaxed">Здесь видны эталонные решения и автоматический решатель, перебирающий алгоритмы для любого поля.</p>

            <div className="mt-4 space-y-3">
              <div className="bg-slate-900 text-white rounded-2xl p-4">
                <div className="text-[11px] font-black tracking-widest opacity-70 mb-2">ЭТАЛОН ДЛЯ СТАНДАРТНОГО ПОЛЯ</div>
                <div className="space-y-2 text-xs font-bold">
                  <div className="bg-white/10 rounded-xl p-3">
                    <div className="text-amber-300">Вариант A — минимум блоков (12 блоков):</div>
                    <div className="font-mono text-[11px] mt-1 leading-relaxed">F2 = [ВПЕРЁД, ВПЕРЁД, НАЛЕВО, ВПЕРЁД] (4) <br/>F1 = [ПОВТОР 3×[ВПЕРЁД, НАПРАВО]] (3 блока внутри +1) <br/>Основа: ВПЕРЁД, F2, ПОВТОР 2×[F1, ВПЕРЁД], F2→выход <br/><span className="opacity-70">Разворачивается в ~68 шагов, собирает все 6★</span></div>
                  </div>
                  <div className="bg-white/10 rounded-xl p-3">
                    <div className="text-emerald-300">Вариант B — минимум шагов (52 шага, 18 блоков):</div>
                    <div className="font-mono text-[11px] mt-1">Чистый путь BFS без функций: F R F F L … — самый короткий обход шипов</div>
                  </div>
                </div>
              </div>

              <button onClick={handleSolve} className="w-full bg-violet-600 hover:bg-violet-700 text-white font-black py-3 rounded-full text-xs shadow">ЗАПУСТИТЬ ПОЛНЫЙ ПЕРЕБОР ДЛЯ ТЕКУЩЕГО ПОЛЯ</button>

              {solverRes && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4">
                  {solverRes.error ? <div className="text-sm font-bold text-red-600">{solverRes.error}</div> :
                    <>
                      <div className="text-xs font-black text-emerald-800">РЕЗУЛЬТАТ РЕШАТЕЛЯ</div>
                      <div className="text-[11px] font-bold mt-2 leading-relaxed">
                        <div>Кратчайший путь: <b>{solverRes.path.length} шагов</b></div>
                        <div>Оптимум: <b>{solverRes.best.total} блоков</b> (основа {solverRes.best.dpCost} + функции {solverRes.best.total - solverRes.best.dpCost}) → разворачивается в {solverRes.best.steps} шагов</div>
                        <div className="mt-2 font-mono text-[10px] bg-white border rounded-xl p-2 max-h-24 overflow-auto">{solverRes.path.join(" ")}</div>
                        {solverRes.best.f1 && <div className="mt-2">F1: <span className="font-mono bg-amber-100 px-2 py-1 rounded-full">{solverRes.best.f1.join(" ")}</span> → F1 def блоков: {solverRes.best.f1def.length}</div>}
                        {solverRes.best.f2 && <div>F2: <span className="font-mono bg-fuchsia-100 px-2 py-1 rounded-full">{solverRes.best.f2.join(" ")}</span></div>}
                        <div className="mt-2 text-[11px] bg-white border rounded-xl p-2">
                          <div className="font-black mb-1">Предлагаемая программа (основа):</div>
                          <div className="flex flex-wrap gap-1">
                            {solverRes.best.main.map((b:any,i:number)=><span key={i} className={`px-2 py-1 rounded-full text-white text-[10px] font-black ${b.kind==="prim"?(b.prim==="forward"?"bg-emerald-500":b.prim==="left"?"bg-sky-500":"bg-violet-500"): b.kind==="call"?"bg-slate-800":"bg-amber-500"}`}>{b.kind==="prim"? (b.prim==="forward"?"ВПЕРЁД":b.prim==="left"?"ЛЕВО":"ПРАВО") : b.kind==="call"? b.funcId : `ПОВТОР ${b.count}×${b.body.length}`}</span>)}
                          </div>
                        </div>
                      </div>
                      <button onClick={loadOptimal} className="mt-3 w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-2.5 rounded-full text-xs">ЗАГРУЗИТЬ ЭТОТ ОПТИМУМ В РЕДАКТОР</button>
                      <div className="text-[10px] font-semibold text-slate-500 mt-2">Решатель делает BFS по состояниям (x,y,поворот,маска звёзд) для кратчайшего пути, затем перебором ищет лучшие повторы (до 4 команд, N≤10) и 2 функции (≤5) минимизируя общее число блоков.</div>
                    </>
                  }
                </div>
              )}

              <div className="text-[10px] font-bold text-slate-500 leading-relaxed bg-slate-50 border rounded-2xl p-3">
                Подсказка: поле можно менять — ставьте шипы и звёзды иначе, затем снова запускайте перебор. Алгоритм адаптируется под любое поле 10×10.
              </div>
            </div>
          </div>
        </div> : <div className="bg-white rounded-[24px] shadow border p-5 text-center">
          <div className="w-10 h-10 mx-auto grid place-items-center bg-slate-900 text-white rounded-full">🔒</div>
          <div className="font-black text-xs mt-2 tracking-widest">СКРЫТЫЙ РАЗДЕЛ</div>
          <div className="text-xs font-semibold text-slate-500 mt-1">Введите PIN <b>2710</b> в шапке, чтобы увидеть оптимальные решения и запустить полный перебор.</div>
          <div className="mt-3 text-[11px] font-bold bg-slate-50 border rounded-full px-3 py-2">Подсказка учителя: ищите циклы в маршруте — функция до 5 команд сильно сокращает код.</div>
        </div>}

        <div className="bg-violet-600 text-white rounded-[24px] p-5 shadow">
          <h4 className="font-black text-xs tracking-widest">ОГРАНИЧЕНИЯ БЛОКОВ</h4>
          <div className="mt-3 space-y-2 text-xs font-bold">
            <div className="flex justify-between bg-white/10 rounded-full px-4 py-2"><span>- ВПЕРЁД</span><span>1 шаг</span></div>
            <div className="flex justify-between bg-white/10 rounded-full px-4 py-2"><span>- ПОВОРОТ НАЛЕВО/НАПРАВО</span><span>поворот</span></div>
            <div className="flex justify-between bg-amber-400 text-slate-900 rounded-full px-4 py-2"><span>- ПОВТОР N РАЗ (до 4 команд)</span><span>N≥2</span></div>
            <div className="flex justify-between bg-fuchsia-500 rounded-full px-4 py-2"><span>- ФУНКЦИЯ (до 5 команд) ×2</span><span>вызов 1 блок</span></div>
          </div>
        </div>
      </section>
    </main>

    <footer className="max-w-[1600px] mx-auto px-6 pb-8 text-[11px] font-bold text-slate-400 text-center">© 2026 ЗвездоСбор — тренажёр оптимальных алгоритмов • Двигай робота стрелками алгоритма, а не клавиатурой • Сделано для поиска кратчайших программ</footer>
  </div>
}






























