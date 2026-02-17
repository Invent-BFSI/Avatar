// ======= CONFIG =======
const BACKEND_BASE = "https://wonderful-bush-09095bf0f.4.azurestaticapps.net";
// ======= UI ELEMENTS =======
const messagesEl = document.getElementById("messages");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const startAvatarBtn = document.getElementById("startAvatarBtn");
const stopAvatarBtn = document.getElementById("stopAvatarBtn");
const avatarVideo = document.getElementById("avatarVideo");
const sessionIdLabel = document.getElementById("sessionId");

let sessionId = loadOrCreateSessionId();
sessionIdLabel.textContent = `Session: ${sessionId.slice(0, 8)}…`;

let mediaRecorder = null;
let pc = null; // RTCPeerConnection for avatar
let micStream = null;

// ======= SESSION PERSISTENCE =======
function loadOrCreateSessionId() {
  const key = "session_id";
  let s = localStorage.getItem(key);
  if (!s) {
    s = "S_" + crypto.randomUUID();
    localStorage.setItem(key, s);
  }
  return s;
}

// ======= CHAT RENDERING =======
function addMessage(role, text) {
  const li = document.createElement("li");
  li.className = `message ${role}`;
  li.innerHTML = `
  <div>${escapeHtml(text)}</div>
  <span class="meta">${role === "user" ? "You" : "Assistant"} • ${new Date().toLocaleTimeString()}</span>
`;

  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/[&<>\"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}


// ======= TEXT SEND FLOW =======
document.getElementById("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;

  addMessage("user", text);
  textInput.value = "";

  try {
    const res = await fetch(`${BACKEND_BASE}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, text })
    });
    const data = await res.json();
    addMessage("bot", data.response || "(no response)");
  } catch (err) {
    console.error(err);
    addMessage("bot", "Sorry, something went wrong sending your message.");
  }
});

// ======= MIC / AUDIO CHUNKS FLOW =======
micBtn.addEventListener("mousedown", startRecording);
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });

["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((evt) => {
  micBtn.addEventListener(evt, stopRecording);
});

async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        await sendAudioChunk(e.data);
      }
    };
    mediaRecorder.start(300); // chunk every 300ms
    micBtn.textContent = "⏺️";
    micBtn.classList.add("recording");
  } catch (err) {
    console.error(err);
    addMessage("bot", "Could not access your microphone.");
  }
}

async function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
  }
  micBtn.textContent = "🎤";
  micBtn.classList.remove("recording");
}

async function sendAudioChunk(blob) {
  // The backend should buffer/stream these chunks to Azure Speech and return partial or final text.
  try {
    const form = new FormData();
    form.append("audio", blob, "chunk.webm");
    form.append("session_id", sessionId);

    const res = await fetch(`${BACKEND_BASE}/api/audio`, {
      method: "POST",
      body: form
    });
    const data = await res.json();

    // Expected backend payload:
    // { "text": "...", "final": true|false, "response": "assistant text if available" }
    if (data.text && data.final) {
      addMessage("user", data.text);
    }
    if (data.response) {
      addMessage("bot", data.response);
    }
  } catch (err) {
    console.error(err);
  }
}

// ======= AVATAR (WEBRTC) =======
// This assumes your backend exposes a signaling route `/webrtc/offer`
// that receives a WebRTC offer (SDP) and returns an answer.

startAvatarBtn.addEventListener("click", async () => {
  await connectAvatar();
});
stopAvatarBtn.addEventListener("click", async () => {
  await disconnectAvatar();
});

async function connectAvatar() {
  if (pc) return;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
  });

  pc.addEventListener("track", (event) => {
    // First remote track should be the TTS (audio or audio+video) from the avatar service
    avatarVideo.srcObject = event.streams[0];
  });

  // If your backend expects an upstream mic track for “conversational” avatar,
  // you can add it here. Otherwise omit.
  // try {
  //   const upstream = await navigator.mediaDevices.getUserMedia({ audio: true });
  //   upstream.getTracks().forEach((t) => pc.addTrack(t, upstream));
  // } catch (e) {
  //   console.warn("Mic for Avatar not granted:", e);
  // }

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });
  await pc.setLocalDescription(offer);

  const answer = await fetch(`${BACKEND_BASE}/webrtc/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sdp: offer.sdp,
      type: offer.type,
      session_id: sessionId
    })
  }).then((r) => r.json());

  await pc.setRemoteDescription(answer);

  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    // Optional: If you implement trickle ICE, send candidates to backend
    // await fetch(`${BACKEND_BASE}/webrtc/ice`, { ... })
  };
}

async function disconnectAvatar() {
  if (pc) {
    pc.getSenders().forEach((s) => s.track && s.track.stop());
    pc.getReceivers().forEach((r) => r.track && r.track.stop());
    pc.close();
    pc = null;
    avatarVideo.srcObject = null;
  }

}
