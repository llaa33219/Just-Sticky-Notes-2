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
    }
};

// WebSocket 업그레이드 처리
async function handleWebSocketUpgrade(request, env) {
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
}

// WebSocket 연결 처리
function handleWebSocketConnection(websocket, env) {
    const clientId = generateClientId();
    let userInfo = null;
    
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
            websocket.send(JSON.stringify({
                type: 'error',
                message: '메시지 처리 중 오류가 발생했습니다.'
            }));
        }
    });
    
    websocket.addEventListener('close', () => {
        const client = connectedClients.get(clientId);
        if (client && client.user) {
            // 다른 클라이언트들에게 사용자 퇴장 알림
            broadcastMessage({
                type: 'user_left',
                user: client.user
            }, clientId);
        }
        connectedClients.delete(clientId);
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
            break;
            
        default:
            console.log('알 수 없는 메시지 타입:', data.type);
    }
}

// 모든 클라이언트에게 메시지 브로드캐스트
function broadcastMessage(message, excludeClientId = null) {
    const messageStr = JSON.stringify(message);
    
    for (const [clientId, client] of connectedClients) {
        if (clientId !== excludeClientId && client.websocket.readyState === WebSocket.READY_STATE_OPEN) {
            try {
                client.websocket.send(messageStr);
            } catch (error) {
                console.error('브로드캐스트 오류:', error);
                connectedClients.delete(clientId);
            }
        }
    }
}

// API 요청 처리
async function handleAPI(request, env, url) {
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
                connectedClients: connectedClients.size
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    ...CORS_HEADERS
                }
            });
            
        default:
            return new Response('Not Found', { 
                status: 404,
                headers: CORS_HEADERS
            });
    }
}

// R2에서 노트 로드
async function loadNotesFromR2(env) {
    try {
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
        throw error;
    }
}

// R2에서 노트 삭제
async function deleteNoteFromR2(env, noteId) {
    try {
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
        throw error;
    }
}

// 정적 파일 서빙
async function handleStaticFiles(request, env, url) {
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    
    try {
        // R2에서 정적 파일 로드 시도
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
        
        // 기본 응답 (개발용)
        if (pathname === '/index.html' || pathname === '/') {
            return new Response(getDefaultHTML(), {
                headers: {
                    'Content-Type': 'text/html',
                    ...CORS_HEADERS
                }
            });
        }
        
        return new Response('File not found', { 
            status: 404,
            headers: CORS_HEADERS
        });
        
    } catch (error) {
        console.error('정적 파일 서빙 오류:', error);
        return new Response('Internal Server Error', { 
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
    <style>
        body {
            font-family: Arial, sans-serif;
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
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🗒️ Just Sticky Notes</h1>
        <p>실시간 스티키 노트 커뮤니티에 오신 것을 환영합니다!</p>
        <div class="note">
            <p>Worker가 성공적으로 실행되고 있습니다!</p>
            <p>실제 앱을 보려면 정적 파일을 업로드해주세요.</p>
        </div>
        <p style="margin-top: 2rem; font-size: 0.9rem; opacity: 0.8;">
            Cloudflare Workers + R2 + WebSocket
        </p>
    </div>
</body>
</html>`;
}

// 연결 정리 (선택적 - 메모리 관리)
setInterval(() => {
    const now = Date.now();
    for (const [clientId, client] of connectedClients) {
        // 30분 이상 비활성 클라이언트 제거
        if (now - client.lastSeen > 30 * 60 * 1000) {
            try {
                client.websocket.close();
            } catch (error) {
                console.error('클라이언트 정리 오류:', error);
            }
            connectedClients.delete(clientId);
        }
    }
}, 5 * 60 * 1000); // 5분마다 실행 