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

// 성능 최적화를 위한 설정
const BATCH_SIZE = 50; // R2 배치 처리 크기
const DEBOUNCE_TIME = 100; // 위치 업데이트 디바운싱 시간 (ms)
const MAX_QUEUE_SIZE = 1000; // 최대 큐 크기

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
    
    // 클라이언트 등록
    connectedClients.set(clientId, {
        websocket: websocket,
        user: null,
        lastSeen: Date.now(),
        isAlive: true
    });
    
    // 연결 즉시 핑 설정 (30초마다)
    const pingInterval = setInterval(() => {
        try {
            if (websocket.readyState === 1) {
                websocket.ping();
            } else {
                clearInterval(pingInterval);
                connectedClients.delete(clientId);
            }
        } catch (error) {
            clearInterval(pingInterval);
            connectedClients.delete(clientId);
        }
    }, 30000);
    
    websocket.addEventListener('message', async (event) => {
        try {
            const client = connectedClients.get(clientId);
            if (!client) return;
            
            client.lastSeen = Date.now();
            client.isAlive = true;
            
            const data = JSON.parse(event.data);
            await handleWebSocketMessageOptimized(clientId, data, env);
        } catch (error) {
            console.error('WebSocket 메시지 처리 오류:', error);
            safelySendMessage(clientId, {
                type: 'error',
                message: '메시지 처리 중 오류가 발생했습니다.'
            });
        }
    });
    
    websocket.addEventListener('close', () => {
        try {
            clearInterval(pingInterval);
            const client = connectedClients.get(clientId);
            if (client && client.user) {
                // 즉시 브로드캐스트 (논블로킹)
                setImmediate(() => {
                    broadcastMessageInstant({
                        type: 'user_left',
                        user: client.user
                    }, clientId);
                });
            }
            connectedClients.delete(clientId);
        } catch (error) {
            console.error('WebSocket 종료 처리 오류:', error);
        }
    });
    
    websocket.addEventListener('error', (error) => {
        console.error('WebSocket 오류:', error);
        clearInterval(pingInterval);
        connectedClients.delete(clientId);
    });
    
    websocket.addEventListener('pong', () => {
        const client = connectedClients.get(clientId);
        if (client) {
            client.isAlive = true;
            client.lastSeen = Date.now();
        }
    });
}

// 최적화된 WebSocket 메시지 처리
async function handleWebSocketMessageOptimized(clientId, data, env) {
    const client = connectedClients.get(clientId);
    if (!client) return;
    
    const messageType = data.type || data.t;
    const timestamp = Date.now();
    
    try {
        switch (messageType) {
            case 'auth':
                // 사용자 인증 - 즉시 처리
                client.user = data.user;
                
                // 즉시 브로드캐스트
                broadcastMessageInstant({
                    type: 'user_joined',
                    user: data.user
                }, clientId);
                
                // 즉시 응답
                safelySendMessage(clientId, {
                    type: 'auth_success',
                    user: data.user,
                    timestamp: timestamp
                });
                break;
                
            case 'load_notes':
                // 비동기로 노트 로드 (브로드캐스트 차단 안함)
                loadNotesAsync(env, clientId);
                break;
                
            case 'sync_request':
                // 비동기로 동기화 (브로드캐스트 차단 안함)
                syncNotesAsync(env, clientId, data.timestamp);
                break;
                
            case 'create_note':
                // 최고 우선순위: 즉시 브로드캐스트
                const note = data.note;
                note.timestamp = timestamp;
                
                broadcastMessageInstant({
                    type: 'note_created',
                    note: note,
                    timestamp: timestamp
                });
                
                // R2 저장은 배치로 처리
                queueR2OperationBatch({
                    type: 'create',
                    note: note
                });
                break;
                
            case 'delete_note':
                // 즉시 브로드캐스트
                broadcastMessageInstant({
                    type: 'note_deleted',
                    noteId: data.noteId,
                    timestamp: timestamp
                });
                
                // R2 삭제는 배치로 처리
                queueR2OperationBatch({
                    type: 'delete',
                    noteId: data.noteId
                });
                break;
                
            case 'update_note':
            case 'u': // 초고속 위치 업데이트
                const noteId = data.noteId || data.id;
                const x = data.x;
                const y = data.y;
                const msgTimestamp = data.timestamp || data.ts || timestamp;
                const sendingClientId = data.clientId || data.c;
                
                // 초경량 메시지로 즉시 브로드캐스트
                broadcastMessageInstant({
                    t: 'u',
                    id: noteId,
                    x: x,
                    y: y,
                    ts: msgTimestamp,
                    c: sendingClientId
                }, clientId);
                
                // 위치 업데이트는 디바운싱으로 처리
                debouncedUpdateNote(noteId, x, y, env);
                break;
                
            case 'ping':
                // 즉시 응답
                client.lastSeen = timestamp;
                client.isAlive = true;
                safelySendMessage(clientId, {
                    type: 'pong',
                    timestamp: data.timestamp || timestamp
                });
                break;
                
            default:
                console.log('알 수 없는 메시지 타입:', messageType);
        }
    } catch (error) {
        console.error('메시지 처리 중 오류:', error);
        safelySendMessage(clientId, {
            type: 'error',
            message: '요청 처리 중 오류가 발생했습니다.',
            timestamp: timestamp
        });
    }
}

// 안전한 메시지 전송
function safelySendMessage(clientId, message) {
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

// 즉시 브로드캐스트 (절대 블로킹 없음)
function broadcastMessageInstant(message, excludeClientId = null) {
    try {
        const messageStr = JSON.stringify(message);
        const clientsToRemove = [];
        
        // 동기적으로 모든 활성 클라이언트에게 즉시 전송
        for (const [clientId, client] of connectedClients) {
            if (clientId !== excludeClientId) {
                try {
                    if (client.websocket && client.websocket.readyState === 1) {
                        client.websocket.send(messageStr);
                    } else {
                        clientsToRemove.push(clientId);
                    }
                } catch (error) {
                    console.error('브로드캐스트 개별 전송 오류:', error);
                    clientsToRemove.push(clientId);
                }
            }
        }
        
        // 실패한 클라이언트들 제거 (비동기)
        if (clientsToRemove.length > 0) {
            setImmediate(() => {
                clientsToRemove.forEach(clientId => {
                    connectedClients.delete(clientId);
                });
            });
        }
        
    } catch (error) {
        console.error('브로드캐스트 전체 오류:', error);
    }
}

// 비동기 노트 로드
async function loadNotesAsync(env, clientId) {
    try {
        const notes = await loadNotesFromR2(env);
        safelySendMessage(clientId, {
            type: 'notes_load',
            notes: notes,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('비동기 노트 로드 오류:', error);
        safelySendMessage(clientId, {
            type: 'error',
            message: '노트 로드 중 오류가 발생했습니다.'
        });
    }
}

// 비동기 노트 동기화
async function syncNotesAsync(env, clientId, requestTimestamp) {
    try {
        const notes = await loadNotesFromR2(env);
        safelySendMessage(clientId, {
            type: 'sync_response',
            notes: notes,
            timestamp: requestTimestamp
        });
    } catch (error) {
        console.error('비동기 동기화 오류:', error);
        safelySendMessage(clientId, {
            type: 'error',
            message: '동기화 중 오류가 발생했습니다.'
        });
    }
}

// R2 배치 작업 시스템
const r2BatchQueue = [];
const r2DebounceMap = new Map(); // 위치 업데이트 디바운싱용
let isBatchProcessing = false;

function queueR2OperationBatch(operation) {
    if (r2BatchQueue.length < MAX_QUEUE_SIZE) {
        r2BatchQueue.push({
            ...operation,
            timestamp: Date.now()
        });
        
        // 배치 처리 스케줄링
        if (!isBatchProcessing) {
            setImmediate(processBatchOperations);
        }
    } else {
        console.warn('R2 큐가 가득참, 작업 무시됨');
    }
}

// 위치 업데이트 디바운싱
function debouncedUpdateNote(noteId, x, y, env) {
    // 기존 타이머 취소
    if (r2DebounceMap.has(noteId)) {
        clearTimeout(r2DebounceMap.get(noteId));
    }
    
    // 새 타이머 설정
    const timeoutId = setTimeout(() => {
        queueR2OperationBatch({
            type: 'update',
            noteId: noteId,
            x: x,
            y: y
        });
        r2DebounceMap.delete(noteId);
    }, DEBOUNCE_TIME);
    
    r2DebounceMap.set(noteId, timeoutId);
}

// 배치 작업 처리
async function processBatchOperations() {
    if (isBatchProcessing || r2BatchQueue.length === 0) {
        return;
    }
    
    isBatchProcessing = true;
    
    try {
        // 작업을 배치로 그룹화
        const batch = r2BatchQueue.splice(0, BATCH_SIZE);
        const groupedOps = groupOperations(batch);
        
        // 각 그룹을 병렬로 처리
        await Promise.allSettled([
            processCreateOperations(groupedOps.creates),
            processUpdateOperations(groupedOps.updates),
            processDeleteOperations(groupedOps.deletes)
        ]);
        
    } catch (error) {
        console.error('배치 처리 오류:', error);
    } finally {
        isBatchProcessing = false;
        
        // 큐에 남은 작업이 있으면 다시 처리
        if (r2BatchQueue.length > 0) {
            setImmediate(processBatchOperations);
        }
    }
}

// 작업 그룹화
function groupOperations(operations) {
    const grouped = {
        creates: [],
        updates: new Map(), // noteId -> latest update
        deletes: new Set()
    };
    
    for (const op of operations) {
        switch (op.type) {
            case 'create':
                grouped.creates.push(op.note);
                break;
            case 'update':
                // 같은 노트의 최신 업데이트만 유지
                grouped.updates.set(op.noteId, {
                    noteId: op.noteId,
                    x: op.x,
                    y: op.y,
                    timestamp: op.timestamp
                });
                break;
            case 'delete':
                grouped.deletes.add(op.noteId);
                // 업데이트 큐에서도 제거
                grouped.updates.delete(op.noteId);
                break;
        }
    }
    
    return grouped;
}

// 생성 작업 처리
async function processCreateOperations(creates) {
    if (creates.length === 0) return;
    
    try {
        // 현재 노트들과 병합
        const existingNotes = await loadNotesFromR2(globalThis.env || {});
        const allNotes = [...existingNotes, ...creates];
        
        // 크기 제한
        if (allNotes.length > 1000) {
            allNotes.splice(0, allNotes.length - 1000);
        }
        
        await saveNotesToR2(globalThis.env || {}, allNotes);
        
        // 개별 백업도 병렬로 저장
        await Promise.allSettled(
            creates.map(note => saveIndividualNote(globalThis.env || {}, note))
        );
        
    } catch (error) {
        console.error('생성 작업 처리 오류:', error);
    }
}

// 업데이트 작업 처리
async function processUpdateOperations(updates) {
    if (updates.size === 0) return;
    
    try {
        const existingNotes = await loadNotesFromR2(globalThis.env || {});
        let hasChanges = false;
        
        for (const [noteId, updateData] of updates) {
            const noteIndex = existingNotes.findIndex(note => note.id === noteId);
            if (noteIndex !== -1) {
                existingNotes[noteIndex].x = updateData.x;
                existingNotes[noteIndex].y = updateData.y;
                existingNotes[noteIndex].lastUpdated = updateData.timestamp;
                hasChanges = true;
            }
        }
        
        if (hasChanges) {
            await saveNotesToR2(globalThis.env || {}, existingNotes);
        }
        
    } catch (error) {
        console.error('업데이트 작업 처리 오류:', error);
    }
}

// 삭제 작업 처리
async function processDeleteOperations(deletes) {
    if (deletes.size === 0) return;
    
    try {
        const existingNotes = await loadNotesFromR2(globalThis.env || {});
        const filteredNotes = existingNotes.filter(note => !deletes.has(note.id));
        
        if (filteredNotes.length !== existingNotes.length) {
            await saveNotesToR2(globalThis.env || {}, filteredNotes);
            
            // 개별 파일들도 병렬로 삭제
            await Promise.allSettled(
                Array.from(deletes).map(noteId => 
                    deleteIndividualNote(globalThis.env || {}, noteId)
                )
            );
        }
        
    } catch (error) {
        console.error('삭제 작업 처리 오류:', error);
    }
}

// 환경 변수를 전역으로 저장 (배치 처리용)
let globalEnv = null;

// API 요청 처리
async function handleAPI(request, env, url) {
    // 환경 변수 전역 저장
    globalEnv = env;
    
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
                    version: '2.0.0-optimized',
                    r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                    queueSize: r2BatchQueue.length,
                    debounceMapSize: r2DebounceMap.size
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            case '/debug':
                // 디버깅용 엔드포인트
                const debugInfo = {
                    r2BucketStatus: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                    connectedClients: connectedClients.size,
                    timestamp: new Date().toISOString(),
                    performance: {
                        queueSize: r2BatchQueue.length,
                        debounceMapSize: r2DebounceMap.size,
                        batchProcessing: isBatchProcessing
                    }
                };
                
                return new Response(JSON.stringify(debugInfo, null, 2), {
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
            console.log('notes.json 파일이 존재하지 않음, 빈 배열 반환');
            return [];
        }
        
        const notesData = await notesObject.text();
        const notes = JSON.parse(notesData);
        return notes;
    } catch (error) {
        console.error('R2에서 노트 로드 오류:', error);
        return [];
    }
}

// R2에 노트들 저장 (배치용)
async function saveNotesToR2(env, notes) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 저장할 수 없습니다');
            return;
        }
        
        await env.STICKY_NOTES_BUCKET.put(
            'notes.json',
            JSON.stringify(notes),
            {
                httpMetadata: {
                    contentType: 'application/json',
                },
            }
        );
        
    } catch (error) {
        console.error('R2에 노트들 저장 오류:', error);
    }
}

// 개별 노트 저장
async function saveIndividualNote(env, note) {
    try {
        if (!env.STICKY_NOTES_BUCKET) return;
        
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
        console.error('개별 노트 저장 오류:', error);
    }
}

// 개별 노트 삭제
async function deleteIndividualNote(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) return;
        
        await env.STICKY_NOTES_BUCKET.delete(`notes/${noteId}.json`);
        
    } catch (error) {
        console.error('개별 노트 삭제 오류:', error);
    }
}

// 클라이언트 ID 생성
function generateClientId() {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// setImmediate 폴리필 (Cloudflare Workers용)
const setImmediate = globalThis.setImmediate || ((fn) => setTimeout(fn, 0));

// 환경 변수를 전역으로 설정
function setGlobalEnv(env) {
    globalThis.env = env;
}

// WebSocket 연결 처리 시 환경 변수 설정
const originalHandleWebSocketConnection = handleWebSocketConnection;
handleWebSocketConnection = function(websocket, env) {
    setGlobalEnv(env);
    return originalHandleWebSocketConnection(websocket, env);
}; 