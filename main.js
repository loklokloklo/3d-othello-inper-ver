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
let gameStarted = false;
// グローバル領域に追加（scene, camera, などと同じ場所）
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
const stoneMap = new Map(); // キー = "x,y,z", 値 = stone Mesh
const moveHistory = []; // 各手の記録 ["2,3,1", "1,1,1", ...]
let firstPlayer = 'black';

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

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccf2ff'); // 薄い水色の背景

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
renderer.outputColorSpace = THREE.SRGBColorSpace; // ← ここだけ変更
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setClearColor('#ccf2ff'); // 背景を薄い水色に設定（リロード時含む）
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

  // ======== ライトの設定 ========

// 柔らかい全体照明（強すぎ注意）
const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
scene.add(ambientLight);

// 6方向からの平行光で全体を包む（どの向きでも白く見えるように）
const directions = [
  [10, 0, 0],    // +X
  [-10, 0, 0],   // -X
  [0, 10, 0],    // +Y
  [0, -10, 0],   // -Y
  [0, 0, 10],    // +Z
  [0, 0, -10]    // -Z
];

for (const [x, y, z] of directions) {
  const light = new THREE.DirectionalLight(0xffffff, 0.4); // 控えめな強さ
  light.position.set(x, y, z);
  scene.add(light);
}



for (let x = 0; x < size; x++) {
  board[x] = [];
  for (let y = 0; y < size; y++) {
    board[x][y] = [];
    for (let z = 0; z < size; z++) {
      board[x][y][z] = null; // 'black' or 'white' を後で格納する
    }
  }
}



  // ボード作成
boardGroup = new THREE.Group();
const geometry = new THREE.BoxGeometry(1, 1, 1);

// 透明なマテリアル（石を格納する空間）
const transparentMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0 // 完全に透明
});

// ワイヤーフレーム（薄い灰色の枠線）
const wireframeMaterial = new THREE.MeshBasicMaterial({
  color: 0xaaaaaa,
  wireframe: true
});


for (let x = 0; x < size; x++) {
  for (let y = 0; y < size; y++) {
    for (let z = 0; z < size; z++) {
      const cube = new THREE.Mesh(geometry, transparentMaterial);
      const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

      // 同じ位置に重ねて配置
      const boxGroup = new THREE.Group();
      boxGroup.add(cube);
      boxGroup.add(wireframe);

      // 位置調整（原点の正の方向に配置）
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

// X軸（赤）
const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(axisLength, 0, 0)
]);
const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
scene.add(xAxis);

// Y軸（緑）
const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, axisLength, 0)
]);
const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
scene.add(yAxis);

// Z軸（青）
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

updateStoneCountDisplay(); // ← 初期配置反映
  animate();
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

// 手番選択画面がクリックされたら非表示にする
const turnUI = document.getElementById('turn-selection');
const blackButton = document.getElementById('black-button');
const whiteButton = document.getElementById('white-button');

if (blackButton && whiteButton && turnUI) {
  blackButton.addEventListener('click', () => {
    firstPlayer = 'black';
    currentTurn = 'black';
    turnUI.style.display = 'none';
    gameStarted = true;
    showAllLegalMoves(); // 手番ごとに更新

  });

whiteButton.addEventListener('click', () => {
  firstPlayer = 'white';
    currentTurn = 'white';
    turnUI.style.display = 'none';
    gameStarted = true;
    showAllLegalMoves(); // 手番ごとに更新

  });
}

function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
    // 黒ならダークレッド寄り、白ならピンク寄り
    finalColor = (color === 0x000000) ? 0x8B0000 : 0xFFB6C1;
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
  stoneMap.set(key, stone); // 管理用マップに記録
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
  if (!gameStarted) return;

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
      const [lx, ly, lz] = lastPlacedStone;
      const prevColor = currentTurn === 'black' ? 0xffffff : 0x000000;
      revertPreviousRedStone(prevColor);
    }

    const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
    createStone(x, y, z, color, true); // ← 最後に置いた石だけ赤

    board[x][y][z] = currentTurn;
    placedStones.add(key);
    lastPlacedStone = [x, y, z]; // ここで更新

    moveHistory.push({
      player: currentTurn,
      move: [x, y, z]
    });
    
    flipStones(x, y, z, currentTurn); // ← 石をひっくり返す処理
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    updateStoneCountDisplay(); // ← 追加

    showAllLegalMoves();
    checkGameEnd(); // ← ここで勝敗チェック
    // ゲームがまだ続いている場合、次の手番に合法手がなければパス
if (!hasAnyLegalMove(currentTurn)) {
  showPassPopup(); // パスを表示してボタン押させる
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
  }
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


function flipStones(x, y, z) {
  const opponent = currentTurn === 'black' ? 'white' : 'black';
  let flipped = false; // ← ★これを追加

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
      board[nx][ny][nz] === currentTurn
    ) {
      // 相手の石をすべて自分の色に反転
      for (const [fx, fy, fz] of stonesToFlip) {
        board[fx][fy][fz] = currentTurn;
        // 表示上も色を変えるために一度削除＆再配置（簡易的）
        removeStoneAt(fx, fy, fz);
        const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
        createStone(fx, fy, fz, color);
        flipped = true; // ← ここで true に
      }
    }
  }

  if (flipped) {
    updateStoneCountDisplay(); // ← 裏返した場合のみ更新
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
    obj.position.distanceTo(targetPosition) < 0.01 // 少し誤差許容
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}

function placeStone(x, y, z) {
  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;

  createStone(x, y, z, color);
  board[x][y][z] = currentTurn;

  flipStones(x, y, z); // ← 追加

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
  // UIを作成
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
  text.textContent = `勝者: ${result.winner}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  // 棋譜送信ボタン
const sendBtn = document.createElement('button');
sendBtn.textContent = '棋譜を送信';
sendBtn.style.margin = '10px';

sendBtn.addEventListener('click', () => {
  const kifuRef = ref(database, "kifu"); // "kifu" ノードに保存
  const newRef = push(kifuRef); // ユニークキーを自動生成
  set(newRef, result) // result は棋譜オブジェクト
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

  // 全体をbodyに追加
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
    location.reload(); // または任意の初期化処理
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}



function checkGameEnd() {
  if (!gameStarted) return;

  const boardFull = placedStones.size >= size * size * size;
  const blackHasMove = hasAnyLegalMove('black');
  const whiteHasMove = hasAnyLegalMove('white');

  if (boardFull || (!blackHasMove && !whiteHasMove)) {
    const result = countStones();
    let winner = null;

    if (result.black > result.white) winner = 'black';
    else if (result.white > result.black) winner = 'white';
    else winner = 'draw';

    const formattedMoves = moveHistory.map((entry, i) => {
      if (entry.pass) {
        return {
          turn: i + 1,
          player: entry.player,
          pass: true
        };
      } else {
        const [x, y, z] = entry.move;
        return {
          turn: i + 1,
          player: entry.player,
          x: x + 1, // 1-indexed に変換
          y: y + 1,
          z: z + 1
        };
      }
    });

    // 最終的に送信する棋譜データ
    const gameData = {
      first: firstPlayer,       // 'black' または 'white'
      result: winner,           // 'black' / 'white' / 'draw'
      score: result,            // { black: 〜, white: 〜 }
      moves: formattedMoves     // 各手の履歴（1-indexed）
    };

    console.log('🎯 ゲーム終了:', gameData);
    showGameResultUI(gameData); // UIに表示 or サーバに送信
  }
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
  document.getElementById('pass-popup').style.display = 'block';
}

function hidePassPopup() {
  document.getElementById('pass-popup').style.display = 'none';
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();
  moveHistory.push({ player: currentTurn, pass: true });

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // 再度合法手がなければゲーム終了
  if (!hasAnyLegalMove(currentTurn)) {
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

