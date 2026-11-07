// ============================================================
// 3Dオセロ（4×4×4）— 人間対人間版
//
// 使用技術: JavaScript / Three.js / Firebase Realtime Database
// 主な機能:
//   - 3D盤面の描画と、OrbitControls による視点操作
//   - 26方向（3次元）での合法手判定と石の反転
//   - 合法手マーカー表示、パス処理、終局判定
//   - 1手戻す機能（棋譜から盤面を再構築）
//   - 対局終了後の棋譜を Firebase に送信
// ============================================================

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;


// ============================================================
// 定数・グローバル状態
// ============================================================

// --- Three.js 関連 ---
let scene, camera, renderer, labelRenderer, controls;
let boardGroup;

// --- ゲーム状態 ---
let board = [];                 // board[x][y][z] = 'black' | 'white' | null
let currentTurn = 'black';      // 現在の手番
let firstPlayer = 'black';      // 先手
let gameStarted = 0;            // 2 のとき対局中
let isPassPopupVisible = false; // パス通知ポップアップの表示中フラグ

// --- 着手の記録 ---
const moveHistory = [];         // 各手の記録（{ player, move } または { player, pass }）
const placedStones = new Set(); // 着手済みマスのキー "x,y,z"
let lastPlacedStone = null;     // 直前に置いた石の座標 [x, y, z]（強調表示用）
let lastPlacedColor = null;     // 直前に置いた石の色

// --- 石の表示 ---
const stoneMap = new Map();     // キー "x,y,z" → 石の Mesh
const stoneRadius = 0.3;

// --- 盤面の寸法 ---
const size = 4;                 // 1辺のマス数
const spacing = 1.2;            // マス同士の間隔

// 26方向（3次元の隣接方向: dx, dy, dz がそれぞれ -1, 0, 1 の組み合わせから (0,0,0) を除く）
const directions = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

// --- Firebase（棋譜の保存先） ---
const firebaseConfig = {
  apiKey: "AIzaSyDpXdLFl05RGNS7sh0FEbFAtcM8aWgMVvg",
  authDomain: "d-othello.firebaseapp.com",
  projectId: "d-othello",
  storageBucket: "d-othello.firebasestorage.app",
  messagingSenderId: "895908988417",
  appId: "1:895908988417:web:6726542c927ad8d9c36200",
  databaseURL: "https://d-othello-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);


// ============================================================
// 初期化
// ============================================================

function init() {
  // シーン・カメラ・レンダラー
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0');

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor('#ccf2ff');
  document.body.appendChild(renderer.domElement);

  // HTMLラベル用のレンダラー（OrbitControls の操作対象も兼ねる）
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.target.set(3, 3, 3);

  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 5));

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  scene.add(new THREE.AxesHelper(10));

  // 盤面データを空で初期化
  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  createBoardGrid();
  placeInitialStones();
  createAxes();

  updateStoneCountDisplay();
  animate();

  setupUndoButtons();
}

/** 4×4×4 のマス目（透明な立方体＋ワイヤーフレーム）を作成する */
function createBoardGrid() {
  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  // 透明な立方体はクリック判定（レイキャスト）用
  const transparentMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaaaaa,
    wireframe: true
  });

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const boxGroup = new THREE.Group();
        boxGroup.add(new THREE.Mesh(geometry, transparentMaterial));
        boxGroup.add(new THREE.Mesh(geometry, wireframeMaterial));

        boxGroup.position.set(
          (x + 1.0) * spacing,
          (y + 1.0) * spacing,
          (z + 1.0) * spacing
        );

        boardGroup.add(boxGroup);
      }
    }
  }

  scene.add(boardGroup);
}

/** 初期配置（中央の2×2×2に黒4個・白4個）を置く */
function placeInitialStones() {
  const BLACK = 0x000000;
  const WHITE = 0xffffff;

  const blackStones = [[1, 1, 1], [2, 2, 1], [2, 1, 2], [1, 2, 2]];
  const whiteStones = [[1, 2, 1], [2, 2, 2], [1, 1, 2], [2, 1, 1]];

  for (const [x, y, z] of blackStones) {
    createStone(x, y, z, BLACK);
    board[x][y][z] = 'black';
  }
  for (const [x, y, z] of whiteStones) {
    createStone(x, y, z, WHITE);
    board[x][y][z] = 'white';
  }
}

/** X軸（赤）・Y軸（緑）・Z軸（青）の線とラベルを描画する */
function createAxes() {
  const axisLength = 5;

  const axisDefs = [
    { color: 0xff0000, end: new THREE.Vector3(axisLength, 0, 0) }, // X
    { color: 0x00ff00, end: new THREE.Vector3(0, axisLength, 0) }, // Y
    { color: 0x0000ff, end: new THREE.Vector3(0, 0, axisLength) }  // Z
  ];

  for (const { color, end } of axisDefs) {
    const material = new THREE.LineBasicMaterial({ color });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      end
    ]);
    scene.add(new THREE.Line(geometry, material));
  }

  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);
}

/** 軸名（X / Y / Z）を表示するスプライトを (x, y, z) に配置する */
function createAxisLabel(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // 背景は透明、黒い文字のみ描画する
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(1.2, 1.2, 1.2);
  scene.add(sprite);
}

/** 描画ループ */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/** 「1手戻す」ボタン（通常時・パスポップアップ内）のイベントを登録する */
function setupUndoButtons() {
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      undoLastMove();
    });
  }

  const passUndoButton = document.getElementById('pass-undo-button');
  if (passUndoButton) {
    passUndoButton.addEventListener('click', () => {
      hidePassPopup();
      undoCore();
    });
  }
}


// ============================================================
// 対局開始（手番選択画面）
// ============================================================

const turnUI = document.getElementById('turn-selection');
const blackButton = document.getElementById('black-button');

if (blackButton && turnUI) {
  blackButton.addEventListener('click', () => {
    firstPlayer = 'black';
    currentTurn = 'black';
    turnUI.style.display = 'none';
    gameStarted = 2;
    showAllLegalMoves();
  });
}


// ============================================================
// 石の描画
// ============================================================

/**
 * 石（球）を作成してシーンに追加する。
 * @param {boolean} isLastPlaced 直前の着手なら、目印として赤みのある色で描画する
 */
function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
    finalColor = (color === 0x000000) ? 0x4B0000 : 0xAA6666;
  }

  const geometry = new THREE.SphereGeometry(stoneRadius, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: finalColor });
  const stone = new THREE.Mesh(geometry, material);
  stone.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );
  scene.add(stone);

  stoneMap.set(`${x},${y},${z}`, stone);
}

/** 直前に置いた石の強調表示を、通常の色に戻す */
function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const mesh = stoneMap.get(`${x},${y},${z}`);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

/** 指定マスにある石のメッシュをシーンから削除する */
function removeStoneAt(x, y, z) {
  const targetPosition = new THREE.Vector3(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  const toRemove = scene.children.find(obj =>
    obj instanceof THREE.Mesh &&
    obj.geometry.type === "SphereGeometry" &&
    obj.position.distanceTo(targetPosition) < 0.01
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}


// ============================================================
// 着手の処理（クリック入力）
// ============================================================

window.addEventListener('pointerdown', (event) => {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return; // パス通知の表示中は盤面を操作させない

  // クリック位置から、盤面のどのマスかをレイキャストで求める
  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length === 0) return;

  const point = intersects[0].object.parent.position;
  const x = Math.round(point.x / spacing) - 1;
  const y = Math.round(point.y / spacing) - 1;
  const z = Math.round(point.z / spacing) - 1;

  const key = `${x},${y},${z}`;
  if (placedStones.has(key)) return;
  if (!isLegalMove(board, x, y, z, currentTurn)) return;

  // 直前の着手の強調表示を元の色に戻してから、新しい石を置く
  if (lastPlacedStone) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
  createStone(x, y, z, color, true);

  board[x][y][z] = currentTurn;
  placedStones.add(key);
  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;
  moveHistory.push({ player: currentTurn, move: [x, y, z] });

  // 反転処理は、手番を切り替える前に行う（反転する色を誤らないため）
  flipStones(x, y, z, currentTurn);
  updateStoneCountDisplay();

  // 手番を交代し、次の合法手を表示する
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // 次の手番に合法手がなければ、パスまたは終局
  if (gameStarted === 2 && !hasAnyLegalMove(currentTurn)) {
    const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
    if (!hasAnyLegalMove(otherPlayer)) {
      checkGameEnd();
    } else {
      showPassPopup();
    }
  }
});


// ============================================================
// 合法手の判定と表示
// ============================================================

/**
 * (x, y, z) が currentTurn にとって合法手かを判定する。
 * 26方向のいずれかで「相手の石が1個以上連続し、その先に自分の石がある」なら合法。
 */
function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

    // 相手の石が続く限り進む
    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      nx += dx;
      ny += dy;
      nz += dz;
      count++;
    }

    // 相手の石を1個以上挟んで、自分の石に到達していれば合法
    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      return true;
    }
  }

  return false;
}

/** player に合法手が1つでもあるかを返す */
function hasAnyLegalMove(player) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, player)) return true;
      }
    }
  }
  return false;
}

/** 現在の手番の合法手を、すべて黄色い球で表示する */
function showAllLegalMoves() {
  clearLegalMoveMarkers();

  const legalMovesList = [];

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, currentTurn)) {
          showLegalMoveIndicator(x, y, z);
          legalMovesList.push([x, y, z]);
        }
      }
    }
  }

  // 開発者ツール用の分析ログ（コンソール出力）
  logLegalMovesInfo(legalMovesList, currentTurn);
}

/** 合法手マーカーをすべて削除する */
function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}

/** 合法手マーカー（黄色い小さな球）を1つ表示する */
function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;
  sphere.name = 'legalMoveIndicator';
  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  scene.add(sphere);
}

/**
 * 【開発者ツール】各合法手について、その手で返る相手の石に隣接する空きマスの総数を
 * コンソールに出力する（局面の分析・AI開発用）。
 *
 * - 隣接は26近傍で数え、盤外は除外する
 * - 「いま置こうとしているマス」は空きマスに含めない
 * - 複数の石から参照される空きマスは1回だけ数える
 *
 * 出力形式: "(x,y,z):N" を合法手の数だけ並べる（座標は1始まり）
 */
function logLegalMovesInfo(legalMoves, player) {
  if (legalMoves.length === 0) return;

  const opponent = player === 'black' ? 'white' : 'black';
  const results = [];

  for (const [mx, my, mz] of legalMoves) {
    // この手で返る相手の石を集める
    const flippedStones = [];

    for (const [dx, dy, dz] of directions) {
      const line = [];
      let nx = mx + dx;
      let ny = my + dy;
      let nz = mz + dz;

      while (
        nx >= 0 && nx < size &&
        ny >= 0 && ny < size &&
        nz >= 0 && nz < size &&
        board[nx][ny][nz] === opponent
      ) {
        line.push([nx, ny, nz]);
        nx += dx;
        ny += dy;
        nz += dz;
      }

      // 方向の末端が自分の石なら、この方向の石は返る
      if (
        line.length > 0 &&
        nx >= 0 && nx < size &&
        ny >= 0 && ny < size &&
        nz >= 0 && nz < size &&
        board[nx][ny][nz] === player
      ) {
        for (const s of line) flippedStones.push(s);
      }
    }

    // 返る石に隣接する空きマスを、重複なしで数える
    const emptySet = new Set();
    for (const [fx, fy, fz] of flippedStones) {
      for (const [dx, dy, dz] of directions) {
        const ax = fx + dx;
        const ay = fy + dy;
        const az = fz + dz;
        if (
          ax >= 0 && ax < size &&
          ay >= 0 && ay < size &&
          az >= 0 && az < size &&
          board[ax][ay][az] === null &&
          !(ax === mx && ay === my && az === mz)
        ) {
          emptySet.add(`${ax},${ay},${az}`);
        }
      }
    }

    results.push(`(${mx + 1},${my + 1},${mz + 1}):${emptySet.size}`);
  }

  console.log('[合法手 空きマス数] ' + results.join('  '));
}


// ============================================================
// 石の反転
// ============================================================

/**
 * (x, y, z) に turnColor の石を置いたときの反転を、盤面データと3D表示の両方に反映する。
 * @param {string} turnColor 着手した側の色。手番の切り替え前に呼ぶこと
 */
function flipStones(x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  let flipped = false;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];

    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    // 相手の石を挟んで自分の石に到達していれば、挟んだ石をすべて反転する
    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        board[fx][fy][fz] = turnColor;
        removeStoneAt(fx, fy, fz);
        const color = turnColor === 'black' ? 0x000000 : 0xffffff;
        createStone(fx, fy, fz, color);
        flipped = true;
      }
    }
  }

  if (flipped) {
    updateStoneCountDisplay();
  }
}

// ============================================================
// 石数の集計・表示
// ============================================================

/** 盤上の黒石・白石の数を数える */
function countStones() {
  let black = 0;
  let white = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (board[x][y][z] === 'black') black++;
        if (board[x][y][z] === 'white') white++;
      }
    }
  }
  return { black, white };
}

/** 画面上の石数表示を更新する */
function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}


// ============================================================
// パス処理
// ============================================================

/**
 * パス通知のポップアップを表示する。
 * #pass-popup は CSS で `display: none !important` と指定されているため、
 * style.display ではなく、クラス 'visible' の付け外しで表示を切り替える。
 */
function showPassPopup() {
  if (gameStarted !== 2) return;
  isPassPopupVisible = true;

  document.getElementById('pass-popup').classList.add('visible');

  // ポップアップ表示中は、通常の「1手戻す」ボタンを無効化する
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

/** パス通知のポップアップを閉じる */
function hidePassPopup() {
  document.getElementById('pass-popup').classList.remove('visible');
  isPassPopupVisible = false;

  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

// パスを確定する（OKボタン）
document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  // パスを棋譜に記録し、手番を交代する
  moveHistory.push({ player: currentTurn, pass: true });
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // 両者とも合法手がなければ終局
  const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
  if (!hasAnyLegalMove(currentTurn) && !hasAnyLegalMove(otherPlayer)) {
    checkGameEnd();
  }
});


// ============================================================
// 終局処理・棋譜の送信
// ============================================================

/** 終局時に勝敗を判定し、結果表示UIを出す */
function checkGameEnd() {
  if (gameStarted !== 2) return;

  const result = countStones();
  const winner = result.black > result.white ? 'black' :
    result.white > result.black ? 'white' : 'draw';

  // 棋譜を保存用の形式に変換する（座標は1始まり）
  const formattedMoves = moveHistory.map((entry, i) => {
    if (entry.pass) {
      return { turn: i + 1, player: entry.player, pass: true };
    }
    const [x, y, z] = entry.move;
    return { turn: i + 1, player: entry.player, x: x + 1, y: y + 1, z: z + 1 };
  });

  const gameData = {
    first: firstPlayer,
    result: winner,
    score: result,
    moves: formattedMoves
  };

  showGameResultUI(gameData);
}

/** 勝敗の表示と、棋譜送信ボタンを含むUIを表示する */
function showGameResultUI(result) {
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  applyPopupStyle(container);

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '棋譜を送信';
  sendBtn.style.margin = '10px';

  // 棋譜を Firebase の "kifu" 配下に新規キーで保存する
  sendBtn.addEventListener('click', () => {
    const kifuRef = ref(database, "kifu");
    const newRef = push(kifuRef);
    set(newRef, result)
      .then(() => {
        alert('棋譜を送信しました！');
        container.remove();
        showNewGameButton();
      })
      .catch((error) => {
        console.error("送信エラー:", error);
        alert("棋譜の送信に失敗しました。");
      });
  });

  container.appendChild(sendBtn);
  document.body.appendChild(container);
}

/** 「新しいゲーム」ボタンを表示する（押すとページを再読み込み） */
function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  applyPopupStyle(newGameContainer);

  const restartBtn = document.createElement('button');
  restartBtn.textContent = '新しいゲーム';
  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}

/** 画面中央上部に出す白いポップアップ用のスタイルを適用する */
function applyPopupStyle(element) {
  element.style.position = 'absolute';
  element.style.top = '30%';
  element.style.left = '50%';
  element.style.transform = 'translate(-50%, -50%)';
  element.style.backgroundColor = 'white';
  element.style.padding = '20px';
  element.style.borderRadius = '10px';
  element.style.textAlign = 'center';
  element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  element.style.zIndex = '100';
}


// ============================================================
// 1手戻し機能
//
// 方針: 棋譜（moveHistory）の末尾を1手削除し、初期配置から棋譜を再生して
//       盤面を作り直す。反転の履歴を別に持たずに済み、状態のずれが起きにくい。
// ============================================================

/** 初期配置（黒4個・白4個）だけを置いた盤面データを返す */
function buildInitialBoard() {
  const b = [];
  for (let x = 0; x < size; x++) {
    b[x] = [];
    for (let y = 0; y < size; y++) {
      b[x][y] = new Array(size).fill(null);
    }
  }
  b[1][1][1] = 'black';
  b[2][2][1] = 'black';
  b[2][1][2] = 'black';
  b[1][2][2] = 'black';
  b[1][2][1] = 'white';
  b[2][2][2] = 'white';
  b[1][1][2] = 'white';
  b[2][1][1] = 'white';
  return b;
}

/** 盤面データ b に対して、player が (x, y, z) に置いたときの着手と反転を適用する（3D表示は更新しない） */
function simulateMoveOnBoard(b, x, y, z, player) {
  b[x][y][z] = player;
  const opponent = player === 'black' ? 'white' : 'black';

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < size &&
      ny >= 0 && ny < size &&
      nz >= 0 && nz < size &&
      b[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < size &&
      ny >= 0 && ny < size &&
      nz >= 0 && nz < size &&
      b[nx][ny][nz] === player
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        b[fx][fy][fz] = player;
      }
    }
  }
}

/** すべての石のメッシュをシーンから削除し、stoneMap を空にする */
function removeAllStones() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === "SphereGeometry") {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
  stoneMap.clear();
}

/** board の内容に合わせて、すべての石を描き直す */
function redrawAllStones() {
  removeAllStones();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cell = board[x][y][z];
        if (cell !== null) {
          const color = cell === 'black' ? 0x000000 : 0xffffff;
          const isLast = lastPlacedStone &&
            lastPlacedStone[0] === x &&
            lastPlacedStone[1] === y &&
            lastPlacedStone[2] === z;
          createStone(x, y, z, color, isLast);
        }
      }
    }
  }
}

/** 「1手戻す」ボタンから呼ばれる入口。対局中かつパス通知が出ていないときだけ実行する */
function undoLastMove() {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return;
  undoCore();
}

/** 1手戻しの本体処理 */
function undoCore() {
  if (moveHistory.length === 0) {
    return;
  }

  // 棋譜の末尾を1手削除する
  moveHistory.pop();

  // 初期配置から棋譜を再生して、盤面を再構築する
  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMoveOnBoard(rebuiltBoard, mx, my, mz, entry.player);
  }

  // グローバルの board を再構築結果で上書きする
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  // 着手済みマスの集合を棋譜から作り直す
  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  // 「直前の着手」の情報を、残った棋譜の最後の着手に更新する
  const lastMoveEntry = [...moveHistory].reverse().find(e => !e.pass);
  if (lastMoveEntry) {
    lastPlacedStone = lastMoveEntry.move;
    lastPlacedColor = lastMoveEntry.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  // 手番を戻す（棋譜が空なら先手、そうでなければ最後に打った側の相手）
  if (moveHistory.length === 0) {
    currentTurn = firstPlayer;
  } else {
    const lastEntry = moveHistory[moveHistory.length - 1];
    currentTurn = lastEntry.player === 'black' ? 'white' : 'black';
  }

  // 3D表示・石数・合法手マーカーを更新する
  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();
}
