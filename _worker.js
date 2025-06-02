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
            
            // 디버깅용 로그
            console.log(`요청: ${request.method} ${url.pathname}`);
            
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
            
            // 정적 파일들 - 페이지가 직접 처리하도록 함
            return env.ASSETS.fetch(request);
        } catch (error) {
            console.error('Worker 최상위 오류:', error);
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
    console.log('새 클라이언트 연결:', clientId);
    
    // 클라이언트 등록
    connectedClients.set(clientId, {
        websocket: websocket,
        user: null,
        lastSeen: Date.now()
    });
    
    websocket.addEventListener('message', async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('메시지 수신:', data.type || data.t, 'from', clientId);
            await handleWebSocketMessage(clientId, data, env);
        } catch (error) {
            console.error('WebSocket 메시지 처리 오류:', error);
            sendMessageSafely(clientId, {
                type: 'error',
                message: '메시지 처리 중 오류가 발생했습니다.'
            });
        }
    });
    
    websocket.addEventListener('close', () => {
        console.log('클라이언트 연결 종료:', clientId);
        const client = connectedClients.get(clientId);
        if (client && client.user) {
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
    if (!client) {
        console.log('클라이언트를 찾을 수 없음:', clientId);
        return;
    }
    
    client.lastSeen = Date.now();
    const messageType = data.type || data.t;
    
    try {
        switch (messageType) {
            case 'auth':
                console.log('사용자 인증:', data.user);
                client.user = data.user;
                
                // 다른 클라이언트들에게 알림
                broadcastMessage({
                    type: 'user_joined',
                    user: data.user
                }, clientId);
                
                // 인증 성공 응답
                sendMessageSafely(clientId, {
                    type: 'auth_success',
                    user: data.user,
                    timestamp: Date.now()
                });
                break;
                
            case 'load_notes':
                console.log('노트 로드 요청');
                const notes = await loadNotesFromR2(env);
                sendMessageSafely(clientId, {
                    type: 'notes_load',
                    notes: notes,
                    timestamp: Date.now()
                });
                break;
                
            case 'create_note':
                console.log('노트 생성:', data.note.id);
                const note = data.note;
                
                // 즉시 브로드캐스트
                broadcastMessage({
                    type: 'note_created',
                    note: note,
                    timestamp: Date.now()
                });
                
                // R2에 저장 (비동기, 실패해도 계속 진행)
                saveNoteToR2(env, note).catch(error => {
                    console.error('R2 저장 오류 (무시됨):', error);
                });
                break;
                
            case 'delete_note':
                console.log('노트 삭제:', data.noteId);
                
                // 즉시 브로드캐스트
                broadcastMessage({
                    type: 'note_deleted',
                    noteId: data.noteId,
                    timestamp: Date.now()
                });
                
                // R2에서 삭제 (비동기)
                deleteNoteFromR2(env, data.noteId).catch(error => {
                    console.error('R2 삭제 오류 (무시됨):', error);
                });
                break;
                
            case 'update_note':
            case 'u':
                const noteId = data.noteId || data.id;
                const x = data.x;
                const y = data.y;
                const timestamp = data.timestamp || data.ts || Date.now();
                
                // 즉시 브로드캐스트
                broadcastMessage({
                    type: 'note_updated',
                    noteId: noteId,
                    x: x,
                    y: y,
                    timestamp: timestamp
                }, clientId);
                
                // R2 업데이트 (비동기)
                updateNoteInR2(env, noteId, x, y).catch(error => {
                    console.error('R2 업데이트 오류 (무시됨):', error);
                });
                break;
                
            case 'ping':
                sendMessageSafely(clientId, {
                    type: 'pong',
                    timestamp: data.timestamp || Date.now()
                });
                break;
                
            default:
                console.log('알 수 없는 메시지 타입:', messageType);
        }
    } catch (error) {
        console.error('메시지 처리 중 오류:', error);
        sendMessageSafely(clientId, {
            type: 'error',
            message: '요청 처리 중 오류가 발생했습니다.'
        });
    }
}

// 안전한 메시지 전송
function sendMessageSafely(clientId, message) {
    try {
        const client = connectedClients.get(clientId);
        if (client && client.websocket && client.websocket.readyState === 1) {
            client.websocket.send(JSON.stringify(message));
            return true;
        }
        return false;
    } catch (error) {
        console.error('메시지 전송 오류:', error);
        connectedClients.delete(clientId);
        return false;
    }
}

// 모든 클라이언트에게 브로드캐스트
function broadcastMessage(message, excludeClientId = null) {
    console.log('브로드캐스트:', message.type, '클라이언트 수:', connectedClients.size);
    
    const messageStr = JSON.stringify(message);
    const deadClients = [];
    
    for (const [clientId, client] of connectedClients) {
        if (clientId !== excludeClientId) {
            try {
                if (client.websocket && client.websocket.readyState === 1) {
                    client.websocket.send(messageStr);
                } else {
                    deadClients.push(clientId);
                }
            } catch (error) {
                console.error('브로드캐스트 개별 전송 오류:', error);
                deadClients.push(clientId);
            }
        }
    }
    
    // 죽은 클라이언트들 정리
    deadClients.forEach(clientId => {
        connectedClients.delete(clientId);
    });
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
                    version: '2.0.0-simplified',
                    r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found'
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
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return [];
        }
        
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        if (!notesObject) {
            console.log('notes.json 파일이 존재하지 않음');
            return [];
        }
        
        const notesData = await notesObject.text();
        const notes = JSON.parse(notesData);
        console.log(`R2에서 ${notes.length}개의 노트 로드됨`);
        return notes;
    } catch (error) {
        console.error('R2에서 노트 로드 오류:', error);
        return [];
    }
}

// R2에 노트 저장
async function saveNoteToR2(env, note) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return;
        }
        
        console.log('R2에 노트 저장:', note.id);
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 새 노트 추가
        existingNotes.push(note);
        
        // 최대 1000개 제한
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
        
        console.log('노트 저장 완료:', note.id);
        
    } catch (error) {
        console.error('R2에 노트 저장 오류:', error);
        throw error;
    }
}

// R2에서 노트 삭제
async function deleteNoteFromR2(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return;
        }
        
        console.log('R2에서 노트 삭제:', noteId);
        
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
        
        console.log('노트 삭제 완료:', noteId);
        
    } catch (error) {
        console.error('R2에서 노트 삭제 오류:', error);
        throw error;
    }
}

// R2에서 노트 위치 업데이트
async function updateNoteInR2(env, noteId, x, y) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return;
        }
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 해당 노트 찾아서 위치 업데이트
        const noteIndex = existingNotes.findIndex(note => note.id === noteId);
        if (noteIndex !== -1) {
            existingNotes[noteIndex].x = x;
            existingNotes[noteIndex].y = y;
            existingNotes[noteIndex].lastUpdated = Date.now();
            
            // R2에 업데이트된 목록 저장
            await env.STICKY_NOTES_BUCKET.put(
                'notes.json',
                JSON.stringify(existingNotes),
                {
                    httpMetadata: {
                        contentType: 'application/json',
                    },
                }
            );
            
            console.log('노트 위치 업데이트 완료:', noteId);
        } else {
            console.warn('업데이트할 노트를 찾을 수 없음:', noteId);
        }
        
    } catch (error) {
        console.error('R2에서 노트 업데이트 오류:', error);
        throw error;
    }
}

// 클라이언트 ID 생성
function generateClientId() {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
} 