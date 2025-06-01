// Cloudflare Worker for Just Sticky Notes
// WebSocket 지원 및 R2 연동 실시간 커뮤니티 사이트

// 전역 변수 및 설정
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 연결된 WebSocket 클라이언트들을 저장할 Map
let connectedClients = new Map();

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            
            // CORS preflight 처리
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 200,
                    headers: CORS_HEADERS
                });
            }
            
            // WebSocket 업그레이드 요청 처리
            if (url.pathname === '/ws') {
                return handleWebSocketUpgrade(request, env);
            }
            
            // API 라우팅
            if (url.pathname.startsWith('/api/')) {
                return handleAPI(request, env, url);
            }
            
            // 정적 파일 서빙 (HTML, CSS, JS)
            return handleStaticFiles(request, env, url);
        } catch (error) {
            console.error('Worker 오류:', error);
            return new Response('Internal Server Error: ' + error.message, { 
                status: 500,
                headers: CORS_HEADERS
            });
        }
    }
};

// WebSocket 업그레이드 처리
async function handleWebSocketUpgrade(request, env) {
    try {
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }
        
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        
        // WebSocket 이벤트 처리
        server.accept();
        handleWebSocketConnection(server, env);
        
        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    } catch (error) {
        console.error('WebSocket 업그레이드 오류:', error);
        return new Response('WebSocket Error: ' + error.message, { 
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// WebSocket 연결 처리
function handleWebSocketConnection(websocket, env) {
    const clientId = generateClientId();
    
    // 클라이언트 등록
    connectedClients.set(clientId, {
        websocket: websocket,
        user: null,
        lastSeen: Date.now()
    });
    
    websocket.addEventListener('message', async (event) => {
        try {
            const data = JSON.parse(event.data);
            await handleWebSocketMessage(clientId, data, env);
        } catch (error) {
            console.error('WebSocket 메시지 처리 오류:', error);
            try {
                websocket.send(JSON.stringify({
                    type: 'error',
                    message: '메시지 처리 중 오류가 발생했습니다.'
                }));
            } catch (sendError) {
                console.error('에러 메시지 전송 실패:', sendError);
            }
        }
    });
    
    websocket.addEventListener('close', () => {
        try {
            const client = connectedClients.get(clientId);
            if (client && client.user) {
                // 다른 클라이언트들에게 사용자 퇴장 알림
                broadcastMessage({
                    type: 'user_left',
                    user: client.user
                }, clientId);
            }
            connectedClients.delete(clientId);
        } catch (error) {
            console.error('WebSocket 종료 처리 오류:', error);
        }
    });
    
    websocket.addEventListener('error', (error) => {
        console.error('WebSocket 오류:', error);
        connectedClients.delete(clientId);
    });
}

// WebSocket 메시지 처리
async function handleWebSocketMessage(clientId, data, env) {
    const client = connectedClients.get(clientId);
    if (!client) return;
    
    try {
        switch (data.type) {
            case 'auth':
                // 사용자 인증
                client.user = data.user;
                client.lastSeen = Date.now();
                
                // 다른 클라이언트들에게 새 사용자 접속 알림
                broadcastMessage({
                    type: 'user_joined',
                    user: data.user
                }, clientId);
                
                // 인증 성공 응답
                client.websocket.send(JSON.stringify({
                    type: 'auth_success',
                    user: data.user
                }));
                break;
                
            case 'load_notes':
                // 기존 스티키 노트들 로드
                const notes = await loadNotesFromR2(env);
                client.websocket.send(JSON.stringify({
                    type: 'notes_load',
                    notes: notes
                }));
                break;
                
            case 'create_note':
                // 새 스티키 노트 생성
                const note = data.note;
                
                // R2에 노트 저장
                await saveNoteToR2(env, note);
                
                // 모든 클라이언트에게 새 노트 알림
                broadcastMessage({
                    type: 'note_created',
                    note: note
                });
                break;
                
            case 'delete_note':
                // 스티키 노트 삭제 (추가 기능)
                await deleteNoteFromR2(env, data.noteId);
                broadcastMessage({
                    type: 'note_deleted',
                    noteId: data.noteId
                });
                break;
                
            case 'ping':
                // 연결 상태 확인
                client.lastSeen = Date.now();
                client.websocket.send(JSON.stringify({
                    type: 'pong'
                }));
                
                // 이 시점에서 비활성 클라이언트 정리
                cleanupInactiveClients();
                break;
                
            default:
                console.log('알 수 없는 메시지 타입:', data.type);
        }
    } catch (error) {
        console.error('메시지 처리 중 오류:', error);
        // 에러 발생 시 클라이언트에게 알림
        try {
            client.websocket.send(JSON.stringify({
                type: 'error',
                message: '요청 처리 중 오류가 발생했습니다.'
            }));
        } catch (sendError) {
            console.error('에러 알림 전송 실패:', sendError);
        }
    }
}

// 비활성 클라이언트 정리 함수
function cleanupInactiveClients() {
    try {
        const now = Date.now();
        const inactiveThreshold = 30 * 60 * 1000; // 30분
        
        for (const [clientId, client] of connectedClients) {
            if (now - client.lastSeen > inactiveThreshold) {
                try {
                    if (client.websocket && client.websocket.readyState === WebSocket.READY_STATE_OPEN) {
                        client.websocket.close();
                    }
                } catch (error) {
                    console.error('클라이언트 정리 오류:', error);
                }
                connectedClients.delete(clientId);
            }
        }
    } catch (error) {
        console.error('클라이언트 정리 중 오류:', error);
    }
}

// 모든 클라이언트에게 메시지 브로드캐스트
function broadcastMessage(message, excludeClientId = null) {
    try {
        const messageStr = JSON.stringify(message);
        
        for (const [clientId, client] of connectedClients) {
            if (clientId !== excludeClientId) {
                try {
                    // WebSocket 상태 확인을 더 안전하게
                    if (client.websocket && client.websocket.readyState === 1) { // OPEN
                        client.websocket.send(messageStr);
                    }
                } catch (error) {
                    console.error('브로드캐스트 오류:', error);
                    connectedClients.delete(clientId);
                }
            }
        }
    } catch (error) {
        console.error('브로드캐스트 전체 오류:', error);
    }
}

// API 요청 처리
async function handleAPI(request, env, url) {
    try {
        const path = url.pathname.replace('/api', '');
        
        switch (path) {
            case '/notes':
                if (request.method === 'GET') {
                    const notes = await loadNotesFromR2(env);
                    return new Response(JSON.stringify(notes), {
                        headers: {
                            'Content-Type': 'application/json',
                            ...CORS_HEADERS
                        }
                    });
                }
                break;
                
            case '/health':
                return new Response(JSON.stringify({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    connectedClients: connectedClients.size,
                    version: '1.0.0'
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            default:
                return new Response(JSON.stringify({
                    error: 'Not Found',
                    path: path
                }), { 
                    status: 404,
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
        }
        
        return new Response(JSON.stringify({
            error: 'Method not allowed'
        }), { 
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS
            }
        });
        
    } catch (error) {
        console.error('API 처리 오류:', error);
        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message
        }), { 
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS
            }
        });
    }
}

// R2에서 노트 로드
async function loadNotesFromR2(env) {
    try {
        // R2 버킷이 없는 경우 빈 배열 반환
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('R2 버킷이 설정되지 않음');
            return [];
        }
        
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        if (!notesObject) {
            return [];
        }
        
        const notesData = await notesObject.text();
        return JSON.parse(notesData);
    } catch (error) {
        console.error('R2에서 노트 로드 오류:', error);
        return [];
    }
}

// R2에 노트 저장
async function saveNoteToR2(env, note) {
    try {
        // R2 버킷이 없는 경우 에러 발생하지 않고 로그만 출력
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('R2 버킷이 설정되지 않아 노트를 저장할 수 없습니다');
            return;
        }
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 새 노트 추가
        existingNotes.push(note);
        
        // 최대 노트 수 제한 (1000개)
        if (existingNotes.length > 1000) {
            existingNotes.splice(0, existingNotes.length - 1000);
        }
        
        // R2에 저장
        await env.STICKY_NOTES_BUCKET.put(
            'notes.json',
            JSON.stringify(existingNotes),
            {
                httpMetadata: {
                    contentType: 'application/json',
                },
            }
        );
        
        // 개별 노트 백업 저장 (복구용)
        await env.STICKY_NOTES_BUCKET.put(
            `notes/${note.id}.json`,
            JSON.stringify(note),
            {
                httpMetadata: {
                    contentType: 'application/json',
                },
            }
        );
        
    } catch (error) {
        console.error('R2에 노트 저장 오류:', error);
        // 에러가 발생해도 앱이 멈추지 않도록 처리
    }
}

// R2에서 노트 삭제
async function deleteNoteFromR2(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('R2 버킷이 설정되지 않아 노트를 삭제할 수 없습니다');
            return;
        }
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 노트 필터링 (삭제)
        const filteredNotes = existingNotes.filter(note => note.id !== noteId);
        
        // R2에 업데이트된 목록 저장
        await env.STICKY_NOTES_BUCKET.put(
            'notes.json',
            JSON.stringify(filteredNotes),
            {
                httpMetadata: {
                    contentType: 'application/json',
                },
            }
        );
        
        // 개별 노트 파일도 삭제
        await env.STICKY_NOTES_BUCKET.delete(`notes/${noteId}.json`);
        
    } catch (error) {
        console.error('R2에서 노트 삭제 오류:', error);
    }
}

// 정적 파일 서빙
async function handleStaticFiles(request, env, url) {
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    
    try {
        // R2에서 정적 파일 로드 시도 (R2 버킷이 있는 경우에만)
        if (env.STICKY_NOTES_BUCKET) {
            try {
                const object = await env.STICKY_NOTES_BUCKET.get(`static${pathname}`);
                
                if (object) {
                    const contentType = getContentType(pathname);
                    return new Response(object.body, {
                        headers: {
                            'Content-Type': contentType,
                            'Cache-Control': 'public, max-age=3600',
                            ...CORS_HEADERS
                        }
                    });
                }
            } catch (r2Error) {
                console.warn('R2에서 파일 로드 실패:', r2Error.message);
                // R2 오류 시 기본 HTML로 fallback
            }
        }
        
        // 기본 응답 (개발용 또는 R2 설정 전)
        if (pathname === '/index.html' || pathname === '/') {
            return new Response(getDefaultHTML(), {
                headers: {
                    'Content-Type': 'text/html',
                    ...CORS_HEADERS
                }
            });
        }
        
        // CSS 파일 요청 시 기본 CSS 반환
        if (pathname === '/styles.css') {
            return new Response(getDefaultCSS(), {
                headers: {
                    'Content-Type': 'text/css',
                    ...CORS_HEADERS
                }
            });
        }
        
        // JS 파일 요청 시 기본 JS 반환
        if (pathname === '/app.js') {
            return new Response(getDefaultJS(), {
                headers: {
                    'Content-Type': 'application/javascript',
                    ...CORS_HEADERS
                }
            });
        }
        
        return new Response('File not found: ' + pathname, { 
            status: 404,
            headers: CORS_HEADERS
        });
        
    } catch (error) {
        console.error('정적 파일 서빙 오류:', error);
        return new Response('Static file error: ' + error.message, { 
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// Content-Type 결정
function getContentType(pathname) {
    const ext = pathname.split('.').pop().toLowerCase();
    const contentTypes = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon'
    };
    return contentTypes[ext] || 'text/plain';
}

// 클라이언트 ID 생성
function generateClientId() {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 기본 HTML (개발용)
function getDefaultHTML() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Just Sticky Notes</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Kalam:wght@300;400;700&display=swap" rel="stylesheet">
</head>
<body>
    <div class="container">
        <h1>🗒️ Just Sticky Notes</h1>
        <p>실시간 스티키 노트 커뮤니티에 오신 것을 환영합니다!</p>
        <div class="note">
            <p>Worker가 성공적으로 실행되고 있습니다!</p>
            <p>R2 버킷을 설정하고 정적 파일을 업로드하면 완전한 앱을 사용할 수 있습니다.</p>
        </div>
        <p style="margin-top: 2rem; font-size: 0.9rem; opacity: 0.8;">
            Cloudflare Workers + R2 + WebSocket
        </p>
    </div>
    <script src="app.js"></script>
</body>
</html>`;
}

// 기본 CSS (Fallback용)
function getDefaultCSS() {
    return `
        body {
            font-family: 'Kalam', cursive, Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            color: white;
            padding: 2rem;
            border-radius: 15px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
        }
        h1 { margin-bottom: 1rem; }
        p { margin-bottom: 2rem; }
        .note {
            background: #FFEB3B;
            padding: 1rem;
            border-radius: 5px;
            color: #333;
            display: inline-block;
            transform: rotate(-2deg);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            font-family: 'Caveat', cursive;
            font-size: 18px;
            max-width: 300px;
        }
    `;
}

// 기본 JS (Fallback용)
function getDefaultJS() {
    return `
        console.log('Just Sticky Notes - Basic mode');
        console.log('R2 버킷을 설정하고 정적 파일을 업로드하면 완전한 기능을 사용할 수 있습니다.');
        
        // 기본적인 WebSocket 연결 테스트
        try {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + location.host + '/ws';
            const ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket 연결 성공!');
            };
            
            ws.onerror = (error) => {
                console.log('WebSocket 연결 실패:', error);
            };
        } catch (error) {
            console.log('WebSocket 테스트 오류:', error);
        }
    `;
} 