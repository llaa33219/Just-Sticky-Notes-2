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

// 성능 최적화를 위한 전역 변수
let lastCleanupTime = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5분마다 정리

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
    const clientInfo = {
        websocket: websocket,
        user: null,
        lastSeen: Date.now(),
        isConnected: true
    };
    connectedClients.set(clientId, clientInfo);
    
    websocket.addEventListener('message', async (event) => {
        try {
            // 클라이언트 활성 상태 업데이트
            const client = connectedClients.get(clientId);
            if (client) {
                client.lastSeen = Date.now();
            }
            
            const data = JSON.parse(event.data);
            await handleWebSocketMessage(clientId, data, env);
        } catch (error) {
            console.error('WebSocket 메시지 처리 오류:', error);
            safeWebSocketSend(websocket, {
                type: 'error',
                message: '메시지 처리 중 오류가 발생했습니다.'
            });
        }
    });
    
    websocket.addEventListener('close', () => {
        handleClientDisconnect(clientId);
    });
    
    websocket.addEventListener('error', (error) => {
        console.error('WebSocket 오류:', error);
        handleClientDisconnect(clientId);
    });
    
    // 주기적 정리 수행
    performPeriodicCleanup();
}

// 클라이언트 연결 해제 처리
function handleClientDisconnect(clientId) {
    try {
        const client = connectedClients.get(clientId);
        if (client) {
            client.isConnected = false;
            
            if (client.user) {
                // 다른 클라이언트들에게 사용자 퇴장 알림 (즉시 전송)
                broadcastMessageUltraFast({
                    type: 'user_left',
                    user: client.user
                }, clientId);
            }
            
            connectedClients.delete(clientId);
        }
    } catch (error) {
        console.error('클라이언트 연결 해제 처리 오류:', error);
    }
}

// 안전한 WebSocket 메시지 전송
function safeWebSocketSend(websocket, message) {
    try {
        if (websocket && websocket.readyState === 1) { // OPEN
            websocket.send(JSON.stringify(message));
            return true;
        }
        return false;
    } catch (error) {
        console.error('WebSocket 메시지 전송 오류:', error);
        return false;
    }
}

// WebSocket 메시지 처리 (최적화된 버전)
async function handleWebSocketMessage(clientId, data, env) {
    const client = connectedClients.get(clientId);
    if (!client || !client.isConnected) return;
    
    try {
        switch (data.type || data.t) {
            case 'auth':
                // 사용자 인증 (즉시 처리)
                client.user = data.user;
                
                // 즉시 브로드캐스트
                broadcastMessageUltraFast({
                    type: 'user_joined',
                    user: data.user
                }, clientId);
                
                // 인증 성공 응답
                safeWebSocketSend(client.websocket, {
                    type: 'auth_success',
                    user: data.user,
                    timestamp: Date.now()
                });
                break;
                
            case 'load_notes':
                // 기존 스티키 노트들 로드 (비동기 처리하되 즉시 응답)
                loadAndSendNotes(client.websocket, env);
                break;
                
            case 'sync_request':
                // 실시간 동기화 요청 (우선순위 높음)
                loadAndSendSync(client.websocket, env, data.timestamp);
                break;
                
            case 'create_note':
                // 새 스티키 노트 생성 (최고 우선순위)
                const note = data.note;
                
                // 즉시 모든 클라이언트에게 브로드캐스트
                broadcastMessageUltraFast({
                    type: 'note_created',
                    note: note,
                    timestamp: Date.now()
                });
                
                // R2 저장을 백그라운드에서 처리
                scheduleR2Operation(() => saveNoteToR2(env, note), 'high');
                break;
                
            case 'delete_note':
                // 스티키 노트 삭제 (즉시 브로드캐스트)
                broadcastMessageUltraFast({
                    type: 'note_deleted',
                    noteId: data.noteId,
                    timestamp: Date.now()
                });
                
                // R2 삭제를 백그라운드에서 처리
                scheduleR2Operation(() => deleteNoteFromR2(env, data.noteId), 'medium');
                break;
                
            case 'update_note':
            case 'u': // 축약형 메시지 처리 (초고속)
                handleNoteUpdate(data, clientId);
                
                // R2 업데이트를 별도 큐에서 처리 (낮은 우선순위)
                scheduleR2Operation(() => updateNoteInR2(env, 
                    data.noteId || data.id, 
                    data.x, 
                    data.y
                ), 'low');
                break;
                
            case 'ping':
                // 연결 상태 확인 (즉시 응답)
                safeWebSocketSend(client.websocket, {
                    type: 'pong',
                    timestamp: data.timestamp
                });
                break;
                
            default:
                console.log('알 수 없는 메시지 타입:', data.type || data.t);
        }
    } catch (error) {
        console.error('메시지 처리 중 오류:', error);
        safeWebSocketSend(client.websocket, {
            type: 'error',
            message: '요청 처리 중 오류가 발생했습니다.',
            timestamp: Date.now()
        });
    }
}

// 노트 업데이트 처리 (최적화)
function handleNoteUpdate(data, clientId) {
    const noteId = data.noteId || data.id;
    const x = data.x;
    const y = data.y;
    const timestamp = data.timestamp || data.ts || Date.now();
    const sendingClientId = data.clientId || data.c;
    
    // 초경량 메시지로 즉시 브로드캐스트
    const ultraFastMessage = {
        t: 'u',
        id: noteId,
        x: x,
        y: y,
        ts: timestamp,
        c: sendingClientId
    };
    
    broadcastMessageUltraFast(ultraFastMessage, clientId);
}

// 비동기 노트 로드 및 전송
async function loadAndSendNotes(websocket, env) {
    try {
        const notes = await loadNotesFromR2(env);
        safeWebSocketSend(websocket, {
            type: 'notes_load',
            notes: notes,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('노트 로드 오류:', error);
        safeWebSocketSend(websocket, {
            type: 'error',
            message: '노트를 로드할 수 없습니다.'
        });
    }
}

// 비동기 동기화 응답
async function loadAndSendSync(websocket, env, requestTimestamp) {
    try {
        const syncNotes = await loadNotesFromR2(env);
        safeWebSocketSend(websocket, {
            type: 'sync_response',
            notes: syncNotes,
            timestamp: requestTimestamp
        });
    } catch (error) {
        console.error('동기화 오류:', error);
        safeWebSocketSend(websocket, {
            type: 'error',
            message: '동기화에 실패했습니다.'
        });
    }
}

// 우선순위 기반 R2 작업 스케줄러
const r2Operations = {
    high: [],
    medium: [],
    low: []
};
let isProcessingR2 = false;

function scheduleR2Operation(operation, priority = 'medium') {
    if (!r2Operations[priority]) {
        priority = 'medium';
    }
    
    r2Operations[priority].push({
        operation,
        timestamp: Date.now()
    });
    
    // 즉시 처리 시작 (비동기)
    processR2Operations();
}

async function processR2Operations() {
    if (isProcessingR2) return;
    
    isProcessingR2 = true;
    
    try {
        // 우선순위 순서로 처리: high -> medium -> low
        const priorities = ['high', 'medium', 'low'];
        
        for (const priority of priorities) {
            const operations = r2Operations[priority];
            
            while (operations.length > 0) {
                const { operation } = operations.shift();
                
                try {
                    await operation();
                } catch (error) {
                    console.error(`R2 작업 처리 오류 (${priority}):`, error);
                }
                
                // 고우선순위 작업 중간에 새로운 작업 확인
                if (priority === 'high' && r2Operations.high.length > 0) {
                    continue;
                }
            }
        }
    } finally {
        isProcessingR2 = false;
        
        // 남은 작업이 있다면 다시 스케줄링
        const hasRemaining = Object.values(r2Operations).some(queue => queue.length > 0);
        if (hasRemaining) {
            setTimeout(processR2Operations, 10);
        }
    }
}

// 주기적 정리 작업
function performPeriodicCleanup() {
    const now = Date.now();
    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
        lastCleanupTime = now;
        cleanupInactiveClients();
        cleanupOldR2Operations();
    }
}

// 오래된 R2 작업 정리
function cleanupOldR2Operations() {
    try {
        const cutoffTime = Date.now() - (10 * 60 * 1000); // 10분 이상 된 작업 제거
        
        Object.values(r2Operations).forEach(queue => {
            const originalLength = queue.length;
            // 오래된 작업들 제거
            for (let i = queue.length - 1; i >= 0; i--) {
                if (queue[i].timestamp < cutoffTime) {
                    queue.splice(i, 1);
                }
            }
            
            if (queue.length < originalLength) {
                console.log(`오래된 R2 작업 ${originalLength - queue.length}개 정리됨`);
            }
        });
    } catch (error) {
        console.error('R2 작업 정리 오류:', error);
    }
}

// 비활성 클라이언트 정리 함수 (최적화)
function cleanupInactiveClients() {
    try {
        const now = Date.now();
        const inactiveThreshold = 30 * 60 * 1000; // 30분
        const clientsToRemove = [];
        
        for (const [clientId, client] of connectedClients) {
            if (!client.isConnected || now - client.lastSeen > inactiveThreshold) {
                clientsToRemove.push(clientId);
            }
        }
        
        // 일괄 제거
        clientsToRemove.forEach(clientId => {
            const client = connectedClients.get(clientId);
            if (client && client.websocket) {
                try {
                    if (client.websocket.readyState === 1) {
                        client.websocket.close();
                    }
                } catch (error) {
                    console.error('클라이언트 정리 오류:', error);
                }
            }
            connectedClients.delete(clientId);
        });
        
        if (clientsToRemove.length > 0) {
            console.log(`비활성 클라이언트 ${clientsToRemove.length}개 정리됨`);
        }
    } catch (error) {
        console.error('클라이언트 정리 중 오류:', error);
    }
}

// 초고속 브로드캐스트 (최대 성능 최적화)
function broadcastMessageUltraFast(message, excludeClientId = null) {
    try {
        const messageStr = JSON.stringify(message);
        let successCount = 0;
        let failCount = 0;
        const failedClients = [];
        
        // 동기적으로 즉시 전송
        for (const [clientId, client] of connectedClients) {
            if (clientId !== excludeClientId && client.isConnected) {
                try {
                    if (client.websocket && client.websocket.readyState === 1) {
                        client.websocket.send(messageStr);
                        successCount++;
                    } else {
                        failedClients.push(clientId);
                        failCount++;
                    }
                } catch (error) {
                    console.error('브로드캐스트 전송 오류:', error);
                    failedClients.push(clientId);
                    failCount++;
                }
            }
        }
        
        // 실패한 클라이언트들을 백그라운드에서 정리
        if (failedClients.length > 0) {
            setTimeout(() => {
                failedClients.forEach(clientId => {
                    handleClientDisconnect(clientId);
                });
            }, 0);
        }
        
        // 성능 로깅 (필요시)
        if (failCount > 0) {
            console.log(`브로드캐스트: 성공 ${successCount}, 실패 ${failCount}`);
        }
        
    } catch (error) {
        console.error('브로드캐스트 전체 오류:', error);
    }
}

// 모든 클라이언트에게 메시지 브로드캐스트 (일반용)
function broadcastMessage(message, excludeClientId = null) {
    // 성능상 ultraFast 버전 사용
    broadcastMessageUltraFast(message, excludeClientId);
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
                    version: '1.1.0',
                    r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                    performance: {
                        r2QueueSizes: {
                            high: r2Operations.high.length,
                            medium: r2Operations.medium.length,
                            low: r2Operations.low.length
                        },
                        isProcessingR2: isProcessingR2
                    }
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            case '/debug':
                // 디버깅용 엔드포인트 (성능 정보 포함)
                const debugInfo = {
                    r2BucketStatus: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                    connectedClients: connectedClients.size,
                    timestamp: new Date().toISOString(),
                    performance: {
                        r2Operations: {
                            high: r2Operations.high.length,
                            medium: r2Operations.medium.length,
                            low: r2Operations.low.length,
                            total: Object.values(r2Operations).reduce((sum, queue) => sum + queue.length, 0)
                        },
                        isProcessingR2: isProcessingR2,
                        lastCleanup: new Date(lastCleanupTime).toISOString(),
                        nextCleanup: new Date(lastCleanupTime + CLEANUP_INTERVAL).toISOString()
                    },
                    clients: Array.from(connectedClients.entries()).map(([id, client]) => ({
                        id: id.substring(0, 12) + '...',
                        user: client.user?.name || 'anonymous',
                        lastSeen: new Date(client.lastSeen).toISOString(),
                        isConnected: client.isConnected,
                        readyState: client.websocket?.readyState
                    }))
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

// R2에서 노트 로드 (캐싱 최적화)
let notesCache = null;
let notesCacheTime = 0;
const CACHE_DURATION = 30 * 1000; // 30초 캐시

async function loadNotesFromR2(env) {
    try {
        // 캐시 확인 (읽기 작업 최적화)
        const now = Date.now();
        if (notesCache && (now - notesCacheTime) < CACHE_DURATION) {
            return notesCache;
        }
        
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return [];
        }
        
        console.log('R2에서 notes.json 로딩 시도...');
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        if (!notesObject) {
            console.log('notes.json 파일이 존재하지 않음, 빈 배열 반환');
            const emptyNotes = [];
            notesCache = emptyNotes;
            notesCacheTime = now;
            return emptyNotes;
        }
        
        const notesData = await notesObject.text();
        const notes = JSON.parse(notesData);
        console.log(`R2에서 ${notes.length}개의 노트 로드됨`);
        
        // 캐시 업데이트
        notesCache = notes;
        notesCacheTime = now;
        
        return notes;
    } catch (error) {
        console.error('R2에서 노트 로드 오류:', error);
        // 캐시가 있다면 캐시 반환
        if (notesCache) {
            console.log('R2 오류 시 캐시 데이터 사용');
            return notesCache;
        }
        return [];
    }
}

// 캐시 무효화
function invalidateNotesCache() {
    notesCache = null;
    notesCacheTime = 0;
}

// R2에 노트 저장 (최적화)
async function saveNoteToR2(env, note) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 저장할 수 없습니다');
            return;
        }
        
        console.log('노트 저장 시작:', note.id);
        
        // 기존 노트들 로드 (캐시 사용)
        const existingNotes = await loadNotesFromR2(env);
        
        // 새 노트 추가
        const updatedNotes = [...existingNotes, note];
        
        // 최대 노트 수 제한 (1000개)
        if (updatedNotes.length > 1000) {
            updatedNotes.splice(0, updatedNotes.length - 1000);
        }
        
        // 병렬로 R2 저장 작업 수행
        const saveOperations = [
            // 메인 노트 목록 저장
            env.STICKY_NOTES_BUCKET.put(
                'notes.json',
                JSON.stringify(updatedNotes),
                {
                    httpMetadata: {
                        contentType: 'application/json',
                    },
                }
            ),
            // 개별 노트 백업 저장
            env.STICKY_NOTES_BUCKET.put(
                `notes/${note.id}.json`,
                JSON.stringify(note),
                {
                    httpMetadata: {
                        contentType: 'application/json',
                    },
                }
            )
        ];
        
        await Promise.all(saveOperations);
        
        // 캐시 업데이트
        notesCache = updatedNotes;
        notesCacheTime = Date.now();
        
        console.log('노트 저장 완료:', note.id);
        
    } catch (error) {
        console.error('R2에 노트 저장 오류:', error);
        // 캐시 무효화
        invalidateNotesCache();
    }
}

// R2에서 노트 삭제 (최적화)
async function deleteNoteFromR2(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 삭제할 수 없습니다');
            return;
        }
        
        console.log('노트 삭제 시작:', noteId);
        
        // 기존 노트들 로드 (캐시 사용)
        const existingNotes = await loadNotesFromR2(env);
        
        // 노트 필터링 (삭제)
        const filteredNotes = existingNotes.filter(note => note.id !== noteId);
        
        // 변경사항이 있을 때만 저장
        if (filteredNotes.length !== existingNotes.length) {
            // 병렬로 R2 삭제 작업 수행
            const deleteOperations = [
                // 메인 노트 목록 업데이트
                env.STICKY_NOTES_BUCKET.put(
                    'notes.json',
                    JSON.stringify(filteredNotes),
                    {
                        httpMetadata: {
                            contentType: 'application/json',
                        },
                    }
                ),
                // 개별 노트 파일 삭제
                env.STICKY_NOTES_BUCKET.delete(`notes/${noteId}.json`)
            ];
            
            await Promise.all(deleteOperations);
            
            // 캐시 업데이트
            notesCache = filteredNotes;
            notesCacheTime = Date.now();
            
            console.log('노트 삭제 완료:', noteId);
        } else {
            console.log('삭제할 노트가 없음:', noteId);
        }
        
    } catch (error) {
        console.error('R2에서 노트 삭제 오류:', error);
        // 캐시 무효화
        invalidateNotesCache();
    }
}

// R2에서 노트 위치 업데이트 (최적화 - 배치 처리)
const pendingUpdates = new Map(); // noteId -> {x, y, timestamp}
let updateBatchTimeout = null;
const BATCH_UPDATE_DELAY = 1000; // 1초마다 배치 처리

async function updateNoteInR2(env, noteId, x, y) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 업데이트할 수 없습니다');
            return;
        }
        
        // 배치 업데이트에 추가
        pendingUpdates.set(noteId, {
            x: x,
            y: y,
            timestamp: Date.now()
        });
        
        // 배치 처리 스케줄링
        if (!updateBatchTimeout) {
            updateBatchTimeout = setTimeout(() => {
                processBatchUpdates(env);
            }, BATCH_UPDATE_DELAY);
        }
        
    } catch (error) {
        console.error('R2에서 노트 업데이트 오류:', error);
    }
}

// 배치 업데이트 처리
async function processBatchUpdates(env) {
    try {
        updateBatchTimeout = null;
        
        if (pendingUpdates.size === 0) {
            return;
        }
        
        console.log(`배치 업데이트 시작: ${pendingUpdates.size}개 노트`);
        
        // 현재 pending updates 복사 후 클리어
        const updatesToProcess = new Map(pendingUpdates);
        pendingUpdates.clear();
        
        // 기존 노트들 로드
        const existingNotes = await loadNotesFromR2(env);
        let hasChanges = false;
        
        // 각 업데이트 적용
        for (const [noteId, update] of updatesToProcess) {
            const noteIndex = existingNotes.findIndex(note => note.id === noteId);
            if (noteIndex !== -1) {
                existingNotes[noteIndex].x = update.x;
                existingNotes[noteIndex].y = update.y;
                existingNotes[noteIndex].lastUpdated = update.timestamp;
                hasChanges = true;
            }
        }
        
        // 변경사항이 있을 때만 저장
        if (hasChanges) {
            await env.STICKY_NOTES_BUCKET.put(
                'notes.json',
                JSON.stringify(existingNotes),
                {
                    httpMetadata: {
                        contentType: 'application/json',
                    },
                }
            );
            
            // 캐시 업데이트
            notesCache = existingNotes;
            notesCacheTime = Date.now();
            
            console.log(`배치 업데이트 완료: ${updatesToProcess.size}개 노트`);
        }
        
    } catch (error) {
        console.error('배치 업데이트 처리 오류:', error);
        // 캐시 무효화
        invalidateNotesCache();
    }
}

// 클라이언트 ID 생성 (더 빠른 버전)
function generateClientId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
} 