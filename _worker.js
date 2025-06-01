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
            
            // 정적 파일은 Cloudflare Pages가 처리하므로 여기서는 처리하지 않음
            // 만약 여기까지 왔다면 404 반환
            return new Response('Not Found', { 
                status: 404,
                headers: CORS_HEADERS
            });
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
                
            case 'sync_request':
                // 실시간 동기화 요청
                const syncNotes = await loadNotesFromR2(env);
                client.websocket.send(JSON.stringify({
                    type: 'sync_response',
                    notes: syncNotes,
                    timestamp: data.timestamp
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
                
            case 'update_note':
                // 스티키 노트 위치 업데이트
                await updateNoteInR2(env, data.noteId, data.x, data.y);
                broadcastMessage({
                    type: 'note_updated',
                    noteId: data.noteId,
                    x: data.x,
                    y: data.y
                }, clientId);
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
                    if (client.websocket && client.websocket.readyState === 1) {
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
                    version: '1.0.0',
                    r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found'
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
                    timestamp: new Date().toISOString()
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
        
        console.log('R2에서 notes.json 로딩 시도...');
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        if (!notesObject) {
            console.log('notes.json 파일이 존재하지 않음, 빈 배열 반환');
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
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 저장할 수 없습니다');
            return;
        }
        
        console.log('노트 저장 시작:', note.id);
        
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
        
        console.log('노트 저장 완료:', note.id);
        
    } catch (error) {
        console.error('R2에 노트 저장 오류:', error);
        // 에러가 발생해도 앱이 멈추지 않도록 처리
    }
}

// R2에서 노트 삭제
async function deleteNoteFromR2(env, noteId) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 삭제할 수 없습니다');
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

// R2에서 노트 위치 업데이트
async function updateNoteInR2(env, noteId, x, y) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않아 노트를 업데이트할 수 없습니다');
            return;
        }
        
        console.log('노트 위치 업데이트 시작:', noteId, x, y);
        
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
            
            // 개별 노트 파일도 업데이트
            await env.STICKY_NOTES_BUCKET.put(
                `notes/${noteId}.json`,
                JSON.stringify(existingNotes[noteIndex]),
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
    }
}

// 클라이언트 ID 생성
function generateClientId() {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
} 