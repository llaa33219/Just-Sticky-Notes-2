// Cloudflare Pages _worker.js
// WebSocket 지원 및 R2 연동 실시간 스티키 노트

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
            
            console.log(`[Pages] 요청: ${request.method} ${url.pathname}`);
            
            // CORS preflight 처리
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 200,
                    headers: CORS_HEADERS
                });
            }
            
            // WebSocket 업그레이드 요청 처리
            if (url.pathname === '/ws' || url.pathname === '/websocket') {
                console.log('[Pages] WebSocket 연결 시도');
                return handleWebSocketUpgrade(request, env);
            }
            
            // API 라우팅
            if (url.pathname.startsWith('/api/')) {
                return handleAPI(request, env, url);
            }
            
            // 정적 파일들 (Pages 방식)
            return env.ASSETS.fetch(request);
            
        } catch (error) {
            console.error('[Pages] Worker 최상위 오류:', error);
            return new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                stack: error.stack
            }), { 
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...CORS_HEADERS
                }
            });
        }
    }
};

// WebSocket 업그레이드 처리
async function handleWebSocketUpgrade(request, env) {
    try {
        const upgradeHeader = request.headers.get('Upgrade');
        console.log('[WebSocket] Upgrade 헤더:', upgradeHeader);
        
        if (!upgradeHeader || upgradeHeader !== 'websocket') {
            console.log('[WebSocket] WebSocket 업그레이드 헤더가 없음');
            return new Response('Expected Upgrade: websocket', { 
                status: 426,
                headers: CORS_HEADERS
            });
        }
        
        console.log('[WebSocket] WebSocketPair 생성 중...');
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        
        console.log('[WebSocket] 서버 WebSocket accept...');
        server.accept();
        
        // 연결 처리
        handleWebSocketConnection(server, env);
        
        console.log('[WebSocket] 업그레이드 완료');
        return new Response(null, {
            status: 101,
            webSocket: client,
        });
        
    } catch (error) {
        console.error('[WebSocket] 업그레이드 오류:', error);
        return new Response(JSON.stringify({
            error: 'WebSocket Error',
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

// WebSocket 연결 처리
function handleWebSocketConnection(websocket, env) {
    const clientId = generateClientId();
    console.log('[WebSocket] 새 클라이언트 연결:', clientId);
    
    // 클라이언트 등록
    connectedClients.set(clientId, {
        websocket: websocket,
        user: null,
        lastSeen: Date.now(),
        connected: true
    });
    
    console.log('[WebSocket] 현재 연결된 클라이언트 수:', connectedClients.size);
    
    websocket.addEventListener('message', async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[WebSocket] 메시지 수신:', data.type || data.t, 'from', clientId);
            
            // 클라이언트 상태 업데이트
            const client = connectedClients.get(clientId);
            if (client) {
                client.lastSeen = Date.now();
            }
            
            await handleWebSocketMessage(clientId, data, env);
            
        } catch (error) {
            console.error('[WebSocket] 메시지 처리 오류:', error);
            sendMessageSafely(clientId, {
                type: 'error',
                message: '메시지 처리 중 오류가 발생했습니다.',
                error: error.message
            });
        }
    });
    
    websocket.addEventListener('close', (event) => {
        console.log('[WebSocket] 클라이언트 연결 종료:', clientId, 'code:', event.code);
        
        const client = connectedClients.get(clientId);
        if (client) {
            client.connected = false;
            if (client.user) {
                // 사용자 퇴장 알림
                setTimeout(() => {
                    broadcastMessage({
                        type: 'user_left',
                        user: client.user
                    }, clientId);
                }, 100);
            }
        }
        
        connectedClients.delete(clientId);
        console.log('[WebSocket] 남은 클라이언트 수:', connectedClients.size);
    });
    
    websocket.addEventListener('error', (error) => {
        console.error('[WebSocket] 연결 오류:', clientId, error);
        const client = connectedClients.get(clientId);
        if (client) {
            client.connected = false;
        }
        connectedClients.delete(clientId);
    });
    
    // 연결 성공 알림
    setTimeout(() => {
        sendMessageSafely(clientId, {
            type: 'connection_established',
            clientId: clientId,
            timestamp: Date.now()
        });
    }, 100);
}

// WebSocket 메시지 처리
async function handleWebSocketMessage(clientId, data, env) {
    const client = connectedClients.get(clientId);
    if (!client || !client.connected) {
        console.log('[WebSocket] 클라이언트를 찾을 수 없거나 연결이 끊어짐:', clientId);
        return;
    }
    
    const messageType = data.type || data.t;
    const timestamp = Date.now();
    
    try {
        console.log('[WebSocket] 메시지 처리:', messageType);
        
        switch (messageType) {
            case 'auth':
                console.log('[Auth] 사용자 인증:', data.user);
                client.user = data.user;
                
                // 다른 클라이언트들에게 알림
                broadcastMessage({
                    type: 'user_joined',
                    user: data.user,
                    timestamp: timestamp
                }, clientId);
                
                // 인증 성공 응답
                sendMessageSafely(clientId, {
                    type: 'auth_success',
                    user: data.user,
                    timestamp: timestamp
                });
                break;
                
            case 'load_notes':
                console.log('[Notes] 노트 로드 요청');
                try {
                    const notes = await loadNotesFromR2(env);
                    sendMessageSafely(clientId, {
                        type: 'notes_loaded',
                        notes: notes,
                        count: notes.length,
                        timestamp: timestamp
                    });
                    console.log('[Notes] 노트 로드 완료:', notes.length, '개');
                } catch (error) {
                    console.error('[Notes] 로드 오류:', error);
                    sendMessageSafely(clientId, {
                        type: 'error',
                        message: '노트 로드 실패',
                        error: error.message
                    });
                }
                break;
                
            case 'create_note':
                console.log('[Notes] 노트 생성:', data.note?.id);
                const note = data.note;
                
                if (!note || !note.id) {
                    sendMessageSafely(clientId, {
                        type: 'error',
                        message: '잘못된 노트 데이터'
                    });
                    return;
                }
                
                // 즉시 브로드캐스트 (최우선)
                const createMessage = {
                    type: 'note_created',
                    note: note,
                    timestamp: timestamp,
                    from: client.user?.name || 'Unknown'
                };
                
                broadcastMessage(createMessage);
                console.log('[Notes] 노트 생성 브로드캐스트 완료');
                
                // R2에 저장 (비동기, 실패해도 브로드캐스트는 완료됨)
                saveNoteToR2(env, note).catch(error => {
                    console.error('[R2] 저장 오류 (무시됨):', error.message);
                });
                break;
                
            case 'delete_note':
                console.log('[Notes] 노트 삭제:', data.noteId);
                
                if (!data.noteId) {
                    sendMessageSafely(clientId, {
                        type: 'error',
                        message: '노트 ID가 없습니다'
                    });
                    return;
                }
                
                // 즉시 브로드캐스트
                const deleteMessage = {
                    type: 'note_deleted',
                    noteId: data.noteId,
                    timestamp: timestamp,
                    from: client.user?.name || 'Unknown'
                };
                
                broadcastMessage(deleteMessage);
                console.log('[Notes] 노트 삭제 브로드캐스트 완료');
                
                // R2에서 삭제 (비동기)
                deleteNoteFromR2(env, data.noteId).catch(error => {
                    console.error('[R2] 삭제 오류 (무시됨):', error.message);
                });
                break;
                
            case 'update_note':
            case 'u':
                const noteId = data.noteId || data.id;
                const x = data.x;
                const y = data.y;
                const updateTimestamp = data.timestamp || data.ts || timestamp;
                
                if (!noteId || x === undefined || y === undefined) {
                    console.log('[Notes] 잘못된 업데이트 데이터:', { noteId, x, y });
                    return;
                }
                
                // 즉시 브로드캐스트
                const updateMessage = {
                    type: 'note_updated',
                    noteId: noteId,
                    x: x,
                    y: y,
                    timestamp: updateTimestamp,
                    from: client.user?.name || 'Unknown'
                };
                
                broadcastMessage(updateMessage, clientId);
                
                // R2 업데이트 (비동기)
                updateNoteInR2(env, noteId, x, y).catch(error => {
                    console.error('[R2] 업데이트 오류 (무시됨):', error.message);
                });
                break;
                
            case 'ping':
                sendMessageSafely(clientId, {
                    type: 'pong',
                    timestamp: data.timestamp || timestamp
                });
                break;
                
            default:
                console.log('[WebSocket] 알 수 없는 메시지 타입:', messageType);
                sendMessageSafely(clientId, {
                    type: 'error',
                    message: '알 수 없는 메시지 타입: ' + messageType
                });
        }
        
    } catch (error) {
        console.error('[WebSocket] 메시지 처리 중 오류:', error);
        sendMessageSafely(clientId, {
            type: 'error',
            message: '요청 처리 중 오류가 발생했습니다.',
            error: error.message
        });
    }
}

// 안전한 메시지 전송
function sendMessageSafely(clientId, message) {
    try {
        const client = connectedClients.get(clientId);
        if (!client || !client.connected || !client.websocket) {
            console.log('[Send] 클라이언트 없음:', clientId);
            return false;
        }
        
        if (client.websocket.readyState !== 1) {
            console.log('[Send] WebSocket 상태 이상:', client.websocket.readyState);
            client.connected = false;
            connectedClients.delete(clientId);
            return false;
        }
        
        const messageStr = JSON.stringify(message);
        client.websocket.send(messageStr);
        return true;
        
    } catch (error) {
        console.error('[Send] 메시지 전송 오류:', error);
        connectedClients.delete(clientId);
        return false;
    }
}

// 모든 클라이언트에게 브로드캐스트
function broadcastMessage(message, excludeClientId = null) {
    const activeClients = Array.from(connectedClients.entries()).filter(([id, client]) => 
        client.connected && client.websocket && client.websocket.readyState === 1
    );
    
    console.log('[Broadcast] 메시지 전송:', message.type, '대상:', activeClients.length, '개 클라이언트');
    
    if (activeClients.length === 0) {
        console.log('[Broadcast] 활성 클라이언트가 없음');
        return;
    }
    
    const messageStr = JSON.stringify(message);
    const deadClients = [];
    let successCount = 0;
    
    for (const [clientId, client] of activeClients) {
        if (clientId === excludeClientId) continue;
        
        try {
            if (client.websocket.readyState === 1) {
                client.websocket.send(messageStr);
                successCount++;
            } else {
                deadClients.push(clientId);
            }
        } catch (error) {
            console.error('[Broadcast] 개별 전송 오류:', clientId, error.message);
            deadClients.push(clientId);
        }
    }
    
    // 죽은 클라이언트들 정리
    deadClients.forEach(clientId => {
        console.log('[Broadcast] 죽은 클라이언트 제거:', clientId);
        connectedClients.delete(clientId);
    });
    
    console.log('[Broadcast] 전송 완료:', successCount, '성공,', deadClients.length, '실패');
}

// API 요청 처리
async function handleAPI(request, env, url) {
    try {
        const path = url.pathname.replace('/api', '');
        console.log('[API] 요청:', path);
        
        switch (path) {
            case '/notes':
                if (request.method === 'GET') {
                    const notes = await loadNotesFromR2(env);
                    return new Response(JSON.stringify({
                        success: true,
                        notes: notes,
                        count: notes.length
                    }), {
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
                    platform: 'Cloudflare Pages',
                    connectedClients: connectedClients.size,
                    activeClients: Array.from(connectedClients.values()).filter(c => c.connected).length,
                    version: '2.0.0-pages',
                    r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_configured',
                    environment: {
                        hasR2: !!env.STICKY_NOTES_BUCKET,
                        hasAssets: !!env.ASSETS
                    }
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            case '/debug':
                const clients = Array.from(connectedClients.entries()).map(([id, client]) => ({
                    id,
                    user: client.user?.name || 'Anonymous',
                    connected: client.connected,
                    lastSeen: client.lastSeen,
                    readyState: client.websocket?.readyState
                }));
                
                return new Response(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    totalClients: connectedClients.size,
                    clients: clients,
                    environment: {
                        r2Available: !!env.STICKY_NOTES_BUCKET,
                        assetsAvailable: !!env.ASSETS
                    }
                }, null, 2), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            default:
                return new Response(JSON.stringify({
                    error: 'Not Found',
                    path: path,
                    availableEndpoints: ['/notes', '/health', '/debug']
                }), { 
                    status: 404,
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
        }
        
        return new Response(JSON.stringify({
            error: 'Method not allowed',
            method: request.method,
            path: path
        }), { 
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS
            }
        });
        
    } catch (error) {
        console.error('[API] 처리 오류:', error);
        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
            path: url.pathname
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
            console.warn('[R2] STICKY_NOTES_BUCKET이 설정되지 않음');
            return [];
        }
        
        console.log('[R2] notes.json 로드 시도...');
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        
        if (!notesObject) {
            console.log('[R2] notes.json 파일이 존재하지 않음, 빈 배열 반환');
            return [];
        }
        
        const notesData = await notesObject.text();
        const notes = JSON.parse(notesData);
        console.log(`[R2] ${notes.length}개의 노트 로드 완료`);
        return notes;
        
    } catch (error) {
        console.error('[R2] 노트 로드 오류:', error);
        return [];
    }
}

// R2에 노트 저장
async function saveNoteToR2(env, note) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('[R2] STICKY_NOTES_BUCKET이 설정되지 않음');
            return;
        }
        
        console.log('[R2] 노트 저장 시작:', note.id);
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 새 노트 추가
        existingNotes.push(note);
        
        // 최대 1000개 제한
        if (existingNotes.length > 1000) {
            existingNotes.splice(0, existingNotes.length - 1000);
            console.log('[R2] 노트 개수 제한으로 인한 정리 완료');
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
        
        console.log('[R2] 노트 저장 완료:', note.id);
        
    } catch (error) {
        console.error('[R2] 노트 저장 오류:', error);
        throw error;
    }
}

// R2에서 노트 삭제
async function deleteNoteFromR2(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('[R2] STICKY_NOTES_BUCKET이 설정되지 않음');
            return;
        }
        
        console.log('[R2] 노트 삭제 시작:', noteId);
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        
        // 노트 필터링 (삭제)
        const filteredNotes = existingNotes.filter(note => note.id !== noteId);
        
        if (filteredNotes.length === existingNotes.length) {
            console.log('[R2] 삭제할 노트가 없음:', noteId);
            return;
        }
        
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
        
        console.log('[R2] 노트 삭제 완료:', noteId);
        
    } catch (error) {
        console.error('[R2] 노트 삭제 오류:', error);
        throw error;
    }
}

// R2에서 노트 위치 업데이트
async function updateNoteInR2(env, noteId, x, y) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('[R2] STICKY_NOTES_BUCKET이 설정되지 않음');
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
            
            console.log('[R2] 노트 위치 업데이트 완료:', noteId);
        } else {
            console.warn('[R2] 업데이트할 노트를 찾을 수 없음:', noteId);
        }
        
    } catch (error) {
        console.error('[R2] 노트 업데이트 오류:', error);
        throw error;
    }
}

// 클라이언트 ID 생성
function generateClientId() {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
} 