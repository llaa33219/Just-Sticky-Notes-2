// 전역 변수
let currentUser = null;
let currentTool = 'move';
let zoomLevel = 1;
let panX = -4000; // 시작 위치를 중앙으로
let panY = -4000;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let stickyNotes = [];
let ws = null;
let selectedColor = '#FFEB3B';
let drawingTool = 'pen';
let isDrawing = false;

// DOM 요소들
const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginNote = document.getElementById('loginNote');
const canvas = document.getElementById('canvas');
const canvasContainer = document.getElementById('canvas-container');
const moveToolBtn = document.getElementById('move-tool');
const noteToolBtn = document.getElementById('note-tool');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelSpan = document.getElementById('zoom-level');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');

// 노트 에디터 요소들
const noteEditor = document.getElementById('note-editor');
const closeEditorBtn = document.getElementById('close-editor');
const colorBtns = document.querySelectorAll('.color-btn');
const noteText = document.getElementById('note-text');
const drawingCanvas = document.getElementById('drawing-canvas');
const drawingCtx = drawingCanvas.getContext('2d');
const saveNoteBtn = document.getElementById('save-note');
const cancelNoteBtn = document.getElementById('cancel-note');
const drawingBtns = document.querySelectorAll('.drawing-btn');

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    setupEventListeners();
    setupCanvas();
    connectWebSocket();
});

// 로그인 상태 확인
function checkLoginStatus() {
    const token = localStorage.getItem('userToken');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
        currentUser = JSON.parse(userData);
        showApp();
    } else {
        showLogin();
    }
}

// 로그인 화면 표시
function showLogin() {
    loginScreen.classList.remove('hidden');
    app.classList.add('hidden');
}

// 앱 화면 표시
function showApp() {
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    
    // 사용자 정보 표시
    userAvatar.src = currentUser.picture;
    userName.textContent = currentUser.name;
    
    // 캔버스 업데이트
    updateCanvasTransform();
    
    // 스티키 노트 로드
    loadStickyNotes();
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 로그인 스티키 노트 클릭
    loginNote.addEventListener('click', handleGoogleLogin);
    
    // 도구 버튼들
    moveToolBtn.addEventListener('click', () => setTool('move'));
    noteToolBtn.addEventListener('click', () => setTool('note'));
    
    // 줌 컨트롤
    zoomInBtn.addEventListener('click', () => zoom(1.2));
    zoomOutBtn.addEventListener('click', () => zoom(0.8));
    
    // 로그아웃
    logoutBtn.addEventListener('click', handleLogout);
    
    // 캔버스 이벤트
    canvasContainer.addEventListener('mousedown', handleCanvasMouseDown);
    canvasContainer.addEventListener('mousemove', handleCanvasMouseMove);
    canvasContainer.addEventListener('mouseup', handleCanvasMouseUp);
    canvasContainer.addEventListener('wheel', handleCanvasWheel);
    
    // 노트 에디터 이벤트
    closeEditorBtn.addEventListener('click', closeNoteEditor);
    cancelNoteBtn.addEventListener('click', closeNoteEditor);
    saveNoteBtn.addEventListener('click', saveNote);
    
    // 색상 선택
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = btn.dataset.color;
        });
    });
    
    // 그리기 도구
    drawingBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.id === 'clear-drawing') {
                clearDrawing();
            } else {
                drawingBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setDrawingTool(e.target.id);
            }
        });
    });
    
    // 그리기 캔버스
    setupDrawingCanvas();
}

// 구글 로그인 처리
async function handleGoogleLogin() {
    // 스티키 노트 떨어지는 애니메이션
    loginNote.classList.add('falling');
    
    try {
        // 실제 구글 로그인 구현을 위해서는 Google OAuth 설정이 필요합니다
        // 여기서는 데모용으로 가상의 사용자 데이터를 사용합니다
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 데모 사용자 (실제로는 Google API에서 받아옴)
        const user = {
            id: 'demo_user_' + Date.now(),
            name: '데모 사용자',
            email: 'demo@example.com',
            picture: 'https://ui-avatars.com/api/?name=Demo+User&background=FFEB3B&color=333'
        };
        
        currentUser = user;
        localStorage.setItem('userData', JSON.stringify(user));
        localStorage.setItem('userToken', 'demo_token_' + Date.now());
        
        setTimeout(() => {
            showApp();
        }, 1000);
        
    } catch (error) {
        console.error('로그인 실패:', error);
        // 에러 처리
        loginNote.classList.remove('falling');
    }
}

// 로그아웃 처리
function handleLogout() {
    localStorage.removeItem('userData');
    localStorage.removeItem('userToken');
    currentUser = null;
    if (ws) {
        ws.close();
    }
    showLogin();
    location.reload();
}

// 도구 설정
function setTool(tool) {
    currentTool = tool;
    
    // 도구 버튼 상태 업데이트
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (tool === 'move') {
        moveToolBtn.classList.add('active');
        canvasContainer.className = 'canvas-container move-mode';
    } else if (tool === 'note') {
        noteToolBtn.classList.add('active');
        canvasContainer.className = 'canvas-container note-mode';
    }
}

// 줌 기능
function zoom(factor) {
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(0.1, Math.min(3, zoomLevel * factor));
    
    // 화면 중앙을 기준으로 줌
    const rect = canvasContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // 줌 중심점 조정
    panX = centerX - (centerX - panX) * (zoomLevel / oldZoom);
    panY = centerY - (centerY - panY) * (zoomLevel / oldZoom);
    
    updateCanvasTransform();
    updateZoomLevel();
}

// 캔버스 변환 업데이트
function updateCanvasTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

// 줌 레벨 표시 업데이트
function updateZoomLevel() {
    zoomLevelSpan.textContent = Math.round(zoomLevel * 100) + '%';
}

// 캔버스 설정
function setupCanvas() {
    updateCanvasTransform();
    updateZoomLevel();
}

// 마우스 이벤트 처리
function handleCanvasMouseDown(e) {
    if (currentTool === 'move') {
        isDragging = true;
        canvasContainer.classList.add('grabbing');
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    } else if (currentTool === 'note') {
        // 노트 생성 모달 열기
        openNoteEditor(e);
    }
}

function handleCanvasMouseMove(e) {
    if (isDragging && currentTool === 'move') {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        
        panX += deltaX;
        panY += deltaY;
        
        updateCanvasTransform();
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
}

function handleCanvasMouseUp(e) {
    if (isDragging) {
        isDragging = false;
        canvasContainer.classList.remove('grabbing');
    }
}

function handleCanvasWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(factor);
}

// 노트 에디터 열기
function openNoteEditor(e) {
    // 마우스 위치를 캔버스 좌표로 변환
    const rect = canvasContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;
    
    // 에디터에 위치 정보 저장
    noteEditor.dataset.x = x;
    noteEditor.dataset.y = y;
    
    // 에디터 초기화
    noteText.value = '';
    clearDrawing();
    selectedColor = '#FFEB3B';
    colorBtns[0].classList.add('selected');
    
    noteEditor.classList.remove('hidden');
}

// 노트 에디터 닫기
function closeNoteEditor() {
    noteEditor.classList.add('hidden');
}

// 그리기 캔버스 설정
function setupDrawingCanvas() {
    drawingCanvas.addEventListener('mousedown', startDrawing);
    drawingCanvas.addEventListener('mousemove', draw);
    drawingCanvas.addEventListener('mouseup', stopDrawing);
    drawingCanvas.addEventListener('mouseout', stopDrawing);
}

function startDrawing(e) {
    isDrawing = true;
    const rect = drawingCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    drawingCtx.beginPath();
    drawingCtx.moveTo(x, y);
}

function draw(e) {
    if (!isDrawing) return;
    
    const rect = drawingCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    drawingCtx.lineWidth = 2;
    drawingCtx.lineCap = 'round';
    drawingCtx.strokeStyle = '#333';
    
    if (drawingTool === 'pen') {
        drawingCtx.lineTo(x, y);
        drawingCtx.stroke();
    } else if (drawingTool === 'underline-tool') {
        // 밑줄 그리기
        drawingCtx.beginPath();
        drawingCtx.moveTo(x - 20, y);
        drawingCtx.lineTo(x + 20, y);
        drawingCtx.stroke();
        stopDrawing();
    } else if (drawingTool === 'circle-tool') {
        // 동그라미 그리기
        drawingCtx.beginPath();
        drawingCtx.arc(x, y, 15, 0, 2 * Math.PI);
        drawingCtx.stroke();
        stopDrawing();
    }
}

function stopDrawing() {
    isDrawing = false;
}

function setDrawingTool(tool) {
    drawingTool = tool;
}

function clearDrawing() {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
}

// 노트 저장
async function saveNote() {
    const text = noteText.value.trim();
    const drawingData = drawingCanvas.toDataURL();
    const x = parseFloat(noteEditor.dataset.x);
    const y = parseFloat(noteEditor.dataset.y);
    
    if (!text && drawingData === drawingCanvas.toDataURL()) {
        alert('내용을 입력해주세요!');
        return;
    }
    
    const note = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        text: text,
        drawing: drawingData,
        color: selectedColor,
        x: x,
        y: y,
        author: currentUser.name,
        authorId: currentUser.id,
        timestamp: Date.now(),
        rotation: (Math.random() - 0.5) * 10 // -5도에서 5도 사이 랜덤 회전
    };
    
    // 서버에 전송
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'create_note',
            note: note
        }));
    }
    
    // 로컬에 추가
    addStickyNote(note);
    
    closeNoteEditor();
}

// 스티키 노트 추가
function addStickyNote(note) {
    stickyNotes.push(note);
    renderStickyNote(note);
}

// 스티키 노트 렌더링
function renderStickyNote(note) {
    const noteElement = document.createElement('div');
    noteElement.className = 'sticky-note';
    noteElement.style.backgroundColor = note.color;
    noteElement.style.left = note.x + 'px';
    noteElement.style.top = note.y + 'px';
    noteElement.style.transform = `rotate(${note.rotation}deg)`;
    noteElement.dataset.noteId = note.id;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    
    if (note.text) {
        const textDiv = document.createElement('div');
        textDiv.className = 'note-text';
        textDiv.textContent = note.text;
        contentDiv.appendChild(textDiv);
    }
    
    if (note.drawing && note.drawing !== drawingCanvas.toDataURL()) {
        const drawingImg = document.createElement('img');
        drawingImg.className = 'note-drawing';
        drawingImg.src = note.drawing;
        drawingImg.style.maxWidth = '100%';
        drawingImg.style.height = 'auto';
        contentDiv.appendChild(drawingImg);
    }
    
    const authorDiv = document.createElement('div');
    authorDiv.className = 'note-author';
    authorDiv.textContent = note.author;
    
    noteElement.appendChild(contentDiv);
    noteElement.appendChild(authorDiv);
    
    canvas.appendChild(noteElement);
}

// WebSocket 연결
function connectWebSocket() {
    // Cloudflare Workers의 WebSocket 엔드포인트에 연결
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket 연결됨');
        
        // 인증 메시지 전송
        if (currentUser) {
            ws.send(JSON.stringify({
                type: 'auth',
                token: localStorage.getItem('userToken'),
                user: currentUser
            }));
        }
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'note_created':
                // 다른 사용자가 만든 노트
                if (data.note.authorId !== currentUser.id) {
                    addStickyNote(data.note);
                }
                break;
            case 'notes_load':
                // 기존 노트들 로드
                data.notes.forEach(note => addStickyNote(note));
                break;
            case 'user_joined':
                console.log('새 사용자 접속:', data.user.name);
                break;
            case 'user_left':
                console.log('사용자 퇴장:', data.user.name);
                break;
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket 연결 끊김');
        // 재연결 시도
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket 에러:', error);
    };
}

// 스티키 노트 로드
function loadStickyNotes() {
    // WebSocket을 통해 서버에서 기존 노트들을 요청
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'load_notes'
        }));
    }
}

// 키보드 단축키
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!noteEditor.classList.contains('hidden')) {
            closeNoteEditor();
        }
    }
    
    // 도구 전환 (스페이스바)
    if (e.code === 'Space' && !e.target.matches('textarea, input')) {
        e.preventDefault();
        setTool(currentTool === 'move' ? 'note' : 'move');
    }
    
    // 줌 (Ctrl + 휠)
    if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            zoom(1.2);
        } else if (e.key === '-') {
            e.preventDefault();
            zoom(0.8);
        }
    }
});

// 컨텍스트 메뉴 비활성화 (우클릭 방지)
document.addEventListener('contextmenu', e => e.preventDefault()); 