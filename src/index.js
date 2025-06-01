import './styles.css';

class StickyNotesApp {
    constructor() {
        this.user = null;
        this.websocket = null;
        this.canvas = null;
        this.ctx = null;
        this.currentTool = 'move';
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.zoom = 1;
        this.notes = new Map();
        this.editingNote = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
    }

    setupEventListeners() {
        // 로그인 이벤트
        document.getElementById('login-note').addEventListener('click', () => {
            this.handleLogin();
        });

        // 도구 선택 이벤트
        document.querySelectorAll('.tool').forEach(tool => {
            tool.addEventListener('click', (e) => {
                this.selectTool(e.currentTarget.dataset.tool);
            });
        });

        // 줌 컨트롤 이벤트
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.zoomIn();
        });
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.zoomOut();
        });
        document.getElementById('fit-screen').addEventListener('click', () => {
            this.fitScreen();
        });

        // 모달 이벤트
        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeModal();
        });
        document.getElementById('save-note').addEventListener('click', () => {
            this.saveNote();
        });
        document.getElementById('delete-note').addEventListener('click', () => {
            this.deleteNote();
        });

        // 로그아웃 이벤트
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // 캔버스 이벤트
        this.setupCanvasEvents();

        // 키보드 이벤트
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
    }

    setupCanvasEvents() {
        const canvasContainer = document.getElementById('canvas-container');
        
        canvasContainer.addEventListener('mousedown', (e) => {
            this.handleMouseDown(e);
        });
        
        canvasContainer.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });
        
        canvasContainer.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e);
        });

        canvasContainer.addEventListener('wheel', (e) => {
            this.handleWheel(e);
        });

        // 터치 이벤트 (모바일 지원)
        canvasContainer.addEventListener('touchstart', (e) => {
            this.handleTouchStart(e);
        });
        
        canvasContainer.addEventListener('touchmove', (e) => {
            this.handleTouchMove(e);
        });
        
        canvasContainer.addEventListener('touchend', (e) => {
            this.handleTouchEnd(e);
        });
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/check');
            const data = await response.json();
            
            if (data.authenticated) {
                this.user = data.user;
                this.showMainScreen();
                this.connectWebSocket();
            } else {
                this.showLoginScreen();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.showLoginScreen();
        }
    }

    async handleLogin() {
        const loginNote = document.getElementById('login-note');
        loginNote.classList.add('falling');
        
        setTimeout(async () => {
            this.showLoading();
            
            try {
                window.location.href = '/api/auth/google';
            } catch (error) {
                console.error('Login failed:', error);
                this.hideLoading();
                this.showLoginScreen();
            }
        }, 500);
    }

    logout() {
        fetch('/api/auth/logout', { method: 'POST' })
            .then(() => {
                this.user = null;
                if (this.websocket) {
                    this.websocket.close();
                }
                this.showLoginScreen();
            })
            .catch(error => {
                console.error('Logout failed:', error);
            });
    }

    showLoginScreen() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('main-screen').classList.add('hidden');
        document.getElementById('loading').classList.add('hidden');
    }

    showMainScreen() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        document.getElementById('loading').classList.add('hidden');
        
        // 사용자 정보 표시
        document.getElementById('user-avatar').src = this.user.picture;
        document.getElementById('user-name').textContent = this.user.name;
        
        // 캔버스 초기화
        this.initCanvas();
        
        // 기본 도구 선택
        this.selectTool('move');
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    initCanvas() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.render();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth * 2; // 더 큰 가상 캔버스
        this.canvas.height = window.innerHeight * 2;
        this.canvas.style.width = window.innerWidth * 2 + 'px';
        this.canvas.style.height = window.innerHeight * 2 + 'px';
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws`;
        
        this.websocket = new WebSocket(wsUrl);
        
        this.websocket.onopen = () => {
            console.log('WebSocket connected');
            this.requestNotes();
        };
        
        this.websocket.onmessage = (event) => {
            this.handleWebSocketMessage(JSON.parse(event.data));
        };
        
        this.websocket.onclose = () => {
            console.log('WebSocket disconnected');
            // 재연결 시도
            setTimeout(() => {
                if (this.user) {
                    this.connectWebSocket();
                }
            }, 3000);
        };
        
        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'note_created':
            case 'note_updated':
                this.updateNote(message.note);
                break;
            case 'note_deleted':
                this.removeNote(message.noteId);
                break;
            case 'notes_list':
                this.loadNotes(message.notes);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    requestNotes() {
        this.sendWebSocketMessage({
            type: 'get_notes',
            area: {
                x: this.offsetX - window.innerWidth,
                y: this.offsetY - window.innerHeight,
                width: window.innerWidth * 2,
                height: window.innerHeight * 2
            }
        });
    }

    loadNotes(notes) {
        this.notes.clear();
        notes.forEach(note => {
            this.notes.set(note.id, note);
        });
        this.render();
    }

    updateNote(note) {
        this.notes.set(note.id, note);
        this.render();
    }

    removeNote(noteId) {
        this.notes.delete(noteId);
        this.render();
    }

    selectTool(tool) {
        this.currentTool = tool;
        
        // UI 업데이트
        document.querySelectorAll('.tool').forEach(t => {
            t.classList.remove('active');
        });
        document.querySelector(`[data-tool="${tool}"]`).classList.add('active');
        
        // 캔버스 커서 변경
        const canvasContainer = document.getElementById('canvas-container');
        if (tool === 'move') {
            canvasContainer.style.cursor = 'grab';
        } else if (tool === 'note') {
            canvasContainer.style.cursor = 'crosshair';
        }
    }

    handleMouseDown(e) {
        this.isDrawing = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        
        if (this.currentTool === 'move') {
            document.getElementById('canvas-container').style.cursor = 'grabbing';
        } else if (this.currentTool === 'note') {
            this.createNote(e.clientX - this.offsetX, e.clientY - this.offsetY);
        }
    }

    handleMouseMove(e) {
        if (!this.isDrawing) return;
        
        if (this.currentTool === 'move') {
            const deltaX = e.clientX - this.lastX;
            const deltaY = e.clientY - this.lastY;
            
            this.offsetX += deltaX;
            this.offsetY += deltaY;
            
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            
            this.render();
        }
    }

    handleMouseUp(e) {
        this.isDrawing = false;
        
        if (this.currentTool === 'move') {
            document.getElementById('canvas-container').style.cursor = 'grab';
        }
    }

    handleWheel(e) {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(3, this.zoom * delta));
        
        if (newZoom !== this.zoom) {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            this.offsetX = mouseX - (mouseX - this.offsetX) * (newZoom / this.zoom);
            this.offsetY = mouseY - (mouseY - this.offsetY) * (newZoom / this.zoom);
            
            this.zoom = newZoom;
            this.render();
        }
    }

    handleTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        this.handleMouseUp(e);
    }

    handleKeyDown(e) {
        switch (e.key) {
            case 'Escape':
                this.closeModal();
                break;
            case '1':
                this.selectTool('move');
                break;
            case '2':
                this.selectTool('note');
                break;
        }
    }

    zoomIn() {
        this.zoom = Math.min(3, this.zoom * 1.2);
        this.render();
    }

    zoomOut() {
        this.zoom = Math.max(0.1, this.zoom * 0.8);
        this.render();
    }

    fitScreen() {
        this.zoom = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.render();
    }

    createNote(x, y) {
        this.editingNote = {
            id: null,
            x: x,
            y: y,
            content: '',
            color: '#ffeb3b',
            author: this.user.name,
            authorId: this.user.id
        };
        
        this.showNoteModal();
    }

    editNote(note) {
        this.editingNote = { ...note };
        this.showNoteModal();
        
        document.getElementById('note-text').value = note.content;
        document.getElementById('note-color').value = note.color;
    }

    showNoteModal() {
        document.getElementById('note-modal').classList.remove('hidden');
        document.getElementById('note-text').focus();
    }

    closeModal() {
        document.getElementById('note-modal').classList.add('hidden');
        this.editingNote = null;
        
        // 폼 초기화
        document.getElementById('note-text').value = '';
        document.getElementById('note-color').value = '#ffeb3b';
    }

    async saveNote() {
        if (!this.editingNote) return;
        
        const content = document.getElementById('note-text').value.trim();
        if (!content) return;
        
        this.editingNote.content = content;
        this.editingNote.color = document.getElementById('note-color').value;
        this.editingNote.updatedAt = new Date().toISOString();
        
        try {
            const response = await fetch('/api/notes', {
                method: this.editingNote.id ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(this.editingNote)
            });
            
            if (response.ok) {
                this.closeModal();
            } else {
                console.error('Failed to save note');
            }
        } catch (error) {
            console.error('Error saving note:', error);
        }
    }

    async deleteNote() {
        if (!this.editingNote || !this.editingNote.id) return;
        
        if (confirm('정말로 이 노트를 삭제하시겠습니까?')) {
            try {
                const response = await fetch(`/api/notes/${this.editingNote.id}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    this.closeModal();
                } else {
                    console.error('Failed to delete note');
                }
            } catch (error) {
                console.error('Error deleting note:', error);
            }
        }
    }

    render() {
        // 캔버스 클리어
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 변환 매트릭스 설정
        this.ctx.save();
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(this.offsetX / this.zoom, this.offsetY / this.zoom);
        
        // 스티키 노트 렌더링
        for (const note of this.notes.values()) {
            this.renderNote(note);
        }
        
        this.ctx.restore();
    }

    renderNote(note) {
        const width = 200;
        const height = 200;
        
        // 그림자
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.ctx.fillRect(note.x + 5, note.y + 5, width, height);
        
        // 노트 배경
        this.ctx.fillStyle = note.color || '#ffeb3b';
        this.ctx.fillRect(note.x, note.y, width, height);
        
        // 노트 테이프 부분
        this.ctx.fillStyle = this.adjustColor(note.color || '#ffeb3b', -20);
        this.ctx.fillRect(note.x, note.y, width, 20);
        
        // 텍스트 렌더링
        this.ctx.fillStyle = '#333';
        this.ctx.font = '14px Kalam, cursive';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const lines = this.wrapText(note.content, width - 20);
        let lineHeight = 20;
        
        lines.forEach((line, index) => {
            if (index * lineHeight + 30 < height - 30) {
                this.ctx.fillText(line, note.x + 10, note.y + 30 + index * lineHeight);
            }
        });
        
        // 작성자
        this.ctx.fillStyle = 'rgba(51, 51, 51, 0.7)';
        this.ctx.font = '10px Kalam, cursive';
        this.ctx.textAlign = 'right';
        this.ctx.fillText(note.author, note.x + width - 10, note.y + height - 15);
        
        // 클릭 감지를 위한 경계 표시 (보이지 않음)
        this.ctx.strokeStyle = 'transparent';
        this.ctx.strokeRect(note.x, note.y, width, height);
    }

    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = this.ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }

    adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    getNoteAtPosition(x, y) {
        const adjustedX = (x - this.offsetX) / this.zoom;
        const adjustedY = (y - this.offsetY) / this.zoom;
        
        for (const note of this.notes.values()) {
            if (adjustedX >= note.x && adjustedX <= note.x + 200 &&
                adjustedY >= note.y && adjustedY <= note.y + 200) {
                return note;
            }
        }
        return null;
    }
}

// URL에서 인증 콜백 처리
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth') === 'success') {
    // URL 정리
    window.history.replaceState({}, document.title, window.location.pathname);
}

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
    new StickyNotesApp();
}); 