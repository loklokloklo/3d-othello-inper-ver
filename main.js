// main.js
import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;


let scene, camera, renderer, labelRenderer, controls;
let boardGroup;
let currentTurn = 'black'; // 現在の手番（'black' または 'white'）
// グローバル変数に追加
let gameStarted = 0;
// グローバル領域に追加（scene, camera, などと同じ場所）
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
const stoneMap = new Map(); // キー = "x,y,z", 値 = stone Mesh
const moveHistory = []; // 各手の記録
let firstPlayer = 'black';
let lastPlacedColor = null;

// ========================================
// パスポップアップ表示状態フラグ
// ========================================
let isPassPopupVisible = false;

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

const spacing = 1.2;
const size = 4;

// ========================================
// BUG FIX: placedStones をグローバルスコープで宣言
// （showAllLegalMoves の外に置くことで毎回リセットされる問題を修正）
// ========================================
const placedStones = new Set();

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

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0'); // 薄い緑色の背景

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

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(3, 3, 3);

  // ライト
  const ambientLight = new THREE.AmbientLight(0xffffff, 5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const axesHelper = new THREE.AxesHelper(10);
  scene.add(axesHelper);

  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  // ボード作成
  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

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
        const cube = new THREE.Mesh(geometry, transparentMaterial);
        const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

        const boxGroup = new THREE.Group();
        boxGroup.add(cube);
        boxGroup.add(wireframe);

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

  // 初期配置（黒＝0x000000、白＝0xffffff）
  createStone(1, 1, 1, 0x000000);
  board[1][1][1] = 'black';
  createStone(2, 2, 1, 0x000000);
  board[2][2][1] = 'black';
  createStone(2, 1, 2, 0x000000);
  board[2][1][2] = 'black';
  createStone(1, 2, 2, 0x000000);
  board[1][2][2] = 'black';

  createStone(1, 2, 1, 0xffffff);
  board[1][2][1] = 'white';
  createStone(2, 2, 2, 0xffffff);
  board[2][2][2] = 'white';
  createStone(1, 1, 2, 0xffffff);
  board[1][1][2] = 'white';
  createStone(2, 1, 1, 0xffffff);
  board[2][1][1] = 'white';

  // 軸の長さ
  const axisLength = 5;

  const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(axisLength, 0, 0)
  ]);
  const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
  scene.add(xAxis);

  const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
  const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, axisLength, 0)
  ]);
  const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
  scene.add(yAxis);

  const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
  const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, axisLength)
  ]);
  const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
  scene.add(zAxis);

  // 軸ラベル追加
  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

  updateStoneCountDisplay();
  animate();

  // ========================================
  // 1手戻すボタンのイベント登録
  // ========================================
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      undoLastMove();
    });
  }

  // パスポップアップ内の「1手戻す」ボタン
  const passUndoButton = document.getElementById('pass-undo-button');
  if (passUndoButton) {
    passUndoButton.addEventListener('click', () => {
      hidePassPopup();
      undoCore();
    });
  }
}

function createAxisLabel(text, x, y, z) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(x, y, z);
  scene.add(label);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// 手番選択画面
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

  const key = `${x},${y},${z}`;
  stoneMap.set(key, stone);
}

function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const key = `${x},${y},${z}`;
  const mesh = stoneMap.get(key);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

window.addEventListener('pointerdown', (event) => {
  if (gameStarted !== 2) return;
  // ========================================
  // BUG FIX: パスポップアップ表示中はクリックを無効化
  // ========================================
  if (isPassPopupVisible) return;

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    const point = intersect.object.parent.position;

    const x = Math.round(point.x / spacing) - 1;
    const y = Math.round(point.y / spacing) - 1;
    const z = Math.round(point.z / spacing) - 1;

    const key = `${x},${y},${z}`;
    if (placedStones.has(key)) return;
    if (!isLegalMove(board, x, y, z, currentTurn)) return;

    // 石を置く前に、前の赤い石を元の色に戻す
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

    // ========================================
    // BUG FIX: flipStones に turnColor を渡す（手番切替前に呼ぶ）
    // ========================================
    flipStones(x, y, z, currentTurn);
    updateStoneCountDisplay();

    // 手番切り替え
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    showAllLegalMoves();

    // 次の手番に合法手がなければパス
    if (gameStarted === 2) {
      if (!hasAnyLegalMove(currentTurn)) {
        const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
        if (!hasAnyLegalMove(otherPlayer)) {
          checkGameEnd();
        } else {
          showPassPopup();
        }
      }
    }
  }
});


function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}


function showAllLegalMoves() {
  clearLegalMoveMarkers();

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        const legal = isLegalMove(board, x, y, z, currentTurn);
        if (legal) {
          showLegalMoveIndicator(x, y, z);
        }
      }
    }
  }
  // ========================================
  // BUG FIX: ここに閉じ括弧を追加（元コードでは } が不足しており
  // placedStones の宣言が関数内部に入り込んでいた）
  // ========================================
}

function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';
  let legal = false;

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

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

    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      legal = true;
      break;
    }
  }

  return legal;
}

function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;

  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  sphere.name = 'legalMoveIndicator';
  scene.add(sphere);
}

// ========================================
// BUG FIX: flipStones に turnColor 引数を追加
// 元コードでは引数なしでグローバルの currentTurn を参照していたため
// 手番切替後に呼ばれると反転する色が逆になっていた
// ========================================
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

function placeStone(x, y, z) {
  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;

  createStone(x, y, z, color);
  board[x][y][z] = currentTurn;

  flipStones(x, y, z, currentTurn);

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();
}

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

function showGameResultUI(result) {
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  container.style.position = 'absolute';
  container.style.top = '30%';
  container.style.left = '50%';
  container.style.transform = 'translate(-50%, -50%)';
  container.style.backgroundColor = 'white';
  container.style.padding = '20px';
  container.style.borderRadius = '10px';
  container.style.textAlign = 'center';
  container.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  container.style.zIndex = '100';

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '棋譜を送信';
  sendBtn.style.margin = '10px';

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

function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  newGameContainer.style.position = 'absolute';
  newGameContainer.style.top = '30%';
  newGameContainer.style.left = '50%';
  newGameContainer.style.transform = 'translate(-50%, -50%)';
  newGameContainer.style.backgroundColor = 'white';
  newGameContainer.style.padding = '20px';
  newGameContainer.style.borderRadius = '10px';
  newGameContainer.style.textAlign = 'center';
  newGameContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  newGameContainer.style.zIndex = '100';

  const restartBtn = document.createElement('button');
  restartBtn.textContent = '新しいゲーム';
  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}


function checkGameEnd() {
  if (gameStarted !== 2) return;

  const result = countStones();
  let winner = result.black > result.white ? 'black' :
    result.white > result.black ? 'white' : 'draw';

  const formattedMoves = moveHistory.map((entry, i) => {
    if (entry.pass) {
      return { turn: i + 1, player: entry.player, pass: true };
    } else {
      const [x, y, z] = entry.move;
      return { turn: i + 1, player: entry.player, x: x + 1, y: y + 1, z: z + 1 };
    }
  });

  const gameData = {
    first: firstPlayer,
    result: winner,
    score: result,
    moves: formattedMoves
  };

  console.log('🎯 ゲーム終了:', gameData);
  showGameResultUI(gameData);
}

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

function showPassPopup() {
  if (gameStarted !== 2) return;
  isPassPopupVisible = true;

  // ========================================
  // BUG FIX: HTMLの #pass-popup は CSS で
  //   display: none !important
  //   #pass-popup.visible { display: flex !important }
  // と定義されているため、style.display='block' では
  // !important に負けて表示されない。
  // classList.add('visible') で正しく表示する。
  // ========================================
  document.getElementById('pass-popup').classList.add('visible');

  // 1手戻すボタンを無効化
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

function hidePassPopup() {
  // ========================================
  // BUG FIX: 同上。classList.remove('visible') で非表示にする。
  // ========================================
  document.getElementById('pass-popup').classList.remove('visible');
  isPassPopupVisible = false;

  // 1手戻すボタンを再有効化
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  // パスを履歴に追加
  moveHistory.push({ player: currentTurn, pass: true });

  // 手番を切り替え
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // 両者とも合法手がない場合はゲーム終了
  if (!hasAnyLegalMove(currentTurn) && !hasAnyLegalMove(currentTurn === 'black' ? 'white' : 'black')) {
    checkGameEnd();
  }
});


function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}


// ========================================
// 1手戻し機能（人間対人間用）
// ========================================

/**
 * 初期配置を反映した盤面を返す（8石を配置済み）
 */
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

/**
 * 盤面 b に対して player が (x,y,z) に置いたときの反転を適用する
 */
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

/**
 * 全ての石のメッシュをシーンから削除し、stoneMapをクリアする
 */
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

/**
 * board 配列の内容に従って全ての石を再描画する
 */
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

/**
 * 外部ボタン（#undo-button）から呼ばれるエントリーポイント
 */
function undoLastMove() {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return;
  undoCore();
}

/**
 * 1手戻しのコア処理
 */
function undoCore() {
  if (moveHistory.length === 0) {
    console.log('⚠️ 戻せる手がありません');
    return;
  }

  // 末尾の1手を取り除く
  moveHistory.pop();

  // 盤面を初期状態 + 棋譜再生で再構築
  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMoveOnBoard(rebuiltBoard, mx, my, mz, entry.player);
  }

  // グローバル board を上書き
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  // placedStones を棋譜から再構築
  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  // lastPlacedStone / lastPlacedColor を更新
  const lastMoveEntry = [...moveHistory].reverse().find(e => !e.pass);
  if (lastMoveEntry) {
    lastPlacedStone = lastMoveEntry.move;
    lastPlacedColor = lastMoveEntry.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  // currentTurn を1手前のプレイヤーに戻す
  if (moveHistory.length === 0) {
    currentTurn = firstPlayer;
  } else {
    const lastEntry = moveHistory[moveHistory.length - 1];
    currentTurn = lastEntry.player === 'black' ? 'white' : 'black';
  }

  // 3D表示を更新
  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();

  console.log(`✅ 1手戻しました。棋譜残り: ${moveHistory.length}手 / 次の手番: ${currentTurn}`);
}
