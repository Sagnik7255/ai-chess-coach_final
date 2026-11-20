console.log("JS loaded");
const mode = localStorage.getItem("gameMode") || "coach";
const game = new Chess();
const moveSound = new Audio("https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Move.ogg");
const captureSound = new Audio("https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Capture.ogg");
const checkSound = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg",);
var board = Chessboard("board", {
  draggable: false,
  position: "start",
  pieceTheme: "https://chessboardjs.com/img/chesspieces/alpha/{piece}.png",
});

// 🔥 TWO ENGINES (fixes infinite thinking)
const aiEngine = new Worker("stockfish.js");
const evalEngine = new Worker("stockfish.js");

// Initialize engines
aiEngine.postMessage("uci");
evalEngine.postMessage("uci");

// State
let evalStage = null;
let evalBefore = null;
let pendingMove = null;
let selectedSquare = null;
let currentTheme = 0;
let isAITurn = false;
let aiTimeout = null;
let isAIThinking = false;
let engineBestMove = null;
let lastUserMove = null;

// ⏱ TIMER STATE (NEW)
let whiteTime = 300;
let blackTime = 300;
let timerInterval = null;
const themes = [
  "theme-default",
  "theme-green",
  "theme-dark",
  "theme-blue",
  "theme-glass",
  "theme-sunset",
  "theme-ocean",
  "theme-gold",
];

function changeTheme() {
  const boardEl = document.getElementById("board");

  themes.forEach((t) => boardEl.classList.remove(t));

  currentTheme = (currentTheme + 1) % themes.length;

  boardEl.classList.add(themes[currentTheme]);

  document.getElementById("theme-name").innerText =
    "Theme: " + themes[currentTheme].replace("theme-", "");
}

// Create Sound Handler
function playSound(move) {
  try {
    if (move.captured) {
      captureSound.currentTime = 0;
      captureSound.play();
    } else {
      moveSound.currentTime = 0;
      moveSound.play();
    }

    if (game.in_check()) {
      checkSound.currentTime = 0;
      checkSound.play();
    }
  } catch (e) {
    console.log("Sound error:", e);
  }
}

// click function
$("#board").on("click", ".square-55d63", function () {
  if (isAITurn) return;

  const square = $(this).attr("data-square");

  if (square === selectedSquare) {
    removeHighlights();
    selectedSquare = null;
    engineBestMove = null; // ✅ RESET old best move
    return;
  }

  if (!selectedSquare || square === selectedSquare) {
    const piece = game.get(square);
    if (!piece || piece.color !== game.turn()) return;

    selectedSquare = square;

    getBestMoveSuggestion(); // ✅ ADD THIS LINE

    removeHighlights();

    const moves = game.moves({
      square: square,
      verbose: true,
    });
    highlightMoves(moves);
    $(this).addClass("highlight-selected");
  }

  else {
    const from = selectedSquare;
    const to = square;

    const beforeFen = game.fen();

    const piece = game.get(square);

    // If clicking another own piece → switch selection
    if (piece && piece.color === game.turn()) {
      selectedSquare = square;

      removeHighlights();

      const moves = game.moves({
        square: square,
        verbose: true,
      });

      highlightMoves(moves);
      $("#board .square-" + square).addClass("highlight-selected");
      return;
    }

    const move = game.move({
      from: from,
      to: to,
      promotion: "q",
    });

    if (move === null) return;

    const userMove = `${from} to ${to}`;
    lastUserMove = `${from} to ${to}`;

    removeHighlights();
    selectedSquare = null;

    playSound(move);
    board.position(game.fen());
    highlightCheck();

    clearLastMove(); // ✅ ADD THIS
    $("#board .square-" + from).addClass("highlight-last");
    $("#board .square-" + to).addClass("highlight-last");

    updateStatus();
    if (mode === "timed") startTimer();

    if (game.game_over()) return;

    isAITurn = true;


    pendingMove = {
      before: beforeFen,
      after: game.fen(),
    };

    evalStage = "before";
    evalEngine.postMessage("position fen " + beforeFen);
    evalEngine.postMessage("go depth 10");
  }
});
// AI MOVE SUGGESTION
function getBestMoveSuggestion() {
  if (evalStage !== null) return; // 🚫 prevent collision

  evalEngine.postMessage("position fen " + game.fen());
  evalEngine.postMessage("go depth 12");
}
// HIGHLIGHT KING CHECK
function highlightCheck() {
  // remove old check highlight
  $(".square-55d63").removeClass("highlight-check");

  if (game.in_check()) {
    // find king position
    const boardState = game.board();

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = boardState[row][col];

        if (piece && piece.type === "k" && piece.color === game.turn()) {
          const file = "abcdefgh"[col];
          const rank = 8 - row;
          const square = file + rank;

          $("#board .square-" + square).addClass("highlight-check");
        }
      }
    }
  }
}

// Move Highlighting
function removeHighlights() {
  $("#board .square-55d63").removeClass(
    "highlight-move highlight-selected highlight-capture",
  );
}

function clearLastMove() {
  $("#board .square-55d63").removeClass("highlight-last");
}

function highlightMoves(moves) {
  moves.forEach((move) => {
    const squareEl = $("#board .square-" + move.to);

    // If capture move
    if (move.captured) {
      squareEl.addClass("highlight-capture");
    }
    // Normal move
    else {
      squareEl.addClass("highlight-move");
    }
  });
}

// 🔥 Evaluation engine (coach only)
evalEngine.onmessage = function (event) {
  const line = event.data;

  // 🧠 HANDLE BEST MOVE FIRST(updated)
  if (line.startsWith("bestmove")) {
    const bestMove = line.split(" ")[1];
    // ✅ ONLY store best move during evaluation
    if (evalStage === "before") {
      engineBestMove = bestMove;
      return;
    }

    // 🔥 If user just clicked piece → show suggestion
    // ✅ ONLY show when user is selecting piece (not after move, not AI turn)
    if (evalStage === null && !isAITurn && selectedSquare !== null) {
      showBestMove(bestMove);
      return;
    }
    // 🔥 If evaluating move → continue normal flow
  }

  // 👇 THEN evaluation logic
  if (!line.includes("score cp")) return;

  const match = line.match(/score cp (-?\d+)/);
  if (!match) return;

  const evalScore = parseInt(match[1]);

  if (evalStage === "before") {
    evalBefore = evalScore;

    evalStage = "after";
    evalEngine.postMessage("position fen " + pendingMove.after);
    evalEngine.postMessage("go depth 10");
  }
  else if (evalStage === "after") {

    const evalAfter = evalScore;
    const diff = evalBefore - evalScore;

    showCoachMessage(diff);

    // 🔥 ADD THIS (LLM EXPLANATION)
    // 🔥 Explain USER move (LLM)
    (async () => {
      try {

        document.getElementById("coach-text").innerText = "🤖 AI analyzing your move...";

        const res = await fetch("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: `You are a chess coach.

Position (FEN): ${pendingMove.after}

User played: ${lastUserMove}

Best engine move: ${engineBestMove || "unknown"}

Evaluation before: ${evalBefore}
Evaluation after: ${evalAfter}
Change: ${diff}

Explain:
- Was the move good or bad?
- Why? 
- Keep it simple for beginners.`,
            fen: pendingMove.after
          })
        });

        const data = await res.json();

        document.getElementById("coach-text").innerText = data.reply;

      } catch (err) {
        console.log("LLM error:", err);
      }
    })();

    evalStage = null;
    evalBefore = null;
  }
};

// SHOW BEST MOVES
function showBestMove(move) {
  const from = move.substring(0, 2);
  const to = move.substring(2, 4);

  const explanation = explainMove(from, to);

  document.getElementById("coach-text").innerText =
    `💡 Best move: ${from} → ${to}\n${explanation}`;
}

// 🔥 AI engine (moves only)
function makeAIMove() {

  if (isAIThinking) return; // ❌ prevent spam
  if (game.turn() === 'w') return; // ❌ stop if it's user's turn

  if (game.game_over()) {
    isAITurn = false;
    return;
  }

  aiEngine.postMessage("position fen " + game.fen());
  aiEngine.postMessage("go depth 12");

  // 🔥 store timeout reference
  aiTimeout = setTimeout(() => {
    if (isAITurn) {
      console.warn("AI timeout fallback");

      const moves = game.moves();
      if (moves.length > 0) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        game.move(randomMove);
        board.position(game.fen());
      }

      isAITurn = false;
      updateStatus();
    }
  }, 4000);
}

aiEngine.onmessage = async function (event) {
  const line = event.data;

  if (!line.startsWith("bestmove")) return;

  if (aiTimeout) {
    clearTimeout(aiTimeout);
    aiTimeout = null;
  }

  isAITurn = false;

  // 🚫 Stop if game ended during thinking
  if (game.game_over()) return;

  const move = line.split(" ")[1];

  const from = move.substring(0, 2);
  const to = move.substring(2, 4);

  const moveObj = game.move({
    from: from,
    to: to,
    promotion: "q",
  });

  board.position(game.fen());
  highlightCheck();
  // ✅ VERY IMPORTANT (same highlight here)
  removeHighlights();

  clearLastMove(); // ✅ ADD THIS
  $("#board .square-" + from).addClass("highlight-last");
  $("#board .square-" + to).addClass("highlight-last");

  playSound(moveObj); // ✅ SOUND HERE
  updateStatus();
  isAIThinking = false; // ✅ AI finished thinking

  if (mode === "timed") startTimer();

  // 🔥 Explain AI move
  try {
    document.getElementById("coach-text").innerText = "🤖 AI is explaining its move...";

    const res = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `AI played ${from} to ${to}. Explain this move.`,
        fen: game.fen()
      })
    });

    const data = await res.json();

    document.getElementById("coach-text").innerText = data.reply;

  } catch (err) {
    console.log("LLM error:", err);
  }
};

// 🧠 Coach feedback
function showCoachMessage(diff) {
  let message = "";

  if (diff > 300) {
    message = "❌ Blunder! You lost a lot of advantage.";
  } else if (diff > 100) {
    message = "⚠️ Inaccuracy. There was a better move.";
  } else if (diff > 50) {
    message = "🤔 Slightly suboptimal move.";
  } else {
    message = "✅ Good move!";
  }

  document.getElementById("coach-text").innerText = message;
}

// EXPLANATION FUNCTION
function explainMove(from, to) {
  let reasons = [];

  const moveObj = game.move({
    from: from,
    to: to,
    promotion: "q",
  });

  if (!moveObj) return "";

  // 🎯 Capture
  if (moveObj.captured) {
    reasons.push("⚔️ Captures an opponent piece");
  }

  // 👑 Check
  if (game.in_check()) {
    reasons.push("👑 Puts the king in check");
  }

  // 🧠 Center control
  if (["d4", "d5", "e4", "e5"].includes(to)) {
    reasons.push("🎯 Controls the center");
  }

  // 🚀 Development (simple logic)
  if (moveObj.piece === "n" || moveObj.piece === "b") {
    reasons.push("🚀 Develops a piece");
  }

  // 🛡️ Pawn push
  if (moveObj.piece === "p" && (to[1] === "4" || to[1] === "5")) {
    reasons.push("🛡️ Gains space in the center");
  }

  // Undo move (VERY IMPORTANT)
  game.undo();

  if (reasons.length === 0) {
    return "♟️ Improves position";
  }

  return reasons.join(", ");
}
// 📊 Status updates
function updateStatus() {
  let status = "";

  if (game.in_checkmate()) {
    status =
      "Checkmate! " + (game.turn() === "w" ? "Black wins" : "White wins");
  } else if (game.in_draw()) {
    status = "Game drawn";
  } else {
    status = game.turn() === "w" ? "Your move" : "AI thinking...";
  }

  document.getElementById("status").innerText = status;
}

// QUERY ASSIST FUNCTION

async function askAI() {
  const input = document.getElementById("question");
  const message = input.value.trim();

  if (!message) return;

  try {
    const response = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: message,
        fen: game.fen(),
      }),
    });

    const data = await response.json();

    document.getElementById("coach-text").innerText = data.reply;
  } catch (err) {
    console.log(err);
    document.getElementById("coach-text").innerText = "⚠️ AI connection error";
  }

  input.value = "";
}

// SIGNUP FUNCTION
// function signup() {
//   fetch("http://localhost:3000/signup", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({
//       name: document.getElementById("signupName").value,
//       email: document.getElementById("signupEmail").value,
//       password: document.getElementById("signupPassword").value
//     })
//   })
//   .then(res => res.json())
//   .then(data => console.log(data))
//   .catch(err => console.error(err));
// }

// // LOGIN FUNCTION
// function login() {
//   fetch("http://localhost:3000/login", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({
//       email: document.getElementById("loginEmail").value,
//       password: document.getElementById("loginPassword").value
//     })
//   })
//   .then(res => res.json())
//   .then(data => console.log(data))
//   .catch(err => console.error(err));
// }
function formatTime(t) {
  const min = Math.floor(t / 60);
  const sec = t % 60;
  return `${min}:${sec < 10 ? "0" : ""}${sec}`;
}

function updateTimerUI() {
  const w = document.getElementById("white-timer");
  const b = document.getElementById("black-timer");

  if (!w || !b) return;

  w.innerText = formatTime(whiteTime);
  b.innerText = formatTime(blackTime);
}

function startTimer() {
  if (mode !== "timed") return; // ✅ already exists (good)

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    // 🚫 EXTRA SAFETY
    if (mode !== "timed") {
      clearInterval(timerInterval);
      return;
    }

    if (game.turn() === "w") {
      whiteTime--;
    } else {
      blackTime--;
    }

    updateTimerUI();

    if (whiteTime <= 0 || blackTime <= 0) {
      clearInterval(timerInterval);

      alert("⏰ Time Over!");

      game.reset();
      board.start();
    }
  }, 1000);
}

if (mode === "timed") {
  const coach = document.getElementById("coach-box");
  if (coach) coach.style.display = "none";

  const input = document.getElementById("question");
  const askBtn = document.querySelector('button[onclick="askAI()"]');

  if (input) input.style.display = "none";
  if (askBtn) askBtn.style.display = "none";
}

const timer = document.getElementById("timer-container");

if (mode === "coach") {
  if (timer) timer.style.display = "none";
}

if (mode === "coach") {
  const boardSection = document.getElementById("board-section");
  if (boardSection) boardSection.style.marginTop = "20px";
}

function setMode(m) {
  localStorage.setItem("gameMode", m);
  location.reload();
}
