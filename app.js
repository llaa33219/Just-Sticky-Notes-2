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
let draggedNote = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDraggingNote = false;
let lastUpdateTime = 0;
let updateThrottle = 25; // 25ms 간격으로 초고속 실시간 업데이트
let currentNoteTool = 'text';
let noteIsDrawing = false;
let reconnectInterval = null;
let heartbeatInterval = null;
let isPageVisible = true;
let connectionStatus = 'disconnected'; // 'connected', 'connecting', 'disconnected'

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
const stickyNotePreview = document.getElementById('stickyNotePreview');
const unifiedCanvas = document.getElementById('unified-canvas');
const unifiedCtx = unifiedCanvas.getContext('2d');
const noteTextOverlay = document.getElementById('note-text-overlay');
const saveNoteBtn = document.getElementById('save-note');
const cancelNoteBtn = document.getElementById('cancel-note');

// 새로운 도구 버튼들
const textToolBtn = document.getElementById('text-tool');
const penToolBtn = document.getElementById('pen-tool');
const underlineToolBtn = document.getElementById('underline-tool');
const circleToolBtn = document.getElementById('circle-tool');
const clearAllBtn = document.getElementById('clear-all');

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    setupEventListeners();
    setupCanvas();
    connectWebSocket();
    setupVisibilityHandlers();
    setupConnectionStatusIndicator();
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
    
    // WebSocket이 이미 연결되어 있으면 동기화
    if (ws && ws.readyState === WebSocket.OPEN) {
        syncWithServer();
    }
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
            updateStickyNotePreview();
        });
    });
    
    // 노트 도구들
    textToolBtn.addEventListener('click', () => setNoteTool('text'));
    penToolBtn.addEventListener('click', () => setNoteTool('pen'));
    underlineToolBtn.addEventListener('click', () => setNoteTool('underline'));
    circleToolBtn.addEventListener('click', () => setNoteTool('circle'));
    clearAllBtn.addEventListener('click', clearAll);
    
    // 텍스트 오버레이 입력 이벤트
    noteTextOverlay.addEventListener('input', updateStickyNotePreview);
    
    // 통합 캔버스 설정
    setupUnifiedCanvas();
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

function zoom(factor) {
    const rect = canvasContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(0.1, Math.min(3, zoomLevel * factor));
    
    // 중심점 기준으로 줌
    const zoomChange = zoomLevel / oldZoom;
    panX = centerX - (centerX - panX) * zoomChange;
    panY = centerY - (centerY - panY) * zoomChange;
    
    updateCanvasTransform();
    updateZoomLevel();
}

function updateCanvasTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

function updateZoomLevel() {
    zoomLevelSpan.textContent = Math.round(zoomLevel * 100) + '%';
}

function setupCanvas() {
    updateCanvasTransform();
    updateZoomLevel();
}

function handleCanvasMouseDown(e) {
    const rect = canvasContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;
    
    // 스티키 노트 클릭 확인 (드래그용)
    const clickedNote = e.target.closest('.sticky-note');
    if (clickedNote && currentTool === 'move') {
        const noteId = clickedNote.dataset.noteId;
        const note = stickyNotes.find(n => n.id === noteId);
        
        // 본인이 만든 노트만 드래그 가능
        if (note && note.authorId === currentUser.id) {
            isDraggingNote = true;
            draggedNote = clickedNote;
            const noteRect = clickedNote.getBoundingClientRect();
            dragOffsetX = (e.clientX - noteRect.left) / zoomLevel;
            dragOffsetY = (e.clientY - noteRect.top) / zoomLevel;
            
            // 드래그 시작 시 애니메이션 비활성화
            clickedNote.style.transition = 'none';
            clickedNote.style.zIndex = '1000';
            
            e.preventDefault();
            return;
        }
    }
    
    if (currentTool === 'note' && !clickedNote) {
        openNoteEditor(e);
    } else if (currentTool === 'move' && !draggedNote) {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        canvasContainer.style.cursor = 'grabbing';
        
        // 패닝 시 부드러운 움직임을 위해 transition 제거
        canvas.style.transition = 'none';
    }
}

function handleCanvasMouseMove(e) {
    if (isDraggingNote && draggedNote) {
        // 스티키 노트 드래그 - 실시간으로 서버에 업데이트
        requestAnimationFrame(() => {
            const rect = canvasContainer.getBoundingClientRect();
            const newX = (e.clientX - rect.left - panX) / zoomLevel - dragOffsetX;
            const newY = (e.clientY - rect.top - panY) / zoomLevel - dragOffsetY;
            
            // 즉시 로컬 UI 업데이트
            draggedNote.style.left = newX + 'px';
            draggedNote.style.top = newY + 'px';
            
            // 로컬 데이터 업데이트
            const noteId = draggedNote.dataset.noteId;
            const note = stickyNotes.find(n => n.id === noteId);
            if (note) {
                note.x = newX;
                note.y = newY;
                
                // 실시간 서버 업데이트 (throttled)
                const now = Date.now();
                if (now - lastUpdateTime > updateThrottle) {
                    sendNoteUpdate(note);
                    lastUpdateTime = now;
                }
            }
        });
        
    } else if (isDragging && currentTool === 'move') {
        // 캔버스 패닝 - requestAnimationFrame으로 최적화
        requestAnimationFrame(() => {
            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            
            panX += deltaX;
            panY += deltaY;
            
            updateCanvasTransform();
            
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        });
    }
}

function handleCanvasMouseUp(e) {
    if (isDraggingNote && draggedNote) {
        // 드래그 종료 시 애니메이션 재활성화
        draggedNote.style.transition = 'all 0.2s ease';
        draggedNote.style.zIndex = '';
        
        // 최종 위치 업데이트 전송 (확실하게)
        const noteId = draggedNote.dataset.noteId;
        const note = stickyNotes.find(n => n.id === noteId);
        if (note) {
            sendNoteUpdate(note);
        }
        
        isDraggingNote = false;
        draggedNote = null;
        lastUpdateTime = 0; // throttle 초기화
    } else {
        isDragging = false;
        canvasContainer.style.cursor = '';
        
        // 패닝 종료 시 transition 복원
        canvas.style.transition = 'transform 0.1s ease';
    }
}

function handleCanvasWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(factor);
}

function openNoteEditor(e) {
    const rect = canvasContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;
    
    noteEditor.dataset.x = x;
    noteEditor.dataset.y = y;
    noteEditor.classList.remove('hidden');
    
    // 초기화
    noteTextOverlay.value = '';
    clearDrawing();
    
    // 첫 번째 색상 선택
    colorBtns[0].click();
    
    // 텍스트 도구로 시작
    setNoteTool('text');
    
    // 텍스트 입력 포커스
    setTimeout(() => noteTextOverlay.focus(), 100);
}

function closeNoteEditor() {
    noteEditor.classList.add('hidden');
    // 정리
    noteTextOverlay.value = '';
    clearDrawing();
}

function setupDrawingCanvas() {
    unifiedCtx.strokeStyle = '#333';
    unifiedCtx.lineWidth = 2;
    unifiedCtx.lineCap = 'round';
    
    unifiedCanvas.addEventListener('mousedown', startDrawing);
    unifiedCanvas.addEventListener('mousemove', draw);
    unifiedCanvas.addEventListener('mouseup', stopDrawing);
    unifiedCanvas.addEventListener('mouseout', stopDrawing);
}

function startDrawing(e) {
    if (currentNoteTool === 'text') return; // 텍스트 모드에서는 그리기 비활성화
    
    noteIsDrawing = true;
    const rect = unifiedCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (currentNoteTool === 'pen') {
        unifiedCtx.beginPath();
        unifiedCtx.moveTo(x, y);
    }
}

function draw(e) {
    if (!noteIsDrawing || currentNoteTool === 'text') return;
    
    const rect = unifiedCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (currentNoteTool === 'pen') {
        unifiedCtx.lineTo(x, y);
        unifiedCtx.stroke();
    } else if (currentNoteTool === 'underline') {
        // 밑줄 그리기
        unifiedCtx.beginPath();
        unifiedCtx.moveTo(x - 20, y);
        unifiedCtx.lineTo(x + 20, y);
        unifiedCtx.stroke();
        stopDrawing();
    } else if (currentNoteTool === 'circle') {
        // 동그라미 그리기
        unifiedCtx.beginPath();
        unifiedCtx.arc(x, y, 15, 0, 2 * Math.PI);
        unifiedCtx.stroke();
        stopDrawing();
    }
}

function stopDrawing() {
    noteIsDrawing = false;
}

function setDrawingTool(tool) {
    currentNoteTool = tool;
}

function clearDrawing() {
    unifiedCtx.clearRect(0, 0, unifiedCanvas.width, unifiedCanvas.height);
}

// 노트 저장
async function saveNote() {
    const text = noteTextOverlay.value.trim();
    const drawingData = unifiedCanvas.toDataURL();
    const x = parseFloat(noteEditor.dataset.x);
    const y = parseFloat(noteEditor.dataset.y);
    
    // 빈 캔버스 체크
    const emptyCanvas = document.createElement('canvas');
    emptyCanvas.width = unifiedCanvas.width;
    emptyCanvas.height = unifiedCanvas.height;
    const isEmpty = drawingData === emptyCanvas.toDataURL();
    
    if (!text && isEmpty) {
        alert('내용을 입력해주세요!');
        return;
    }
    
    // 텍스트와 그림을 합친 최종 이미지 생성
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = unifiedCanvas.width;
    finalCanvas.height = unifiedCanvas.height;
    const finalCtx = finalCanvas.getContext('2d');
    
    // 그림 먼저 그리기
    if (!isEmpty) {
        finalCtx.drawImage(unifiedCanvas, 0, 0);
    }
    
    // 텍스트 오버레이
    if (text) {
        finalCtx.fillStyle = '#333';
        finalCtx.font = '18px Caveat, cursive';
        finalCtx.textAlign = 'left';
        finalCtx.textBaseline = 'top';
        
        // 여러 줄 텍스트 처리
        const lines = text.split('\n');
        const lineHeight = 22;
        lines.forEach((line, index) => {
            finalCtx.fillText(line, 10, 10 + (index * lineHeight));
        });
    }
    
    const note = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        text: text,
        drawing: finalCanvas.toDataURL(),
        color: selectedColor,
        x: x,
        y: y,
        author: currentUser.name,
        authorId: currentUser.id,
        timestamp: Date.now(),
        rotation: (Math.random() - 0.5) * 10 // -5도에서 5도 사이 랜덤 회전
    };
    
    // 서버에만 전송, 로컬에는 추가하지 않음 (서버 응답 대기)
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'create_note',
            note: note
        }));
        
        // 저장 버튼 비활성화하여 중복 전송 방지
        const saveBtn = document.getElementById('save-note');
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
    }
    
    closeNoteEditor();
}

// 스티키 노트 추가 (중복 방지)
function addStickyNote(note) {
    // 이미 존재하는 노트인지 확인
    if (stickyNotes.find(n => n.id === note.id)) {
        return;
    }
    
    stickyNotes.push(note);
    renderStickyNote(note);
}

// 스티키 노트 렌더링
function renderStickyNote(note) {
    // 이미 렌더링된 노트인지 확인
    if (canvas.querySelector(`[data-note-id="${note.id}"]`)) {
        return;
    }
    
    const noteElement = document.createElement('div');
    noteElement.className = 'sticky-note';
    noteElement.style.backgroundColor = note.color;
    noteElement.style.left = note.x + 'px';
    noteElement.style.top = note.y + 'px';
    noteElement.style.transform = `rotate(${note.rotation}deg)`;
    noteElement.dataset.noteId = note.id;
    
    // 본인이 만든 노트는 드래그 가능 표시
    if (note.authorId === currentUser.id) {
        noteElement.classList.add('draggable');
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    
    // 통합 이미지가 있으면 표시
    if (note.drawing) {
        const drawingImg = document.createElement('img');
        drawingImg.className = 'note-drawing';
        drawingImg.src = note.drawing;
        drawingImg.style.maxWidth = '100%';
        drawingImg.style.height = 'auto';
        contentDiv.appendChild(drawingImg);
    }
    
    // 텍스트만 있고 그림이 없는 경우 (하위 호환성)
    if (note.text && !note.drawing) {
        const textDiv = document.createElement('div');
        textDiv.className = 'note-text';
        textDiv.textContent = note.text;
        contentDiv.appendChild(textDiv);
    }
    
    const authorDiv = document.createElement('div');
    authorDiv.className = 'note-author';
    authorDiv.textContent = note.author;
    
    noteElement.appendChild(contentDiv);
    noteElement.appendChild(authorDiv);
    
    canvas.appendChild(noteElement);
}

// 페이지 가시성 변경 처리
function setupVisibilityHandlers() {
    // 페이지 가시성 API
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        
        if (isPageVisible && currentUser) {
            // 페이지가 다시 보이면 동기화
            console.log('페이지 활성화 - 동기화 시작');
            syncWithServer();
        }
    });
    
    // 윈도우 포커스/블러 이벤트
    window.addEventListener('focus', () => {
        isPageVisible = true;
        if (currentUser) {
            console.log('윈도우 포커스 - 동기화 시작');
            syncWithServer();
        }
    });
    
    window.addEventListener('blur', () => {
        isPageVisible = false;
    });
}

// 연결 상태 표시기 설정
function setupConnectionStatusIndicator() {
    const statusIndicator = document.createElement('div');
    statusIndicator.id = 'connection-status';
    statusIndicator.className = 'connection-status disconnected';
    statusIndicator.innerHTML = '<span class="status-dot"></span><span class="status-text">연결 중...</span>';
    document.body.appendChild(statusIndicator);
}

// 연결 상태 업데이트
function updateConnectionStatus(status) {
    connectionStatus = status;
    const indicator = document.getElementById('connection-status');
    if (!indicator) return;
    
    indicator.className = `connection-status ${status}`;
    
    switch (status) {
        case 'connected':
            indicator.innerHTML = '<span class="status-dot"></span><span class="status-text">실시간 연결됨</span>';
            break;
        case 'connecting':
            indicator.innerHTML = '<span class="status-dot"></span><span class="status-text">연결 중...</span>';
            break;
        case 'disconnected':
            indicator.innerHTML = '<span class="status-dot"></span><span class="status-text">연결 끊김</span>';
            break;
    }
}

// 서버와 동기화
function syncWithServer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // 모든 노트 다시 로드
        ws.send(JSON.stringify({
            type: 'sync_request',
            timestamp: Date.now()
        }));
    } else {
        // WebSocket이 연결되어 있지 않으면 재연결 시도
        connectWebSocket();
    }
}

// WebSocket 연결
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return; // 이미 연결 중이거나 연결됨
    }
    
    updateConnectionStatus('connecting');
    
    // 기존 간격 정리
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    // Cloudflare Workers의 WebSocket 엔드포인트에 연결
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket 연결됨');
        updateConnectionStatus('connected');
        
        // 인증 메시지 전송
        if (currentUser) {
            ws.send(JSON.stringify({
                type: 'auth',
                token: localStorage.getItem('userToken'),
                user: currentUser
            }));
        }
        
        // 하트비트 시작
        startHeartbeat();
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'note_created':
                // 서버에서 노트 생성 완료 - 모든 사용자에게 추가
                addStickyNote(data.note);
                
                // 본인이 만든 노트인 경우 저장 버튼 복원
                if (data.note.authorId === currentUser.id) {
                    const saveBtn = document.getElementById('save-note');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = '붙이기';
                    }
                }
                break;
            case 'note_updated':
                // 노트 위치 업데이트
                updateNotePosition(data.noteId, data.x, data.y);
                break;
            case 'notes_load':
            case 'sync_response':
                // 기존 노트들 로드 또는 동기화 응답
                handleNotesSync(data.notes);
                break;
            case 'user_joined':
                console.log('새 사용자 접속:', data.user.name);
                showNotification(`${data.user.name}님이 접속했습니다`, 'info');
                break;
            case 'user_left':
                console.log('사용자 퇴장:', data.user.name);
                showNotification(`${data.user.name}님이 나갔습니다`, 'info');
                break;
            case 'auth_success':
                // 인증 성공 후 노트 로드 요청
                ws.send(JSON.stringify({
                    type: 'load_notes'
                }));
                break;
            case 'pong':
                // 하트비트 응답
                console.log('Heartbeat: 연결 유지됨');
                break;
        }
    };
    
    ws.onclose = (event) => {
        console.log('WebSocket 연결 끊김:', event.code, event.reason);
        updateConnectionStatus('disconnected');
        
        // 하트비트 중지
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        
        // 자동 재연결 (3초 후)
        if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
                if (currentUser && isPageVisible) {
                    console.log('WebSocket 재연결 시도...');
                    connectWebSocket();
                }
            }, 3000);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket 에러:', error);
        updateConnectionStatus('disconnected');
    };
}

// 하트비트 시작
function startHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ping',
                timestamp: Date.now()
            }));
        }
    }, 15000); // 15초마다 ping (더 자주 연결 확인)
}

// 노트 동기화 처리
function handleNotesSync(notes) {
    // 기존 노트들과 비교하여 변경사항만 적용
    const existingNoteIds = new Set(stickyNotes.map(n => n.id));
    const newNoteIds = new Set(notes.map(n => n.id));
    
    // 삭제된 노트 제거
    stickyNotes.forEach(note => {
        if (!newNoteIds.has(note.id)) {
            removeNoteFromDOM(note.id);
        }
    });
    
    // 새로운 노트들 추가/업데이트
    notes.forEach(note => {
        if (!existingNoteIds.has(note.id)) {
            // 새 노트 추가
            addStickyNote(note);
        } else {
            // 기존 노트 업데이트 (위치 등)
            updateExistingNote(note);
        }
    });
    
    console.log(`동기화 완료: ${notes.length}개 노트`);
}

// 기존 노트 업데이트
function updateExistingNote(newNote) {
    const existingNote = stickyNotes.find(n => n.id === newNote.id);
    if (!existingNote) return;
    
    // 위치나 내용이 변경되었는지 확인
    if (existingNote.x !== newNote.x || existingNote.y !== newNote.y) {
        updateNotePosition(newNote.id, newNote.x, newNote.y);
    }
    
    // 다른 속성들도 업데이트
    Object.assign(existingNote, newNote);
}

// DOM에서 노트 제거
function removeNoteFromDOM(noteId) {
    const noteElement = canvas.querySelector(`[data-note-id="${noteId}"]`);
    if (noteElement) {
        noteElement.remove();
    }
    
    // 배열에서도 제거
    const index = stickyNotes.findIndex(n => n.id === noteId);
    if (index !== -1) {
        stickyNotes.splice(index, 1);
    }
}

// 알림 표시
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // 3초 후 제거
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// 노트 위치 업데이트 전송
function sendNoteUpdate(note) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_note',
            noteId: note.id,
            x: note.x,
            y: note.y
        }));
    }
}

// 노트 위치 업데이트 (다른 사용자의 노트 이동 반영)
function updateNotePosition(noteId, x, y) {
    // 로컬 데이터 업데이트
    const note = stickyNotes.find(n => n.id === noteId);
    if (note) {
        note.x = x;
        note.y = y;
    }
    
    // DOM 요소 업데이트 (현재 드래그 중인 노트가 아닌 경우에만)
    if (!isDraggingNote || (draggedNote && draggedNote.dataset.noteId !== noteId)) {
        const noteElement = canvas.querySelector(`[data-note-id="${noteId}"]`);
        if (noteElement) {
            // 매우 부드러운 실시간 애니메이션
            noteElement.style.transition = 'left 0.1s ease-out, top 0.1s ease-out';
            noteElement.style.left = x + 'px';
            noteElement.style.top = y + 'px';
            
            // 짧은 시간 후 원래 transition으로 복원
            setTimeout(() => {
                if (noteElement.style.transition.includes('0.1s')) {
                    noteElement.style.transition = 'all 0.2s ease';
                }
            }, 100);
        }
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

function updateStickyNotePreview() {
    // 스티키 노트 프리뷰 색상 업데이트
    stickyNotePreview.style.backgroundColor = selectedColor;
}

function setNoteTool(tool) {
    currentNoteTool = tool;
    
    // 도구 버튼 상태 업데이트
    document.querySelectorAll('.note-tools .tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 텍스트 오버레이 상태 변경
    if (tool === 'text') {
        textToolBtn.classList.add('active');
        noteTextOverlay.classList.add('text-mode');
        unifiedCanvas.style.pointerEvents = 'none';
    } else {
        if (tool === 'pen') penToolBtn.classList.add('active');
        else if (tool === 'underline') underlineToolBtn.classList.add('active');
        else if (tool === 'circle') circleToolBtn.classList.add('active');
        
        noteTextOverlay.classList.remove('text-mode');
        unifiedCanvas.style.pointerEvents = 'all';
    }
}

function clearAll() {
    clearDrawing();
    noteTextOverlay.value = '';
    updateStickyNotePreview();
}

function setupUnifiedCanvas() {
    unifiedCtx.strokeStyle = '#333';
    unifiedCtx.lineWidth = 2;
    unifiedCtx.lineCap = 'round';
    
    unifiedCanvas.addEventListener('mousedown', startDrawing);
    unifiedCanvas.addEventListener('mousemove', draw);
    unifiedCanvas.addEventListener('mouseup', stopDrawing);
    unifiedCanvas.addEventListener('mouseout', stopDrawing);
} 