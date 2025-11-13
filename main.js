/* ...existing code... */
// Simple 2D platformer "Echo Step" - revised for Echo physics & visuals
// Added: Main menu, pause menu, level-complete flows, fade transitions, checkpoint respawn & proper restart behavior

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const status = document.getElementById('status');

let keys = {};
addEventListener('keydown', e => {
  // Prevent browser scrolling / default actions for controls
  if(['ArrowLeft','ArrowRight','ArrowUp',' ','Spacebar','e','E','r','R'].includes(e.key) || ['ArrowLeft','ArrowRight','ArrowUp'].includes(e.key)){
    e.preventDefault();
  }
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r') restartLevel();
  if (e.key === 'Escape') togglePause();
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

const TILE = 32;
const METER = TILE; // pixels per meter
const GRAV = 20 * METER; // pixels/s^2
const JUMP_V = -8 * METER; // upward velocity in pixels/s
const MAX_ECHO = 3;

// audio
const audioCtx = (typeof AudioContext !== 'undefined') ? new AudioContext() : null;
function playWhoosh(){
  if(!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = 800;
  g.gain.value = 0.0001;
  o.connect(g); g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  g.gain.linearRampToValueAtTime(0.08, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  o.frequency.exponentialRampToValueAtTime(350, now + 0.25);
  o.start(now); o.stop(now + 0.3);
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

class Rect {
  constructor(x,y,w,h){this.x=x;this.y=y;this.w=w;this.h=h;}
  intersects(r){return !(this.x+this.w<=r.x||this.x>=r.x+r.w||this.y+this.h<=r.y||this.y>=r.y+r.h);}
}
class Platform extends Rect {
  constructor(x,y,w,h, moving=null){super(x,y,w,h); this.moving = moving; this.dir = 1;}
  update(dt){ if(this.moving){ this.x += this.moving*dt; if(this.x < this.movingBounds?.[0] || this.x+this.w > this.movingBounds?.[1]) { this.moving *= -1; } } }
}
class Particle {
  constructor(x,y, vx, vy, color){
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.life = 0.5; this.age=0; this.color=color; this.size = Math.random()*2+1;
  }
  update(dt){ this.age+=dt; this.x += this.vx*dt; this.y += this.vy*dt; }
  draw(ctx){
    const a = clamp(1 - this.age/this.life,0,1);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.globalAlpha = 1;
  }
}

class Echo {
  constructor(x,y, vx, vy, mode){
    this.x = x; this.y = y; this.w = 22; this.h = 36;
    this.vx = vx; this.vy = vy;
    this.mode = mode;
    // moving echoes run until collision; give them effectively infinite life
    this.life = (mode === 'moving') ? Infinity : 5.0;
    this.age = 0;
    this.solid = true;
    this.opacity = 0.5;
    this.grounded = false;
    this.particles = [];
    this.colorCore = 'rgba(80,200,255,0.9)';
    this.timerBarColor = 'rgba(120,200,255,0.95)';
    this.id = Echo.nextId++;
    // Level 9: optionally ignore gravity until echo has passed both triggers
    this.ignoreGravityUntilTriggers = false;
    this.passedTriggers = false;
  }
  update(dt, platforms){
    this.age += dt;
    // Level 9: optionally ignore gravity until echo has passed both triggers
    if(this.ignoreGravityUntilTriggers && !this.passedTriggers){
      // do not apply gravity
    } else {
      if(!(this.mode==='static' && this.grounded)){
        this.vy += GRAV*dt;
      }
    }
    // moving echoes always travel horizontally until collision (no time cap)
    if(this.mode === 'moving'){
      this.x += this.vx * dt;
    } else {
      if(this.grounded){
        this.vx *= (1 - clamp(10*dt,0,1));
      }
      this.x += this.vx * dt;
    }
    this.y += this.vy * dt;
    this.grounded = false;
    const er = this.getRect();
    for(let p of platforms){
      if(er.intersects(p)){
        const overlapX = Math.min(er.x+er.w, p.x+p.w) - Math.max(er.x, p.x);
        const overlapY = Math.min(er.y+er.h, p.y+p.h) - Math.max(er.y, p.y);
        if(overlapY < overlapX){
          if(this.vy > 0){
            this.y = p.y - this.h - 0.01;
            this.vy = 0;
            this.grounded = true;
            if(this.mode==='fall') this.mode='static';
          } else if(this.vy < 0){
            this.y = p.y + p.h + 0.01;
            this.vy = 0;
          }
        } else {
          if(this.vx > 0){
            this.x = p.x - this.w - 0.01; this.vx = 0;
          } else if(this.vx < 0){
            this.x = p.x + p.w + 0.01; this.vx = 0;
          }
        }
        er.x = this.x; er.y = this.y;
      }
    }

    // Particle trails only when Echo is actively moving (mode === 'moving' and activeMoveTime > 0)
    if(this.mode === 'moving' && this.activeMoveTime > 0 && Math.abs(this.vx) > 0.1 && this.age < this.life){
      if(Math.random() < 0.6 * dt * 60){
        const px = this.x + this.w/2 + (Math.random()-0.5)*6;
        const py = this.y + this.h/2 + (Math.random()-0.5)*6;
        const pvx = -this.vx*0.1 + (Math.random()-0.5)*10;
        const pvy = (Math.random()-0.5)*10;
        this.particles.push(new Particle(px,py,pvx,pvy,'rgba(120,200,255,0.9)'));
      }
    }

    for(let p of this.particles) p.update(dt);
    this.particles = this.particles.filter(p=>p.age < p.life);
    if(this.life - this.age < 0.7){
      this.opacity = clamp((this.life - this.age)/0.7, 0, 1) * 0.5;
    }
    if(this.age >= this.life) this.solid = false;
  }
  getRect(){ return new Rect(this.x, this.y, this.w, this.h); }
  draw(ctx){
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = 'rgba(80,200,255,0.18)';
    roundRect(ctx, this.x-6, this.y-6, this.w+12, this.h+12, 6, true, false);
    drawCharacterAt(ctx, this.x, this.y, this.w, this.h, true);
    ctx.globalAlpha = 1;
    for(let p of this.particles) p.draw(ctx);
    const barW = this.w;
    const pct = clamp(1 - this.age/this.life, 0, 1);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = this.timerBarColor;
    ctx.fillRect(this.x, this.y - 8, barW * pct, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(this.x, this.y - 8, barW, 4);
    ctx.restore();
  }
}
Echo.nextId = 1;

function drawCharacterAt(ctx, x, y, w, h, blue=false){
  ctx.save();
  const px = x;
  const py = y;
  const body = blue ? '#8ee6ff' : '#ff9a2e';
  const head = blue ? '#bff3ff' : '#ffb57a';
  const pants = blue ? '#2b4a56' : '#30404a';
  const eye = '#0b1b22';
  ctx.fillStyle = body;
  roundRect(ctx, px + 6, py + 2, 10, 14, 2, true, false);
  ctx.fillStyle = head;
  roundRect(ctx, px + 4, py - 12, 14, 14, 2, true, false);
  ctx.fillStyle = pants;
  ctx.fillRect(px + 6, py + 16, 4, 12);
  ctx.fillRect(px + 12, py + 16, 4, 12);
  ctx.fillStyle = eye;
  ctx.fillRect(px + 9, py - 6, 2, 2);
  ctx.restore();
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){
  if(typeof r==='undefined') r=5;
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

// Player
const player = {
  x: 40, y: H - 160, w: 22, h: 36,
  vx:0, vy:0, speed: 5 * METER, onGround:false, facing:1
};

let platforms = [];
let echoes = [];
let hazards = [];
let flag = {x: 900, y: H-160, w:24, h:48};
let particles = [];
let lastTime = performance.now();
let won=false;
let screenShake = {time:0, magnitude:0};
let currentLevel = 1;
let flagActivated = false; // ensure single-use flag trigger

let lastMoveDir = 0;
let overlapWarn = {time:0, ttl:0.8};
let screenPulse = {time:0, ttl:0.18};
let echoBlockedWarn = {time:0, ttl:0.6};
let lastGroundWasEcho = false;

let leftButton = null, rightButton = null; // removed door variable to eliminate all door assets
let checkpoint = null; // For Level 3 ledge B respawn
let level10Bridge = null; // temporary bridge for Level 10
let walls = []; // walls that affect Echoes only
let centralPlatform = null; // used by Level 6
let gravityInverted = false; // reset gravity state per level
let level8StartY = null;
// store per-level start origin and baseY so other systems (physicsStep) can reference them
let currentBaseY = null;
let currentStartX = null;

// Add: declare globals used inside buildLevel to avoid "Cannot access uninitialized variable"
let gravityFlipZone = null;
let level9Triggers = [];
let level9SpawnedPlatform = null;
let debugMode = false;
let level9SpawnTime = 0;

// UI & flow
const overlayRoot = document.getElementById('overlay-root');
const mainMenu = document.getElementById('main-menu');
const pauseMenu = document.getElementById('pause-menu');
const levelComplete = document.getElementById('level-complete');
const youWin = document.getElementById('you-win');
const fadeLayer = document.getElementById('fade-layer');
const levelCounterEl = document.getElementById('level-counter');
const echoCountEl = document.getElementById('echo-count');
const echoBlockIconEl = document.getElementById('echo-block-icon');

// No clickable UI buttons — transitions are automatic.

let restartTimeout = null;
let levelAdvanceTimeout = null;
let finalWinAwaitKey = false;

// Buttons
// No clickable UI buttons — transitions are automatic.

function showOverlay(el){
  // ensure overlays are mutually exclusive: hide all then show the requested one
  [mainMenu, pauseMenu, levelComplete, youWin].forEach(o=>o.classList.add('hidden'));
  el.classList.remove('hidden');
}
function hideOverlay(el){
  el.classList.add('hidden');
}
function togglePause(){
  // Show/hide pause overlay without stopping game physics (player controls always available)
  if(!mainMenu.classList.contains('hidden') || !levelComplete.classList.contains('hidden') || !youWin.classList.contains('hidden')) return;
  if(pauseMenu.classList.contains('hidden')){
    showOverlay(pauseMenu);
  } else {
    hideOverlay(pauseMenu);
  }
}
let paused = false;
let unlocked = {1:true,2:false,3:false};

function startFromMenu(level){
  if(!unlocked[level]) return;
  hideOverlay(mainMenu);
  fadeTo(()=>{ buildLevel(level); hideFade(); }, 400);
}

function showMainMenu(){
  // show menu and unlock buttons reflect progression
  document.getElementById('play-l1').disabled = false;
  document.getElementById('play-l2').disabled = !unlocked[2];
  document.getElementById('play-l3').disabled = !unlocked[3];
  showOverlay(mainMenu);
  paused = true;
}

function showLevelCompleteFor(level){
  // ensure only the appropriate final/win flow for 9 levels
  document.getElementById('complete-title').textContent = `Level ${level} Complete!`;
  // show overlay then auto-advance after 0.2s for levels 1-8; level 9 -> final win
  if(level >= 9){
    hideOverlay(levelComplete);
    fadeTo(()=>{ showOverlay(youWin); hideFade(); finalWinAwaitKey = true; }, 400);
    return;
  }
  showOverlay(levelComplete);
  if(levelAdvanceTimeout) clearTimeout(levelAdvanceTimeout);
  levelAdvanceTimeout = setTimeout(()=>{ levelAdvanceTimeout = null; nextLevelFromComplete(); }, 200);
}

function nextLevelFromComplete(){
  hideOverlay(levelComplete);
  const target = Math.min(9, currentLevel+1);
  if(!unlocked[target]) unlocked[target] = true;
  fadeTo(()=>{ buildLevel(target); hideFade(); }, 400);
}

function restartLevel(){
  // automatic restart current level (fade then rebuild)
  if(restartTimeout) return;
  restartTimeout = setTimeout(()=>{
    restartTimeout = null;
    fadeTo(()=>{ buildLevel(currentLevel); hideFade(); }, 260);
  }, 1000); // 1s delay on death
}

function restartGame(){
  // restart from Level 1 and lock progression
  unlocked = {1:true,2:false,3:false};
  fadeTo(()=>{ buildLevel(1); hideFade(); }, 360);
}

function fadeTo(cb, ms=360){
  fadeLayer.classList.remove('hidden');
  fadeLayer.style.transition = `opacity ${ms}ms ease`;
  fadeLayer.style.opacity = 0;
  // force reflow then fade in
  requestAnimationFrame(()=>{
    fadeLayer.style.opacity = 1;
    setTimeout(()=>{
      cb();
      // fade out
      fadeLayer.style.opacity = 0;
      setTimeout(()=>{ if(fadeLayer) fadeLayer.classList.add('hidden'); if(cb){} }, ms);
    }, ms);
  });
}
function hideFade(){ fadeLayer.classList.add('hidden'); fadeLayer.style.opacity = 0; }

/* ...existing code... */
function buildLevel(level = 1){
  platforms = [];
  hazards = [];
  echoes = [];
  particles = [];
  won = false;
  flagActivated = false; // reset single-use flag per level
  lastMoveDir = 0;
  overlapWarn.time = 0;
  screenPulse.time = 0;
  echoBlockedWarn.time = 0;
  lastGroundWasEcho = false;
  leftButton = rightButton = null;
  checkpoint = null;
  level10Bridge = null;
  walls = [];
  centralPlatform = null;
  gravityInverted = false; // reset gravity state per level
  gravityFlipZone = null;
  level8StartY = null;
  // ensure Level 9 globals reset
  level9Triggers = [];
  level9SpawnedPlatform = null;
  level9SpawnTime = 0;

  const baseY = H - 120;
  // expose baseY and a level startX to module scope for other systems to use
  currentBaseY = baseY;
  currentStartX = null;

  // All levels regenerated from scratch according to new spec:
  // 1: Canyon Jump (2 gaps, Echo bridges)
  // 2: Button Race (fixed win logic: both buttons must be green to allow flag)
  // 3: Sky Climb (checkpoint on ledge B)
  // 4: Conveyor Chaos (moving platforms)
  // 5: Vertical Climb (5 floating platforms)
  // 6: Gravity Flip (switch inverts gravity) -- simple placeholder inversion zone
  // 7: Mirror Race (synchronized paths)
  // 8: Gravity Flip (safe start): start platform 3m wide, no hazards near spawn, gravity switch after gap
  // 9: Two triggers on ground -> 1.5m flag ledge (final playable level)
  // 10: EMPTY (reserved)

  if(level === 1){
    // Canyon Jump: three platforms separated by two gaps; echoes can bridge
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    platforms.push(new Platform(420, baseY, 180, 24));
    platforms.push(new Platform(720, baseY, 200, 24));
    flag = {x: 720 + 200 - 40, y: baseY - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 1;
  } else if(level === 2){
    // Button Race: left and right buttons must be pressed (player+echoes count)
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    const leftX = 320, rightX = 520;
    platforms.push(new Platform(leftX - 8, baseY, 140, 24));
    platforms.push(new Platform(rightX - 8, baseY, 140, 24));
    platforms.push(new Platform(740, baseY, 160, 24));
    leftButton = {x: leftX + 12, y: baseY - 14, w:28, h:12, pressedBy: new Set(), pressed:false};
    rightButton = {x: rightX + 12, y: baseY - 14, w:28, h:12, pressedBy: new Set(), pressed:false};
    // DOOR REMOVED: keep only flag as win object per spec
    flag = {x: 740 + 80, y: baseY - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 2;
  } else if(level === 3){
    // Sky Climb (checkpoint removed per fix): player must restart from level start on death
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 200, 24));
    platforms.push(new Platform(320, baseY - 1.2*METER, 140, 20)); // A
    platforms.push(new Platform(560, baseY - 2.5*METER, 160, 20)); // B (ledges remain, but no checkpoint)
    checkpoint = null;
    platforms.push(new Platform(760, baseY - 2.5*METER, 120, 20));
    flag = {x: 760 + 80, y: baseY - 2.5*METER - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 3;
  } else if(level === 4){
    // Conveyor Chaos: moving platform section
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    const conv = new Platform(320, baseY, 160, 20, 1.6 * METER);
    conv.movingBounds = [280, 520];
    platforms.push(conv);
    platforms.push(new Platform(620, baseY, 180, 24));
    flag = {x: 760, y: baseY - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 4;
  } else if(level === 5){
    // Vertical Climb: 5 floating platforms upward; final before flag is safe
    const startX = 40;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 180, 24));
    const gap = 2.0 * METER;
    for(let i=0;i<5;i++){
      const px = startX + i*48;
      const py = baseY - (i+1)*gap;
      platforms.push(new Platform(px, py, 140, 18));
    }
    // final safe platform and flag
    const finalPlatX = startX + 320;
    const finalPlatY = baseY - 5*gap + 0;
    platforms.push(new Platform(finalPlatX, finalPlatY, 160, 20));
    flag = {x: finalPlatX + 120, y: finalPlatY - 48, w:24, h:48};
    player.x = startX + 20; player.y = baseY - player.h;
    currentLevel = 5;
  } else if(level === 6){
    // Gravity Flip: switch zone that inverts gravity for a short time (simple placeholder)
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    platforms.push(new Platform(360, baseY - 2.0*METER, 160, 20));
    // place a "switch" rectangle; actual inversion handled in physics step via a flag (simple toggle area)
    // We'll store a simple gravityFlipZone for physics to check
    gravityFlipZone = { x: 520, y: baseY - 40, w: 40, h: 40, active:false };
    platforms.push(new Platform(560, baseY - 3.4*METER, 120, 20));
    flag = {x: 560 + 80, y: baseY - 3.4*METER - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 6;
  } else if(level === 7){
    // Mirror Race: synchronized moving hazard/path pair
    const startX = 20;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    const p1 = new Platform(320, baseY, 140, 24);
    const p2 = new Platform(520, baseY, 140, 24);
    p1.moving = 0.8 * METER; p1.movingBounds = [300, 460];
    p2.moving = -0.8 * METER; p2.movingBounds = [500, 680];
    platforms.push(p1); platforms.push(p2);
    flag = {x: 720, y: baseY - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    currentLevel = 7;
  } else if(level === 8){
    // Gravity Flip (safe start): start platform 3m wide, no hazards near spawn, gravity switch after gap
    const startX = 20;
    const startPlatW = 3.0 * METER; // 3m wide
    platforms.push(new Platform(startX, baseY, startPlatW, 24)); // safe start
    // safe buffer: no hazards within 1.0m radius of start center (we simply don't add hazards here)
    // small gap then gravity flip zone
    platforms.push(new Platform(startX + startPlatW + 120, baseY, 140, 24));
    // gravity flip zone placed after gap
    gravityFlipZone = { x: startX + startPlatW + 80, y: baseY - 40, w: 40, h: 40, standTime:0, active:false, duration:3.0 };
    platforms.push(new Platform(560, baseY - 3.4*METER, 120, 20));
    flag = {x: 560 + 80, y: baseY - 3.4*METER - 48, w:24, h:48};
    player.x = startX + 40; player.y = baseY - player.h;
    level8StartY = player.y; // mark safe start Y for fall-death check
    currentLevel = 8;
  } else if(level === 9){
    // Level 9: two precise rectangular triggers (center-based meters -> pixels)
    const startX = 40;
    currentStartX = startX;
    platforms.push(new Platform(startX, baseY, 220, 24));
    // Triggers per spec (centers, world origin bottom-left of start platform):
    const trigW = 1.5 * METER, trigH = 0.5 * METER;
    const leftCenterX = 15.0, leftCenterY = 3.0;
    const rightCenterX = 20.0, rightCenterY = 3.0;
    // convert center coords relative to start platform origin (startX, baseY)
    const leftTx = startX + leftCenterX * METER - trigW/2;
    const leftTy = baseY - leftCenterY * METER - trigH/2;
    const rightTx = startX + rightCenterX * METER - trigW/2;
    const rightTy = baseY - rightCenterY * METER - trigH/2;
    level9Triggers = [
      { rect: new Rect(leftTx, leftTy, trigW, trigH), activeUntil:0, occupied:new Set(), lastActivatedAt:0 },
      { rect: new Rect(rightTx, rightTy, trigW, trigH), activeUntil:0, occupied:new Set(), lastActivatedAt:0 }
    ];
    leftButton = rightButton = null;
    level9SpawnedPlatform = null;
    // Flag platform center at (25.0, 4.0) size 2.0 x 0.5 -> convert to top-left
    const flagCenterX = 25.0, flagCenterY = 4.0, flagPlatW = 2.0 * METER, flagPlatH = 0.5 * METER;
    const flagPlatX = startX + flagCenterX * METER - flagPlatW/2;
    const flagPlatY = baseY - flagCenterY * METER - flagPlatH/2;
    platforms.push(new Platform(flagPlatX, flagPlatY, flagPlatW, flagPlatH));
    flag = { x: flagPlatX + flagPlatW/2 - 12, y: flagPlatY - 48, w:24, h:48 }; // keep flag sprite placement similar to rest of code
    player.x = startX + 20; player.y = baseY - player.h;
    currentLevel = 9;
  } else {
    // Level 10: Full implementation per spec
    // Platform: 30m wide, 1m high
    const platformW = 30 * METER;
    const platformH = 1 * METER;
    const platX = 0;
    const platY = baseY; // ground aligned
    platforms.push(new Platform(platX, platY, platformW, platformH));
    // Left and right walls: 0.25m from edges, width 0.5m, height 2m
    const wallW = 0.5 * METER, wallH = 2.0 * METER;
    const leftWallX = platX + 0.25 * METER;
    const rightWallX = platX + platformW - 0.25 * METER - wallW;
    platforms.push(new Platform(leftWallX, platY - wallH, wallW, wallH));
    platforms.push(new Platform(rightWallX, platY - wallH, wallW, wallH));
    // Buttons: 1m from left/right edges, size: 1m x 0.5m
    const btnW = 1.0 * METER, btnH = 0.5 * METER;
    leftButton = { x: platX + 1.0 * METER, y: platY - btnH, w: btnW, h: btnH, pressedBy: new Set(), pressed:false };
    rightButton = { x: platX + platformW - 1.0 * METER - btnW, y: platY - btnH, w: btnW, h: btnH, pressedBy: new Set(), pressed:false };
    // Flag: on ground, 14m from left edge
    const flagX = platX + 14.0 * METER;
    flag = { x: flagX, y: platY - 48, w:24, h:48 };
    // Player spawn at (15,1) in meters from left/top of platform region (convert to px)
    player.x = platX + 15 * METER;
    // y = 1m high means standing on top of 1m platform -> place player on top
    player.y = platY - player.h;
    currentLevel = 10;
  }

  // update unlocked progression when entering a level (ensures menu availability)
  if(level > 1) unlocked[level] = true;
  // Update visible level counter exactly when level changes
  if(levelCounterEl) levelCounterEl.textContent = `Level ${level}`;

  updateStatus();
}

// Remove any residual Level 6 variables in module scope by ensuring gravityFlipZone is declared only if used
gravityFlipZone = null;

function updateStatus(){
  // Only Level counter is shown per spec; keep this function minimal.
  if(levelCounterEl) levelCounterEl.textContent = `Level ${currentLevel}`;
  if(echoCountEl) echoCountEl.textContent = String(echoes.length);
  if(echoBlockIconEl) {
    if(echoes.length >= MAX_ECHO || echoBlockedWarn.time > 0) echoBlockIconEl.classList.remove('hidden');
    else echoBlockIconEl.classList.add('hidden');
  }
}

function willOverlapAny(rect){
  for(let e of echoes){
    if(e.getRect().intersects(rect)) return true;
  }
  return false;
}

function adjustSpawnPosition(x,y,w,h){
  const maxNudge = 0.6 * METER;
  const step = 0.1 * METER;
  let nx = x, ny = y;
  const testRect = (xx,yy)=> new Rect(xx,yy,w,h);
  const tries = [
    [0, -step],[ -step,0],[ step,0],[ -step, -step],[ step, -step],[0, -2*step],[ -2*step,0],[2*step,0]
  ];
  for(let i=0;i<=maxNudge/step;i++){
    for(let t of tries){
      const tx = nx + t[0]*i;
      const ty = ny + t[1]*i;
      let coll = false;
      for(let p of platforms){
        if(testRect(tx,ty).intersects(p)){ coll = true; break; }
      }
      if(!coll) return {x:tx,y:ty};
    }
  }
  return {x:nx,y:ny};
}

function spawnEcho(){
  const ew = 22, eh = 36;
  const movingHoriz = Math.abs(player.vx) > 10;
  const inAir = !player.onGround;
  let mode='static'; let vx=0, vy=0;
  if(inAir){ mode='fall'; vx = player.vx; vy = 0; }
  else if(movingHoriz){ mode='moving'; 
    // ensure echo speed matches player's speed (player.speed is in px/s)
    const dir = player.vx >= 0 ? 1 : -1;
    vx = dir * Math.abs(player.speed);
  vy = 0; }
  else { mode='static'; vx = 0; vy = 0; }

  // Block spawns if at MAX_ECHO (hard block, no auto-deletion)
  if(echoes.length >= MAX_ECHO){
    echoBlockedWarn.time = echoBlockedWarn.ttl;
    return;
  }

  let spawnX = player.x;
  let spawnY = player.y;
  if(mode === 'static'){
    // static: spawn under player's feet
    spawnX = player.x;
    spawnY = player.y + player.h - eh;
  } else if(mode === 'moving'){
    // moving: spawn 0.5 meters ahead of player (in movement direction)
    const dir = player.vx >= 0 ? 1 : -1;
    spawnX = player.x + dir * (0.5 * METER + player.w * 0.5);
    spawnY = player.y;
    vx = player.vx;
  } else {
    // mid-air: spawn at player and fall immediately
    spawnX = player.x;
    spawnY = player.y;
    vx = player.vx;
    vy = 0;
  }

  const adj = adjustSpawnPosition(spawnX, spawnY, ew, eh);
  spawnX = adj.x; spawnY = adj.y;

  if(willOverlapAny(new Rect(spawnX, spawnY, ew, eh))){
    overlapWarn.time = overlapWarn.ttl;
    return;
  }

  const e = new Echo(spawnX, spawnY, vx, vy, mode);
  echoes.push(e);

  if(mode === 'static'){
    // snap player up by 0.3 meters so they stand cleanly on the Echo (no overlap)
    const snapUp = 0.3 * METER;
    player.y = e.y - player.h - 0.01 - snapUp;
    player.vy = 0;
    player.onGround = true;
    if(audioCtx) { try { if(audioCtx.state === 'suspended') audioCtx.resume(); } catch(ex){}; playWhoosh(); }
  } else if(mode === 'fall'){
    const pr = new Rect(player.x, player.y, player.w, player.h);
    if(pr.intersects(e.getRect())){
      player.y = e.y - player.h - 0.01;
      player.vy = 0;
      player.onGround = true;
    }
  }

  screenPulse.time = screenPulse.ttl;
  screenShake.time = 0.12; screenShake.magnitude = 4;
  updateStatus();
}

function physicsStep(dt){
  let ax = 0;
  if(keys['arrowleft']||keys['a']) ax = -1;
  if(keys['arrowright']||keys['d']) ax = 1;
  if(ax !== 0) lastMoveDir = ax;
  else if(Math.abs(player.vx) > 6) lastMoveDir = player.vx > 0 ? 1 : -1;

  const accel = 2000;
  if(ax !== 0){
    player.vx = clamp(player.vx + ax * accel * dt, -player.speed, player.speed);
  } else {
    player.vx = player.vx * (1 - clamp(8*dt,0,1));
    if(Math.abs(player.vx) < 6) player.vx = 0;
  }
  if(player.vx>0) player.facing=1; if(player.vx<0) player.facing=-1;

  if((keys['arrowup']||keys['w']||keys[' ']) && player.onGround && !keys._handledJump){
    player.vy = JUMP_V; player.onGround = false;
    if(lastGroundWasEcho){
      for(let i=0;i<8;i++){
        const px = player.x + player.w/2 + (Math.random()-0.5)*20;
        const py = player.y + player.h;
        particles.push(new Particle(px, py, (Math.random()-0.5)*40, -30 + Math.random()*10, 'rgba(120,200,255,0.95)'));
      }
    }
    lastGroundWasEcho = false;
    keys._handledJump = true;
    spawnJumpHint();
  }
  if(!keys['arrowup'] && !keys['w'] && !keys[' ']) keys._handledJump = false;

  if(keys['e'] && !keys._handledE){
    spawnEcho();
    keys._handledE = true;
  }
  if(!keys['e']) keys._handledE = false;

  // apply gravity respecting inversion
  player.vy += (gravityInverted ? -GRAV : GRAV) * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // --- Start of added block: build colliders array including world platforms and echoes ---
  const colliders = [];
  // world/platform colliders: provide simple rects and mark as 'world' source
  for (let p of platforms) {
    colliders.push({ rect: new Rect(p.x, p.y, p.w, p.h), src: 'world' });
  }
  // echo colliders (solid echoes)
  for (let e of echoes) {
    if (e.solid) colliders.push({ rect: e.getRect(), src: e });
  }
  // --- End of added block ---

  const playerRect = new Rect(player.x, player.y, player.w, player.h);
  for(let pObj of colliders){
    const p = pObj.rect;
    if(playerRect.intersects(p)){
      const overlapX = Math.min(playerRect.x+playerRect.w, p.x+p.w) - Math.max(playerRect.x, p.x);
      const overlapY = Math.min(playerRect.y+playerRect.h, p.y+p.h) - Math.max(playerRect.y, p.y);
      if(overlapY < overlapX){
        if(player.vy > 0){
          player.y = p.y - player.h - 0.01;
          player.vy = 0;
          player.onGround = true;
          if(pObj.src !== 'world') lastGroundWasEcho = true;
        } else if(player.vy < 0){
          player.y = p.y + p.h + 0.01;
          player.vy = 0;
        }
      } else {
        if(player.vx > 0){
          player.x = p.x - player.w - 0.01; player.vx = 0;
        } else if(player.vx < 0){
          player.x = p.x + p.w + 0.01; player.vx = 0;
        }
      }
      playerRect.x = player.x; playerRect.y = player.y;
    }
  }

  for(let e of echoes){
    e.update(dt, platforms);
  }

  // Buttons and door logic for Level 2: both buttons must be green to allow flag advance.
  if(currentLevel === 2 && leftButton){
    leftButton.pressedBy.clear();
    rightButton.pressedBy.clear();
    const playerId = 'player';
    const playerRectForButtons = new Rect(player.x, player.y, player.w, player.h);
    if(playerRectForButtons.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
      leftButton.pressedBy.add(playerId);
    }
    if(playerRectForButtons.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
      rightButton.pressedBy.add(playerId);
    }
    for(let e of echoes){
      if(!e.solid) continue;
      const er = e.getRect();
      if(er.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
        leftButton.pressedBy.add(e.id);
      }
      if(er.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
        rightButton.pressedBy.add(e.id);
      }
    }
    leftButton.pressed = leftButton.pressedBy.size > 0;
    rightButton.pressed = rightButton.pressedBy.size > 0;
    // no door auto-open here besides visual; flag win later checks both pressed.
  }

  if(currentLevel === 10 && leftButton && rightButton){
    // Build activated sets each frame (player + active echoes)
    leftButton.pressedBy.clear();
    rightButton.pressedBy.clear();
    const playerId = 'player';
    const playerRectForButtons = new Rect(player.x, player.y, player.w, player.h);
    if(playerRectForButtons.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
      leftButton.pressedBy.add(playerId);
    }
    if(playerRectForButtons.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
      rightButton.pressedBy.add(playerId);
    }
    for(let e of echoes){
      if(!e.solid) continue;
      const er = e.getRect();
      if(er.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
        leftButton.pressedBy.add(e.id);
      }
      if(er.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
        rightButton.pressedBy.add(e.id);
      }
    }
    const nowSec = performance.now()/1000;
    if(leftButton.pressedBy.size > 0){
      leftButton.lastPressedAt = nowSec;
    }
    if(rightButton.pressedBy.size > 0){
      rightButton.lastPressedAt = nowSec;
    }
    leftButton.pressed = (nowSec - leftButton.lastPressedAt) <= leftButton.ttl;
    rightButton.pressed = (nowSec - rightButton.lastPressedAt) <= rightButton.ttl;

    // central platform activation: active only when both buttons are green simultaneously
    const central = platforms.find(p=>p.vertical);
    if(central){
      const bothActive = leftButton.pressed && rightButton.pressed;
      if(bothActive && !central.active){
        central.active = true;
      } else if(!bothActive && central.active){
        // If either button goes red, platform stops moving and resets to base position
        central.active = false;
        // reset to base Y immediately (requires player to re-trigger)
        central.y = central.baseY;
      }
      // If active, move platform up until targetY, then hold (flag reachable)
      if(central.active){
        central.y = Math.max(central.targetY, central.y - central.moveSpeed * dt);
        // update rect so collisions work
      }
    }
  }

  // Use exact Level 2 button logic for Level 10 as well: buttons track player + echoes; pressed when >=1 object present; no TTL
  if((currentLevel === 10 || currentLevel === 2) && leftButton){
    leftButton.pressedBy.clear();
    if(rightButton) rightButton.pressedBy.clear();
    const playerId = 'player';
    const playerRectForButtons = new Rect(player.x, player.y, player.w, player.h);
    if(playerRectForButtons.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
      leftButton.pressedBy.add(playerId);
    }
    if(rightButton && playerRectForButtons.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
      rightButton.pressedBy.add(playerId);
    }
    for(let e of echoes){
      if(!e.solid) continue;
      const er = e.getRect();
      if(er.intersects(new Rect(leftButton.x, leftButton.y, leftButton.w, leftButton.h))){
        leftButton.pressedBy.add(e.id);
      }
      if(rightButton && er.intersects(new Rect(rightButton.x, rightButton.y, rightButton.w, rightButton.h))){
        rightButton.pressedBy.add(e.id);
      }
    }
    leftButton.pressed = leftButton.pressedBy.size > 0;
    if(rightButton) rightButton.pressed = rightButton.pressedBy.size > 0;
  }

  // Build colliders used for trigger entry detection: player + echoes
  const collidersForTriggers = [];
  collidersForTriggers.push({ id: 'player', rect: new Rect(player.x, player.y, player.w, player.h), sizeOk: true });
  for(let e of echoes){
    if(!e.solid) continue;
    collidersForTriggers.push({ id: e.id, rect: e.getRect(), sizeOk: (e.w >= player.w*0.7 && e.h >= player.h*0.7) });
  }

  // Level 9 trigger handling (activation & spawn) - ensure gravity always applies to echoes and spawn platform specifics
  if(currentLevel === 9 && level9Triggers.length === 2){
    const now = performance.now()/1000;
    for(let t of level9Triggers){
      // detect entry events (only count player-sized or echo-sized colliders)
      for(let c of collidersForTriggers){
        const intersects = c.rect.intersects(t.rect);
        if(intersects && !t.occupied.has(c.id) && c.sizeOk){
          // entry -> activate for 3s and particle burst
          t.lastActivatedAt = now; t.activeUntil = now + 3.0;
          // particle burst
          for(let i=0;i<18;i++){
            particles.push(new Particle(
              t.rect.x + Math.random()*t.rect.w,
              t.rect.y + Math.random()*t.rect.h,
              (Math.random()-0.5)*80, (Math.random()-0.5)*80, 'rgba(120,255,140,0.95)'
            ));
          }
        }
        if(intersects) t.occupied.add(c.id); else t.occupied.delete(c.id);
      }
    }
    // spawn platform only if both triggers active simultaneously -> spawn at (20,3) size 2m x 0.5m
    const bothActive = level9Triggers.every(t=> (performance.now()/1000) < t.activeUntil );
    if(bothActive && !level9SpawnedPlatform){
      // spawn platform center must be exactly at (20.0, 4.0) meters -> validate and convert to top-left
      const spawnCenterX = 20.0, spawnCenterY = 4.0, spawnW = 2.0 * METER, spawnH = 0.5 * METER;
      // convert relative to stored start platform origin and baseY
      const sx = (typeof currentStartX === 'number') ? currentStartX + spawnCenterX * METER - spawnW/2 : spawnCenterX * METER - spawnW/2;
      const sy = currentBaseY - spawnCenterY * METER - spawnH/2;
      // ensure y is corrected to exact center.y = 4.0 if any misplacement
      level9SpawnedPlatform = { x: sx, y: sy, w: spawnW, h: spawnH, timer: 4.0, centerX: spawnCenterX, centerY: spawnCenterY };
      platforms.push(new Platform(sx, sy, spawnW, spawnH));
    }
    if(level9SpawnedPlatform){
      // enforce y correction rule: if spawn platform's center Y differs, auto-correct to y=4.0
      const expectedCenterYpx = currentBaseY - 4.0 * METER;
      const currentCenterYpx = level9SpawnedPlatform.y + level9SpawnedPlatform.h/2;
      if(Math.abs(currentCenterYpx - expectedCenterYpx) > 1){
        // adjust platform top-left so its center Y becomes exactly 4.0 meters
        const correctedY = currentBaseY - 4.0 * METER - level9SpawnedPlatform.h/2;
        for(let p of platforms){
          if(Math.abs(p.x - level9SpawnedPlatform.x) < 1 && Math.abs(p.w - level9SpawnedPlatform.w) < 1){
            p.y = correctedY;
          }
        }
        level9SpawnedPlatform.y = correctedY;
      }
      level9SpawnedPlatform.timer -= dt;
      if(level9SpawnedPlatform.timer <= 0){
        platforms = platforms.filter(p=> !(Math.abs(p.x - level9SpawnedPlatform.x) < 1 && Math.abs(p.y - level9SpawnedPlatform.y) < 1));
        level9SpawnedPlatform = null;
      }
    }
  }

  let anyExpiredUnderPlayer = false;
  for(let h of hazards){
    h.x += h.vx * dt;
    if(h.x < h.min || h.x + h.w > h.max) h.vx *= -1;
  }

  // Echo expiry handling: when echoes expire, we now simply let them become non-solid (handled above)
  const removedEchoIds = [];
  echoes = echoes.filter(e=>{
    for(let h of hazards){
      const hr = new Rect(h.x, h.y, h.w, h.h);
      if(e.getRect().intersects(hr)){
        removedEchoIds.push(e.id);
        return false;
      }
    }
    if(e.age >= e.life){
      const er = e.getRect();
      const playerFeet = new Rect(player.x, player.y + player.h - 2, player.w, 2);
      if(playerFeet.intersects(er)){
        // create shake when an Echo under player expires
        screenShake.time = 0.25;
        screenShake.magnitude = 6;
      }
      removedEchoIds.push(e.id);
      return false;
    }
    return true;
  });
  if(removedEchoIds.length){
    for(let id of removedEchoIds){
      if(leftButton) leftButton.pressedBy.delete(id);
      if(rightButton) rightButton.pressedBy.delete(id);
    }
    if(leftButton) leftButton.pressed = leftButton.pressedBy.size > 0;
    if(rightButton) rightButton.pressed = rightButton.pressedBy.size > 0;
  }

  if(anyExpiredUnderPlayer){
    screenShake.time = 0.25;
    screenShake.magnitude = 6;
  }

  for(let h of hazards){
    const hr = new Rect(h.x, h.y, h.w, h.h);
    if(playerRect.intersects(hr)){
      // restart only current level
      restartLevel();
    }
  }

  // Flag interactions & completion: update to consider level 9 as final win
  const flagRect = new Rect(flag.x, flag.y, flag.w, flag.h);
  const playerRectEnd = new Rect(player.x, player.y, player.w, player.h);

  // Levels 1-9 auto-advance on flag touch (Level 2 requires buttons), Level 9 should now go to Level 10
  if(currentLevel <= 9){
    if(playerRectEnd.intersects(flagRect)){
      // For Level 2 specifically require both buttons green to allow win; for others flag touch always valid.
      if(currentLevel === 2){
        const bothActive = leftButton && rightButton && leftButton.pressed && rightButton.pressed;
        if(!bothActive){
          // do nothing if buttons not both green
        } else {
          if(!flagActivated){
            flagActivated = true;
            setTimeout(()=>{
              const next = currentLevel + 1;
              if(!unlocked[next]) unlocked[next] = true;
              fadeTo(()=>{ buildLevel(next); hideFade(); }, 200);
            }, 200);
          }
        }
      } else {
        if(!flagActivated){
          flagActivated = true;
          setTimeout(()=>{
            const next = currentLevel + 1;
            if(!unlocked[next]) unlocked[next] = true;
            fadeTo(()=>{ buildLevel(next); hideFade(); }, 200);
          }, 200);
        }
      }
    }
  } else if(currentLevel === 9){
    // (NOOP) handled above by currentLevel <= 9 clause - retained for clarity
  }

  // Level 10: touching the ground flag after both buttons active triggers final win screen
  if(currentLevel === 10){
    if(playerRectEnd.intersects(flagRect)){
      const bothActive = leftButton && rightButton && leftButton.pressed && rightButton.pressed;
      if(bothActive && !flagActivated){
        flagActivated = true;
        // show final win overlay after a short fade and await any key to restart
        fadeTo(()=>{
          showOverlay(youWin);
          hideFade();
          finalWinAwaitKey = true;
        }, 200);
      }
    }
  }

  // Fall / death logic: Level 8 requires falling 2.0m below start before death; others keep original behavior
  if(currentLevel === 8 && level8StartY != null){
    if(player.y > level8StartY + 2.0 * METER){
      // restart level after fall beyond safe threshold
      fadeTo(()=>{ buildLevel(currentLevel); hideFade(); }, 120);
      return;
    }
  } else {
    if(player.y > H + 20){
      // Always restart the level on fall (Level 3 no longer has a checkpoint)
      fadeTo(()=>{ buildLevel(currentLevel); hideFade(); }, 120);
      return; // bail out of physics step so we don't continue with stale state
    }
  }

  // Checkpoint detection for Level 3: when player reaches ledge B, set checkpoint
  // checkpoint logic removed per spec - no respawn shortcut on Level 3
}

function drawGrid(){
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for(let x=0;x<W;x+=32){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  }
  for(let y=0;y<H;y+=32){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
}

function drawGuides(){
  for(let i=0;i<platforms.length-1;i++){
    const a = platforms[i], b = platforms[i+1];
    if(Math.abs(a.y - b.y) < 6){
      const gapStart = a.x + a.w;
      const gapEnd = b.x;
      const gapW = gapEnd - gapStart;
      if(gapW > 20 && gapW < 300){
        const cx = gapStart + gapW/2;
        const cy = a.y - 18;
        const t = (performance.now()/800)%1;
        const pulse = 0.6 + 0.4*Math.sin(t*Math.PI*2);
        ctx.save();
        ctx.globalAlpha = 0.35 * pulse;
        ctx.strokeStyle = 'rgba(72,192,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, gapW*0.45, 14 + 8*pulse, 0, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
        if(Math.random() < 0.02){
          const px = gapStart + Math.random()*gapW;
          const py = cy + (Math.random()-0.5)*8;
          particles.push(new Particle(px, py, (Math.random()-0.5)*6, -6 + Math.random()*4, 'rgba(120,200,255,0.95)'));
        }
      }
    }
  }
}

function spawnJumpHint(){
  const dir = player.vx > 20 ? 1 : (player.vx < -20 ? -1 : 0);
  if(dir === 0) return;
  for(let p of platforms){
    if(dir > 0 && p.x > player.x){
      if(Math.abs(p.y - player.y) < 8){
        const gapStart = player.x + player.w;
        const gapEnd = p.x;
        const gapW = gapEnd - gapStart;
        if(gapW > 20 && gapW < 300){
          for(let i=0;i<6;i++){
            const x = gapStart + Math.random()*gapW;
            const y = p.y - 20 + Math.random()*10;
            particles.push(new Particle(x,y, (Math.random()-0.5)*10, -12 + Math.random()*6, 'rgba(120,200,255,0.9)'));
          }
        }
      }
    }
  }
}

function draw(now){
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if(screenShake.time > 0){
    screenShake.time -= Math.min(0.016, 1/60);
    const mag = screenShake.magnitude * (screenShake.time/0.12);
    const sx = (Math.random()*2-1)*mag;
    const sy = (Math.random()*2-1)*mag;
    ctx.translate(sx, sy);
  } else {
    screenShake.time = 0; screenShake.magnitude = 0;
  }

  ctx.fillStyle = '#071827';
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle = '#0f2630';
  ctx.fillRect(0,H-90,160,90);
  ctx.fillRect(W-160,H-90,160,90);

  for(let p of platforms){
    ctx.fillStyle = '#16323b';
    roundRect(ctx, p.x, p.y, p.w, p.h, 4, true, false);
    ctx.fillStyle = '#2a4b54';
    ctx.fillRect(p.x+4, p.y-4, p.w-8, 3);
    const t = (performance.now()/700)%1;
    const pulse = 0.5 + 0.5*Math.sin(t*Math.PI*2);
    ctx.strokeStyle = `rgba(72,192,255,${0.18 + 0.25*pulse})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x-2, p.y-2, p.w+4, p.h+4);
  }

  drawGuides();

  for(let e of echoes) e.draw(ctx);

  drawCharacterAt(ctx, player.x, player.y, player.w, player.h, false);

  for(let p of particles) p.update(Math.min(1/60,0.016));
  for(let p of particles) p.draw(ctx);
  particles = particles.filter(p=>p.age < p.life);

  if(currentLevel === 2){
    const canWin = leftButton && rightButton && leftButton.pressed && rightButton.pressed;
    ctx.fillStyle = '#fff';
    ctx.fillRect(flag.x-4, flag.y-6, 6, flag.h+6);
    ctx.fillStyle = canWin ? '#00FF00' : '#ff3333';
    ctx.beginPath(); ctx.moveTo(flag.x+2, flag.y+6); ctx.lineTo(flag.x+34, flag.y+18); ctx.lineTo(flag.x+2, flag.y+30); ctx.closePath(); ctx.fill();
    if(canWin){
      ctx.save();
      const t = (performance.now()/500)%1;
      const pulse = 0.35 + 0.25*Math.sin(t*Math.PI*2);
      ctx.globalAlpha = 0.55 * pulse;
      ctx.fillStyle = '#00FF00';
      ctx.beginPath(); ctx.moveTo(flag.x+2, flag.y+6); ctx.lineTo(flag.x+34, flag.y+18); ctx.lineTo(flag.x+2, flag.y+30); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(flag.x-4, flag.y-6, 6, flag.h+6);
    // For Level 10, flag is red until both buttons active; copy Level 2 visual behaviour but use Level 10 button state
    if(currentLevel === 10){
      const canWin = leftButton && rightButton && leftButton.pressed && rightButton.pressed;
      ctx.fillStyle = canWin ? '#00FF00' : '#ff3333';
      ctx.beginPath(); ctx.moveTo(flag.x+2, flag.y+6); ctx.lineTo(flag.x+34, flag.y+18); ctx.lineTo(flag.x+2, flag.y+30); ctx.closePath(); ctx.fill();
      if(canWin){
        ctx.save();
        const t = (performance.now()/500)%1;
        const pulse = 0.35 + 0.25*Math.sin(t*Math.PI*2);
        ctx.globalAlpha = 0.55 * pulse;
        ctx.fillStyle = '#00FF00';
        ctx.beginPath(); ctx.moveTo(flag.x+2, flag.y+6); ctx.lineTo(flag.x+34, flag.y+18); ctx.lineTo(flag.x+2, flag.y+30); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#00FF00';
      ctx.beginPath(); ctx.moveTo(flag.x+2, flag.y+6); ctx.lineTo(flag.x+34, flag.y+18); ctx.lineTo(flag.x+2, flag.y+30); ctx.closePath(); ctx.fill();
    }
  }

  if(currentLevel === 2 && leftButton){
    ctx.fillStyle = leftButton.pressed ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(leftButton.x, leftButton.y, leftButton.w, leftButton.h);
    ctx.fillStyle = rightButton.pressed ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(rightButton.x, rightButton.y, rightButton.w, rightButton.h);
    ctx.fillStyle = '#cfefff';
    ctx.font = '12px monospace';
    ctx.fillText(`${leftButton.pressedBy.size}/${1 + MAX_ECHO}`, leftButton.x + leftButton.w/2 - 12, leftButton.y - 8);
    ctx.fillText(`${rightButton.pressedBy.size}/${1 + MAX_ECHO}`, rightButton.x + rightButton.w/2 - 12, rightButton.y - 8);
    // Door removed per spec: no door sprite/text here
  }

  // Draw Level 10 buttons with Level 2 visuals (red square with pulsing border when inactive)
  if(currentLevel === 10 && leftButton && rightButton){
    // left
    ctx.fillStyle = leftButton.pressed ? '#2ecc71' : '#FF0000';
    roundRect(ctx, leftButton.x, leftButton.y, leftButton.w, leftButton.h, 4, true, false);
    if(!leftButton.pressed){
      ctx.save();
      const t = (performance.now()/500)%1;
      const pulse = 0.6 + 0.4*Math.sin(t*Math.PI*2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,80,80,${0.6*pulse})`;
      ctx.strokeRect(leftButton.x-2, leftButton.y-2, leftButton.w+4, leftButton.h+4);
      ctx.restore();
    }
    // right
    ctx.fillStyle = rightButton.pressed ? '#2ecc71' : '#FF0000';
    roundRect(ctx, rightButton.x, rightButton.y, rightButton.w, rightButton.h, 4, true, false);
    if(!rightButton.pressed){
      ctx.save();
      const t = (performance.now()/500)%1;
      const pulse = 0.6 + 0.4*Math.sin(t*Math.PI*2);
      ctx.lineWidth = 7;
      ctx.strokeStyle = `rgba(255,80,80,${0.6*pulse})`;
      ctx.strokeRect(rightButton.x-2, rightButton.y-2, rightButton.w+4, rightButton.h+4);
      ctx.restore();
    }
    // counts
    ctx.fillStyle = '#cfefff';
    ctx.font = '12px monospace';
    ctx.fillText(leftButton.pressedBy ? `${leftButton.pressedBy.size}/${1 + MAX_ECHO}` : '0', leftButton.x + 4, leftButton.y - 8);
    ctx.fillText(rightButton.pressedBy ? `${rightButton.pressedBy.size}/${1 + MAX_ECHO}` : '0', rightButton.x + 4, rightButton.y - 8);
  }

  // Draw exclamation (!) icon above player when E blocked
  if(echoBlockedWarn.time > 0 || echoes.length >= MAX_ECHO){
    // simple timer decay for visual
    echoBlockedWarn.time = Math.max(0, echoBlockedWarn.time - Math.min(0.016, 1/60));
    const ix = player.x + player.w/2;
    const iy = player.y - 26;
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.arc(ix, iy, 10, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', ix, iy + 4);
    ctx.textAlign = 'start';
  }

  // Draw persistent buttons with required visuals for Level 9
  if(currentLevel === 9){
    const leftActive = leftButton && leftButton.pressed;
    const rightActive = rightButton && rightButton.pressed;
    
    if(leftButton){
      // pulsing border for inactive, green fill + glow when active
      const bx = leftButton.x, by = leftButton.y, bw = leftButton.w, bh = leftButton.h;
      if(leftActive){
        // glow
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.2*Math.sin(performance.now()/160);
        ctx.fillStyle = '#00FF00';
        roundRect(ctx, bx-6, by-6, bw+12, bh+12, 6, true, false);
        ctx.restore();
        ctx.fillStyle = '#00FF00';
      } else {
        // red with pulsing border
        ctx.fillStyle = '#FF0000';
      }
      roundRect(ctx, bx, by, bw, bh, 4, true, false);
      // pulsing border for inactive
      if(!leftActive){
        ctx.save();
        const t = (performance.now()/500)%1;
        const pulse = 0.6 + 0.4*Math.sin(t*Math.PI*2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255,80,80,${0.6*pulse})`;
        ctx.strokeRect(bx-2, by-2, bw+4, bh+4);
        ctx.restore();
      }
      // small particle effect when active
      if(leftActive && Math.random() < 0.08){
        particles.push(new Particle(bx + Math.random()*bw, by + Math.random()*-8, (Math.random()-0.5)*20, -20+Math.random()*6, 'rgba(0,255,0,0.9)'));
      }
    }
    
    if(rightButton){
      const bx = rightButton.x, by = rightButton.y, bw = rightButton.w, bh = rightButton.h;
      if(rightActive){
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.2*Math.sin(performance.now()/160);
        ctx.fillStyle = '#00FF00';
        roundRect(ctx, bx-6, by-6, bw+12, bh+12, 6, true, false);
        ctx.restore();
        ctx.fillStyle = '#00FF00';
      } else {
        ctx.fillStyle = '#FF0000';
      }
      roundRect(ctx, bx, by, bw, bh, 4, true, false);
      if(!rightActive){
        ctx.save();
        const t = (performance.now()/500)%1;
        const pulse = 0.6 + 0.4*Math.sin(t*Math.PI*2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255,80,80,${0.6*pulse})`;
        ctx.strokeRect(bx-2, by-2, bw+4, bh+4);
        ctx.restore();
      }
      if(rightActive && Math.random() < 0.08){
        particles.push(new Particle(bx + Math.random()*bw, by + Math.random()*-8, (Math.random()-0.5)*20, -20+Math.random()*6, 'rgba(0,255,0,0.9)'));
      }
    }
    
    // ensure button labels / counts remain visible
    ctx.fillStyle = '#cfefff';
    ctx.font = '12px monospace';
    if(leftButton) ctx.fillText(leftButton.pressedBy ? `${leftButton.pressedBy.size}/${1 + MAX_ECHO}` : '0', leftButton.x + 4, leftButton.y - 8);
    if(rightButton) ctx.fillText(rightButton.pressedBy ? `${rightButton.pressedBy.size}/${1 + MAX_ECHO}` : '0', rightButton.x + 4, rightButton.y - 8);
  }

  // Drawing: add Level 9 trigger visuals & spawned platform highlight
  if(currentLevel === 9 && level9Triggers.length === 2){
    for(let t of level9Triggers){
      const nowSec = performance.now()/1000;
      const active = nowSec < t.activeUntil;
      ctx.save();
      // inactive: red outline (#FF0000) thickness 5px; active: green fill (#00FF00) 30% opacity + particle burst was handled on activation
      if(active){
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(t.rect.x, t.rect.y, t.rect.w, t.rect.h);
      } else {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#FF0000';
        ctx.strokeRect(t.rect.x, t.rect.y, t.rect.w, t.rect.h);
      }
      ctx.restore();
    }
    if(level9SpawnedPlatform){
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#9ad3ff';
      roundRect(ctx, level9SpawnedPlatform.x, level9SpawnedPlatform.y, level9SpawnedPlatform.w, level9SpawnedPlatform.h, 4, true, false);
      ctx.restore();
    }
  }

  // Debug indicator (top-right) only when debugMode true
  if(debugMode){
    ctx.save();
    ctx.fillStyle = '#FFD166';
    ctx.font = '14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('Debug Mode ON', W - 8, 22);
    ctx.restore();
  }

  ctx.restore();
}

function gameLoop(now){
  const dt = Math.min(0.032, (now - lastTime)/1000 || 0.016);
  lastTime = now;
  if(!paused) physicsStep(dt);
  draw(now);
  updateStatus();
  requestAnimationFrame(gameLoop);
}

// Initialize fade layer styles and menu
(function initUI(){
  // style fade layer and overlays minimally (fallback if CSS not edited)
  if(fadeLayer){
    fadeLayer.style.position = 'absolute';
    fadeLayer.style.left = '0';
    fadeLayer.style.top = '0';
    fadeLayer.style.width = '100%';
    fadeLayer.style.height = '100%';
    fadeLayer.style.background = '#000';
    fadeLayer.style.opacity = 0;
    fadeLayer.style.pointerEvents = 'none';
    fadeLayer.style.transition = 'opacity 300ms ease';
  }
  // Ensure no overlay text is visible at launch — UI appears only when triggered
  [mainMenu, pauseMenu, levelComplete, youWin].forEach(o=>o.classList.add('hidden'));
  fadeLayer.classList.add('hidden');
  // Pause overlay should not block input; overlays are exclusive via showOverlay()
})();

// Start
buildLevel(1);
requestAnimationFrame(gameLoop);

// Restart current level on R (always available). ESC toggles pause but no text shown.
addEventListener('keydown', e=>{
  const key = e.key.toLowerCase();
  if(key === 'r'){
    // immediate restart current level per spec (R key)
    fadeTo(()=>{ buildLevel(currentLevel); hideFade(); }, 260);
  } else if(e.key === 'Escape'){
    // toggle pause state; level counter remains visible
    paused = !paused;
  }
  // toggle debug with backtick (~ on many keyboards)
  if(e.key === '`') { debugMode = !debugMode; }
  // level switching when debug enabled: 1..9 -> levels 1..9, 0 -> level10
  if(debugMode){
    if('1234567890'.includes(key)){
      const lvl = (key === '0') ? 10 : parseInt(key,10);
      fadeTo(()=>{ buildLevel(lvl); hideFade(); }, 200);
    }
  }
  // If final win screen is active and any key pressed -> restart game
  if(finalWinAwaitKey && youWin && !youWin.classList.contains('hidden')){
    finalWinAwaitKey = false;
    // restart from level 1 per spec when pressing any key after winning
    restartGame();
  }
});