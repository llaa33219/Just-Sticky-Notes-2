// Durable Object for real-time sticky notes
export class StickyNotesRoom {
    constructor(controller, env) {
        this.controller = controller;
        this.env = env;
        this.sessions = new Set();
        this.notes = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);
        
        if (url.pathname === '/websocket') {
            return this.handleWebSocket(request);
        }
        
        return new Response('Not found', { status: 404 });
    }

    async handleWebSocket(request) {
        const upgradeHeader = request.headers.get('Upgrade');
        if (upgradeHeader !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        this.handleSession(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    handleSession(webSocket) {
        webSocket.accept();
        this.sessions.add(webSocket);

        webSocket.addEventListener('message', async (event) => {
            try {
                const message = JSON.parse(event.data);
                await this.handleMessage(webSocket, message);
            } catch (error) {
                console.error('Error handling message:', error);
            }
        });

        webSocket.addEventListener('close', () => {
            this.sessions.delete(webSocket);
        });

        webSocket.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
            this.sessions.delete(webSocket);
        });
    }

    async handleMessage(webSocket, message) {
        switch (message.type) {
            case 'get_notes':
                await this.sendNotesInArea(webSocket, message.area);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    async sendNotesInArea(webSocket, area) {
        const notes = Array.from(this.notes.values()).filter(note => {
            return note.x >= area.x && note.x <= area.x + area.width &&
                   note.y >= area.y && note.y <= area.y + area.height;
        });

        webSocket.send(JSON.stringify({
            type: 'notes_list',
            notes: notes
        }));
    }

    broadcast(message) {
        const messageString = JSON.stringify(message);
        this.sessions.forEach(session => {
            try {
                session.send(messageString);
            } catch (error) {
                console.error('Error broadcasting message:', error);
                this.sessions.delete(session);
            }
        });
    }

    async addNote(note) {
        this.notes.set(note.id, note);
        this.broadcast({
            type: 'note_created',
            note: note
        });
    }

    async updateNote(note) {
        this.notes.set(note.id, note);
        this.broadcast({
            type: 'note_updated',
            note: note
        });
    }

    async deleteNote(noteId) {
        this.notes.delete(noteId);
        this.broadcast({
            type: 'note_deleted',
            noteId: noteId
        });
    }
}

// Main Worker
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // CORS 헤더
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // OPTIONS 요청 처리
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 라우팅
        if (url.pathname.startsWith('/api/')) {
            return handleAPI(request, env, corsHeaders);
        }

        // 정적 파일 서빙 (Cloudflare Pages에서 처리)
        return env.ASSETS.fetch(request);
    }
};

async function handleAPI(request, env, corsHeaders) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
        if (path === '/api/auth/check') {
            return handleAuthCheck(request, corsHeaders);
        }
        
        if (path === '/api/auth/google') {
            return handleGoogleAuth(request, env, corsHeaders);
        }
        
        if (path === '/api/auth/callback') {
            return handleAuthCallback(request, env, corsHeaders);
        }
        
        if (path === '/api/auth/logout') {
            return handleLogout(request, corsHeaders);
        }
        
        if (path === '/api/ws') {
            return handleWebSocketUpgrade(request, env);
        }
        
        if (path === '/api/notes') {
            return handleNotes(request, env, corsHeaders);
        }
        
        if (path.startsWith('/api/notes/')) {
            const noteId = path.split('/')[3];
            return handleNoteById(request, env, noteId, corsHeaders);
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (error) {
        console.error('API Error:', error);
        return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
    }
}

async function handleAuthCheck(request, corsHeaders) {
    const sessionCookie = getCookie(request, 'session');
    
    if (!sessionCookie) {
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    try {
        const user = JSON.parse(atob(sessionCookie));
        return new Response(JSON.stringify({ authenticated: true, user }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}

async function handleGoogleAuth(request, env, corsHeaders) {
    const url = new URL(request.url);
    const redirectUri = `${url.origin}/api/auth/callback`;
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${env.GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=openid profile email&` +
        `state=${generateRandomString(32)}`;

    return Response.redirect(authUrl, 302);
}

async function handleAuthCallback(request, env, corsHeaders) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    
    if (!code) {
        return Response.redirect('/?auth=error', 302);
    }

    try {
        // 구글 OAuth 토큰 교환
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: env.GOOGLE_CLIENT_ID,
                client_secret: env.GOOGLE_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: `${url.origin}/api/auth/callback`,
            }),
        });

        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
            throw new Error('No access token received');
        }

        // 사용자 정보 가져오기
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
            },
        });

        const user = await userResponse.json();
        
        // 세션 쿠키 설정
        const sessionData = btoa(JSON.stringify({
            id: user.id,
            name: user.name,
            email: user.email,
            picture: user.picture,
        }));

        const response = Response.redirect('/?auth=success', 302);
        response.headers.set('Set-Cookie', `session=${sessionData}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
        
        return response;
    } catch (error) {
        console.error('OAuth error:', error);
        return Response.redirect('/?auth=error', 302);
    }
}

async function handleLogout(request, corsHeaders) {
    const response = new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
    response.headers.set('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return response;
}

async function handleWebSocketUpgrade(request, env) {
    const durableObjectId = env.STICKY_NOTES_DO.idFromName('main-room');
    const durableObject = env.STICKY_NOTES_DO.get(durableObjectId);
    
    return durableObject.fetch(new URL('/websocket', request.url), request);
}

async function handleNotes(request, env, corsHeaders) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    if (request.method === 'POST') {
        return createNote(request, env, user, corsHeaders);
    } else if (request.method === 'PUT') {
        return updateNote(request, env, user, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
}

async function handleNoteById(request, env, noteId, corsHeaders) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    if (request.method === 'DELETE') {
        return deleteNote(request, env, noteId, user, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
}

async function createNote(request, env, user, corsHeaders) {
    try {
        const noteData = await request.json();
        
        const note = {
            id: generateId(),
            x: noteData.x,
            y: noteData.y,
            content: noteData.content,
            color: noteData.color || '#ffeb3b',
            author: user.name,
            authorId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // R2에 저장
        await env.STICKY_NOTES_BUCKET.put(`notes/${note.id}`, JSON.stringify(note));

        // Durable Object에 추가
        const durableObjectId = env.STICKY_NOTES_DO.idFromName('main-room');
        const durableObject = env.STICKY_NOTES_DO.get(durableObjectId);
        
        await durableObject.addNote(note);

        return new Response(JSON.stringify(note), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating note:', error);
        return new Response('Error creating note', { status: 500, headers: corsHeaders });
    }
}

async function updateNote(request, env, user, corsHeaders) {
    try {
        const noteData = await request.json();
        
        if (!noteData.id) {
            return new Response('Note ID required', { status: 400, headers: corsHeaders });
        }

        // 기존 노트 확인
        const existingNote = await env.STICKY_NOTES_BUCKET.get(`notes/${noteData.id}`);
        if (!existingNote) {
            return new Response('Note not found', { status: 404, headers: corsHeaders });
        }

        const existingNoteData = JSON.parse(await existingNote.text());
        
        // 권한 확인
        if (existingNoteData.authorId !== user.id) {
            return new Response('Forbidden', { status: 403, headers: corsHeaders });
        }

        const updatedNote = {
            ...existingNoteData,
            content: noteData.content,
            color: noteData.color,
            updatedAt: new Date().toISOString()
        };

        // R2에 업데이트
        await env.STICKY_NOTES_BUCKET.put(`notes/${updatedNote.id}`, JSON.stringify(updatedNote));

        // Durable Object에 업데이트
        const durableObjectId = env.STICKY_NOTES_DO.idFromName('main-room');
        const durableObject = env.STICKY_NOTES_DO.get(durableObjectId);
        
        await durableObject.updateNote(updatedNote);

        return new Response(JSON.stringify(updatedNote), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating note:', error);
        return new Response('Error updating note', { status: 500, headers: corsHeaders });
    }
}

async function deleteNote(request, env, noteId, user, corsHeaders) {
    try {
        // 기존 노트 확인
        const existingNote = await env.STICKY_NOTES_BUCKET.get(`notes/${noteId}`);
        if (!existingNote) {
            return new Response('Note not found', { status: 404, headers: corsHeaders });
        }

        const existingNoteData = JSON.parse(await existingNote.text());
        
        // 권한 확인
        if (existingNoteData.authorId !== user.id) {
            return new Response('Forbidden', { status: 403, headers: corsHeaders });
        }

        // R2에서 삭제
        await env.STICKY_NOTES_BUCKET.delete(`notes/${noteId}`);

        // Durable Object에서 삭제
        const durableObjectId = env.STICKY_NOTES_DO.idFromName('main-room');
        const durableObject = env.STICKY_NOTES_DO.get(durableObjectId);
        
        await durableObject.deleteNote(noteId);

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting note:', error);
        return new Response('Error deleting note', { status: 500, headers: corsHeaders });
    }
}

// 유틸리티 함수들
async function getAuthenticatedUser(request) {
    const sessionCookie = getCookie(request, 'session');
    if (!sessionCookie) return null;

    try {
        return JSON.parse(atob(sessionCookie));
    } catch (error) {
        return null;
    }
}

function getCookie(request, name) {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
    const targetCookie = cookies.find(cookie => cookie.startsWith(`${name}=`));
    
    return targetCookie ? targetCookie.split('=')[1] : null;
}

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
} 