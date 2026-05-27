// Basic game elements and controls
const canvas = document.getElementById('gameCanvas'); // game drawing area
const ctx = canvas.getContext('2d'); // 2D rendering context
const leftBtn = document.getElementById('leftBtn'); // UI left button
const rightBtn = document.getElementById('rightBtn'); // UI right button
const restartBtn = document.getElementById('restartBtn'); // restart button
const info = document.getElementById('info'); // info/status text

/*
  game.js
  - Simple lane-based dodging game.
  - Player moves between 3 lanes; enemies spawn at the top and move down.
  - We expose `window.moveLeft` and `window.moveRight` so external code (blink.js)
    can control the player via blinks.
*/

// Road and lane configuration
const road = { x: 170, width: 300, height: canvas.height }; // road rectangle
const laneCount = 3; // number of lanes
const laneWidth = road.width / laneCount; // width per lane
const laneCenters = [road.x + laneWidth / 2, road.x + laneWidth * 1.5, road.x + laneWidth * 2.5]; // x positions for lanes

const player = { lane: 1, x: laneCenters[1], y: canvas.height - 120, w: 50, h: 90, color: '#28b' };
// Game state variables
let enemies = []; // list of enemy cars
let lastSpawn = 0; // ms accumulator since last spawn
let score = 0; // player score
const baseSpawnInterval = 2200; // ms between spawns (larger -> easier)
let spawnInterval = baseSpawnInterval; // current spawn interval (can change with difficulty)
const baseSpeed = 1.8; // initial enemy speed
let speed = baseSpeed; // current global enemy speed
const maxSpeed = 4.5; // cap for speed increases
let nextSpeedIncreaseAt = 200; // score milestone for next speed bump
let gameOver = false;
let lastTime = performance.now();

function resetGame() {
  enemies = []; // clear enemies
  lastSpawn = 0; // reset spawn timer
  score = 0; // reset score
  // Reset difficulty and state
  spawnInterval = baseSpawnInterval;
  speed = baseSpeed;
  nextSpeedIncreaseAt = 200;
  gameOver = false;
  player.lane = 1; // center lane
  player.x = laneCenters[player.lane]; // update player x
  info.textContent = 'Use as setas ←/→ ou os botões para desviar dos carros vermelhos.';
}

function spawnEnemy() {
  // Spawn an enemy in a random lane slightly above the canvas
  const lane = Math.floor(Math.random() * laneCount);
  const enemy = {
    lane,
    x: laneCenters[lane],
    y: -120, // start above viewport
    w: 50,
    h: 90,
    color: '#d33',
    speed: speed + Math.random() * 1.2 // add small random variation
  };
  enemies.push(enemy);
}

function drawRoad() {
  ctx.fillStyle = '#1f4f1f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#444';
  ctx.fillRect(road.x, 0, road.width, road.height);

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.strokeRect(road.x, 0, road.width, road.height);

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 16]);
  ctx.beginPath();
  ctx.moveTo(road.x + laneWidth, 0);
  ctx.lineTo(road.x + laneWidth, road.height);
  ctx.moveTo(road.x + 2 * laneWidth, 0);
  ctx.lineTo(road.x + 2 * laneWidth, road.height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#ffe';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 18]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, road.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCar(car) {
  ctx.fillStyle = car.color;
  ctx.fillRect(car.x - car.w / 2, car.y - car.h / 2, car.w, car.h);

  const wheelWidth = 12;
  const wheelHeight = 24;
  ctx.fillStyle = '#111';
  ctx.fillRect(car.x - car.w / 2 - 4, car.y - car.h / 2 + 10, wheelWidth, wheelHeight);
  ctx.fillRect(car.x + car.w / 2 - 8, car.y - car.h / 2 + 10, wheelWidth, wheelHeight);

  ctx.fillStyle = '#fff';
  ctx.fillRect(car.x - 16, car.y - car.h / 2 + 12, 32, 18);
}

function drawEnemies() {
  enemies.forEach(drawCar);
}

function update(dt) {
  if (gameOver) return;

  // spawn logic based on accumulated ms
  lastSpawn += dt;
  if (lastSpawn > spawnInterval) {
    lastSpawn = 0;
    spawnEnemy();
  }

  enemies.forEach((enemy) => {
    enemy.y += enemy.speed * dt / 16;
  });

  // remove enemies that passed the bottom and award points
  enemies = enemies.filter((enemy) => {
    if (enemy.y - enemy.h / 2 > canvas.height) {
      score += 10;
      return false; // drop from array
    }
    return true; // keep otherwise
  });

  enemies.forEach((enemy) => {
    if (
      Math.abs(enemy.x - player.x) < (player.w + enemy.w) / 2 - 10 &&
      Math.abs(enemy.y - player.y) < (player.h + enemy.h) / 2 - 10
    ) {
      gameOver = true;
      info.textContent = 'Colisão! Carrega em Reiniciar para tentar outra vez.';
    }
  });

  // gradual speed increases at score milestones
  // difficulty scaling: increase speed and slightly decrease spawn interval
  if (score >= nextSpeedIncreaseAt) {
    speed = Math.min(maxSpeed, speed + 0.3);
    nextSpeedIncreaseAt += 200; // next milestone
    // slightly tighten spawn interval but keep a lower bound
    spawnInterval = Math.max(900, spawnInterval - 120);
  }
}

function drawHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = '18px Arial';
  ctx.fillText(`Pontos: ${score}`, 12, 26);
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    ctx.fillStyle = '#f33';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2 + 10);
    ctx.textAlign = 'left';
  }
}

function cycleLane(direction) {
  if (gameOver) return;
  // clamp lane index and update player position
  player.lane = Math.max(0, Math.min(laneCount - 1, player.lane + direction));
  player.x = laneCenters[player.lane];
}

function moveLeft() {
  // Move player one lane to the left
  cycleLane(-1);
}

function moveRight() {
  // Move player one lane to the right
  cycleLane(1);
}

window.moveLeft = moveLeft;
window.moveRight = moveRight;

leftBtn.addEventListener('click', moveLeft);
rightBtn.addEventListener('click', moveRight);
restartBtn.addEventListener('click', resetGame);

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') moveLeft();
  if (event.key === 'ArrowRight') moveRight();
});

function draw() {
  drawRoad();
  drawCar(player);
  drawEnemies();
  drawHUD();
}

function loop(time) {
  const dt = time - lastTime;
  lastTime = time;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
