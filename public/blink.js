// DOM elements
const video = document.getElementById('video'); // <video> element for webcam stream
const blinkStatus = document.getElementById('blinkStatus'); // status text shown to user

/*
  blink.js
  - Uses MediaPipe FaceMesh to compute an eye openness ratio per eye.
  - Smooths values, runs a short calibration to learn the user's open-eye baseline,
    and detects left/right blinks by comparing the smoothed ratio to a dynamic
    threshold derived from the baseline.
  - When a blink is detected it calls `window.moveLeft()` or `window.moveRight()`.
*/

// Euclidean distance helper between two landmarks
// Euclidean distance between two landmark points
function dist(a,b){ const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx, dy); }

// Landmark index groups for left and right eye used by computeEAR
// Landmark indices for left and right eye (MediaPipe FaceMesh)
const LEFT = [33,160,158,133,153,144];
const RIGHT = [263,387,385,362,380,373];

/**
 * computeEyeRatio
 * Computes the eye openness ratio (vertical/horizontal) for an eye given landmark indices.
 * A smaller value means the eye is more closed.
 */
function computeEyeRatio(landmarks, idx){
  // extract six landmark points for the eye
  const p1 = landmarks[idx[0]]; // left corner
  const p2 = landmarks[idx[1]]; // upper inner
  const p3 = landmarks[idx[2]]; // upper outer
  const p4 = landmarks[idx[3]]; // right corner
  const p5 = landmarks[idx[4]]; // lower outer
  const p6 = landmarks[idx[5]]; // lower inner
  // measure vertical and horizontal distances
  const vertical = dist(p2, p6) + dist(p3, p5); // sum of two vertical segments
  const horizontal = dist(p1, p4) * 2.0; // approximate horizontal width
  return vertical / horizontal; // openness ratio: smaller -> more closed
}

// detection state
let leftClosed = false; // whether left blink event was already triggered
let rightClosed = false; // whether right blink event was already triggered
// parameters / thresholds
const THRESH = 0.18; // fallback open/closed threshold before calibration
const MIN_INTERVAL = 450; // ms between allowed triggers (debounce)
let lastTrigger = 0; // timestamp of last trigger
const SMOOTHING = 0.25; // EMA alpha for smoothing raw eye values
const MIN_CLOSED_FRAMES = 2; // consecutive frames below threshold to confirm closed
// smoothed signal holders
let smoothedLeftEye = 1.0; // filtered left eye ratio
let smoothedRightEye = 1.0; // filtered right eye ratio
// per-eye consecutive closed counters
let leftClosedFrames = 0;
let rightClosedFrames = 0;

// dynamic open-eye baselines (slowly adapt)
// Running averages for the user's open-eye baseline (updated during calibration)
// running baselines for open-eye values (learned via calibration/adaptation)
let openLeftAvg = 0;
let openRightAvg = 0;
const OPEN_ADAPT_ALPHA = 0.08; // rate to adapt baseline when eye appears open
const CLOSED_RATIO = 0.65; // fraction of openAvg below which we call it closed

// initial calibration: collect a short window of open-eye EARs to establish baseline
// initial calibration collection
const INITIAL_CALIB_FRAMES = 30; // number of frames to compute initial open-eye baseline
let calibFrames = 0; // how many calibration frames collected
let calibLeftSum = 0; // sum of left eye samples during calibration
let calibRightSum = 0; // sum of right eye samples during calibration

/**
 * onResults
 * Called by MediaPipe FaceMesh when new landmarks are available.
 * - computes per-eye ratios
 * - smooths values
 * - runs initial calibration (short window) to learn open-eye baseline
 * - compares smoothed ratios to dynamic thresholds and detects blinks
 */
function onResults(results){
  if(!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0){
    blinkStatus.textContent = 'Rosto não detetado'; // no face -> inform user and skip
    return;
  }
  const lm = results.multiFaceLandmarks[0];
  const leftEye = computeEyeRatio(lm, LEFT); // raw left eye ratio this frame
  const rightEye = computeEyeRatio(lm, RIGHT); // raw right eye ratio this frame
  const now = Date.now(); // current time for debounce logic

  // smoothing to reduce frame-to-frame noise
  // exponential moving average to smooth the raw measurements
  smoothedLeftEye = smoothedLeftEye * (1 - SMOOTHING) + leftEye * SMOOTHING;
  smoothedRightEye = smoothedRightEye * (1 - SMOOTHING) + rightEye * SMOOTHING;

  // initial calibration: collect a short window of samples to establish open-eye baseline
  // calibration period: gather a short window of samples to set initial baselines
  if (calibFrames < INITIAL_CALIB_FRAMES) {
    calibLeftSum += smoothedLeftEye;
    calibRightSum += smoothedRightEye;
    calibFrames += 1;
    blinkStatus.textContent = `Calibrando... ${calibFrames}/${INITIAL_CALIB_FRAMES}`;
    if (calibFrames === INITIAL_CALIB_FRAMES) {
      openLeftAvg = calibLeftSum / INITIAL_CALIB_FRAMES; // finalize left baseline
      openRightAvg = calibRightSum / INITIAL_CALIB_FRAMES; // finalize right baseline
      blinkStatus.textContent = 'Calibração concluída';
    }
  } else {
    // adapt open-eye averages when eyes appear open (use faster alpha)
    if (smoothedLeftEye > THRESH) {
      if (openLeftAvg === 0) openLeftAvg = smoothedLeftEye; // first-time init safety
      else openLeftAvg = openLeftAvg * (1 - OPEN_ADAPT_ALPHA) + smoothedLeftEye * OPEN_ADAPT_ALPHA; // gradual update
    }
    if (smoothedRightEye > THRESH) {
      if (openRightAvg === 0) openRightAvg = smoothedRightEye; // first-time init safety
      else openRightAvg = openRightAvg * (1 - OPEN_ADAPT_ALPHA) + smoothedRightEye * OPEN_ADAPT_ALPHA; // gradual update
    }
  }

  // compute dynamic closed thresholds
  // dynamic thresholds derived from per-user baseline (with a safe minimum)
  const leftDynamicThresh = openLeftAvg > 0 ? Math.max(0.12, openLeftAvg * CLOSED_RATIO) : THRESH;
  const rightDynamicThresh = openRightAvg > 0 ? Math.max(0.12, openRightAvg * CLOSED_RATIO) : THRESH;

  // update closed-frame counters using dynamic thresholds
  // increment per-eye counters when value stays below the dynamic threshold
  if (smoothedLeftEye < leftDynamicThresh) leftClosedFrames += 1;
  else leftClosedFrames = 0;

  if (smoothedRightEye < rightDynamicThresh) rightClosedFrames += 1;
  else rightClosedFrames = 0;

  // debug log (single-line compact) — use 'eye' in logs and UI to match wording
  // compact debug line: smoothed values, baselines, thresholds and frame counters
  console.log(`eye L:${smoothedLeftEye.toFixed(3)} R:${smoothedRightEye.toFixed(3)} | open L:${openLeftAvg.toFixed(3)} R:${openRightAvg.toFixed(3)} | thr L:${leftDynamicThresh.toFixed(3)} R:${rightDynamicThresh.toFixed(3)} | f L:${leftClosedFrames} R:${rightClosedFrames}`);

  // trigger when closed for enough consecutive frames and respecting interval
  // left blink detected: enough consecutive closed frames + debounce + not already triggered
  if (leftClosedFrames >= MIN_CLOSED_FRAMES && !leftClosed && now - lastTrigger > MIN_INTERVAL) {
    leftClosed = true; // mark triggered
    lastTrigger = now; // update debounce timestamp
    blinkStatus.textContent = `Pestanejo esquerdo — eye ${smoothedLeftEye.toFixed(2)}`; // UI
    if (window.moveLeft) window.moveLeft(); // perform game action
  }
  if (leftClosed && leftClosedFrames === 0) leftClosed = false; // reset when eye reopens

  // right blink detected (same logic as left)
  if (rightClosedFrames >= MIN_CLOSED_FRAMES && !rightClosed && now - lastTrigger > MIN_INTERVAL) {
    rightClosed = true;
    lastTrigger = now;
    blinkStatus.textContent = `Pestanejo direito — eye ${smoothedRightEye.toFixed(2)}`;
    if (window.moveRight) window.moveRight();
  }
  if (rightClosed && rightClosedFrames === 0) rightClosed = false;

  // when no eye is closed, show live smoothed values
  if (leftClosedFrames === 0 && rightClosedFrames === 0) {
    blinkStatus.textContent = `eye L:${smoothedLeftEye.toFixed(2)} R:${smoothedRightEye.toFixed(2)}`;
  }
}

const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
faceMesh.setOptions({maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.6, minTrackingConfidence:0.6});
faceMesh.onResults(onResults);

async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480}});
    video.srcObject = stream;
    await video.play();
    blinkStatus.textContent = 'Câmera ligada — piscadelas ativadas';
    const camera = new Camera(video, {
      onFrame: async () => await faceMesh.send({image: video}),
      width: 640,
      height: 480
    });
    camera.start();
  } catch(error){
    blinkStatus.textContent = 'Sem câmera disponível — conecte uma webcam para jogar com pestanejos.';
    console.error(error);
  }
}

startCamera();
// expose simulation helpers for debugging
window.simulateLeftBlink = function(){
  console.log('simulateLeftBlink()');
  blinkStatus.textContent = 'Simulação: pestanejo esquerdo';
  if (window.moveLeft) window.moveLeft();
};
window.simulateRightBlink = function(){
  console.log('simulateRightBlink()');
  blinkStatus.textContent = 'Simulação: pestanejo direito';
  if (window.moveRight) window.moveRight();
};

// end
